'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl, { Map as MapboxMap, Marker, Popup, NavigationControl } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { EXCHANGE_SERVERS } from '@/lib/exchange-data';

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const ENABLE_TERRAIN = !!MAPTILER_KEY && process.env.NEXT_PUBLIC_TERRAIN !== '0';

// Set Mapbox access token if available
if (MAPBOX_ACCESS_TOKEN) {
  mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
}

// Style URL: Prefer Mapbox styles if token available, otherwise use MapTiler or fallback
const STYLE_URL = MAPBOX_ACCESS_TOKEN
  ? 'mapbox://styles/mapbox/satellite-streets-v12'
  : MAPTILER_KEY
  ? `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`
  : 'https://demotiles.maplibre.org/style.json';

function getMarkerColor(provider: 'AWS' | 'GCP' | 'Azure') {
  if (provider === 'AWS') return '#FF9900';
  if (provider === 'GCP') return '#4285F4';
  return '#0078D4';
}

export default function WorldMapLibre() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      // Mapbox GL JS supports globe projection with improved 3D sphere rendering
      // Note: projection must be set after style loads, not in initial options
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: [0, 20],
        zoom: 1.5,
        minZoom: 0.5,
        maxZoom: 16,
        pitchWithRotate: true,
        dragRotate: true,
        attributionControl: false,
        // @ts-ignore runtime supports antialias in WebGL context options
        antialias: false,
      });
      mapRef.current = map;

      // Controls
      map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

      // Ensure globe projection, fog and optional terrain after style loads/changes
      const setGlobeAndEnvironment = () => {
        try {
          // Set globe projection after style load (per Mapbox example)
          // Use the { type: 'globe' } signature
          if ((map as any).setProjection) {
            (map as any).setProjection({ type: 'globe' });
          }
          
          // Optional atmospheric fog for enhanced 3D globe effect
          if ((map as any).setFog) {
            (map as any).setFog({ 
              color: 'rgba(186, 210, 235, 0.5)', 
              'high-color': '#add8e6', 
              'space-color': '#000000', 
              'horizon-blend': 0.1 
            });
          }
          
          // Optional 3D terrain if enabled (can be heavy)
          if (ENABLE_TERRAIN) {
            const sourceId = 'terrain-dem';
            try { 
              // Remove existing terrain if any
              if ((map as any).getTerrain) {
                (map as any).setTerrain(null); 
              }
            } catch {}
            
            try { 
              if (map.getSource(sourceId)) {
                map.removeSource(sourceId); 
              }
            } catch {}
            
            try {
              map.addSource(sourceId, {
                type: 'raster-dem',
                url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
                tileSize: 256,
                maxzoom: 14,
              } as any);
              
              // Set terrain with conservative exaggeration
              (map as any).setTerrain({ source: sourceId, exaggeration: 1.0 });
            } catch (err) {
              console.warn('Failed to add terrain:', err);
            }
          }
        } catch (err) {
          console.warn('Failed to set globe environment:', err);
        }
      };

      // Set projection - Mapbox GL JS uses setProjection method
      const setProjection = () => {
        try {
          // Method 1: Direct setProjection call (preferred for Mapbox GL JS)
          if (typeof (map as any).setProjection === 'function') {
            (map as any).setProjection('globe');
            console.log('Projection set to globe via setProjection()');
            return;
          }
          
          // Method 2: Set via style object
          const style = map.getStyle();
          if (style) {
            (style as any).projection = 'globe';
            map.setStyle(style);
            console.log('Projection set to globe via style object');
          }
        } catch (err) {
          console.error('Failed to set projection:', err);
        }
      };
      
      // Set projection immediately when map loads (before other operations)
      map.once('load', () => {
        setProjection();
        setGlobeAndEnvironment();
      });
      
      // Also try on style.load event
      map.once('style.load', setProjection);
      
      map.on('styledata', setGlobeAndEnvironment);

      // Improve interactions
      try { map.doubleClickZoom?.enable(); } catch {}
      try { map.touchZoomRotate?.enable(); } catch {}
      try { (map.scrollZoom as any)?.setWheelZoomRate?.(1 / 200); } catch {}

      // Add exchange markers via GeoJSON + layer for performance
      // Only render markers visible in current viewport to improve performance
      const markers: Marker[] = [];
      const allExchangesGeoJson: any = {
        type: 'FeatureCollection',
        features: EXCHANGE_SERVERS.map((ex) => ({
          type: 'Feature',
          properties: {
            name: ex.name,
            city: ex.location.city,
            country: ex.location.country,
            provider: ex.cloudProvider,
            region: ex.region,
          },
          geometry: { type: 'Point', coordinates: [ex.location.lng, ex.location.lat] },
        })),
      };

      // Function to filter exchanges based on viewport bounds
      // Only renders markers visible in current viewport for better performance
      const updateVisibleMarkers = () => {
        try {
          const source = map.getSource('exchanges') as any;
          if (!source) return;

          const bounds = map.getBounds();
          if (!bounds) return;
          
          // Filter exchanges that are within the viewport bounds
          // For globe projection, we need to check if points are visible
          const visibleFeatures = allExchangesGeoJson.features.filter((feature: any) => {
            const [lng, lat] = feature.geometry.coordinates;
            
            // Basic bounds check
            if (bounds.contains([lng, lat])) {
              return true;
            }
            
            // For globe projection, also check nearby longitude wraparound
            // (e.g., if viewport shows -180 to -170, also check 180 to 190)
            const west = bounds.getWest();
            const east = bounds.getEast();
            
            // Handle longitude wraparound
            if (east < west) {
              // Viewport crosses the date line
              return lng >= west || lng <= east;
            }
            
            return false;
          });

          // Update source with only visible markers
          const visibleGeoJson: any = {
            type: 'FeatureCollection',
            features: visibleFeatures,
          };

          source.setData(visibleGeoJson);
        } catch (err) {
          console.warn('Failed to update visible markers:', err);
        }
      };

      map.on('load', () => {
        try {
          // Initialize with empty data, will be populated by updateVisibleMarkers
          if (!map.getSource('exchanges')) {
            map.addSource('exchanges', { 
              type: 'geojson', 
              data: { type: 'FeatureCollection', features: [] }
            });
          }
          if (!map.getLayer('exchanges-circles')) {
            // Add glow/shadow layer behind main circles for 3D depth effect
            map.addLayer({
              id: 'exchanges-circles-glow',
              type: 'circle',
              source: 'exchanges',
              paint: {
                'circle-radius': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  0, 6,
                  5, 10,
                  10, 16,
                ],
                'circle-opacity': 0.3,
                'circle-color': [
                  'match',
                  ['get', 'provider'],
                  'AWS', '#FF9900',
                  'GCP', '#4285F4',
                  'Azure', '#0078D4',
                  '#666666',
                ],
                'circle-pitch-alignment': 'map',
                'circle-pitch-scale': 'map',
              },
            });

            // Main circle layer with 3D styling
            map.addLayer({
              id: 'exchanges-circles',
              type: 'circle',
              source: 'exchanges',
              paint: {
                'circle-radius': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  0, 4,
                  5, 7,
                  10, 12,
                ],
                'circle-stroke-width': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  0, 1.5,
                  5, 2,
                  10, 2.5,
                ],
                'circle-stroke-color': [
                  'match',
                  ['get', 'provider'],
                  'AWS', '#FFCC66',
                  'GCP', '#6BA3F5',
                  'Azure', '#4CA3E0',
                  '#888888',
                ],
                'circle-stroke-opacity': 0.8,
                'circle-color': [
                  'match',
                  ['get', 'provider'],
                  'AWS', '#FF9900',
                  'GCP', '#4285F4',
                  'Azure', '#0078D4',
                  '#666666',
                ],
                'circle-opacity': 0.95,
                'circle-pitch-alignment': 'map',
                'circle-pitch-scale': 'map',
                // Add subtle elevation effect
                'circle-translate': [0, -1],
              },
            });

            // Add highlight layer on top for extra shine
            map.addLayer({
              id: 'exchanges-circles-highlight',
              type: 'circle',
              source: 'exchanges',
              paint: {
                'circle-radius': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  0, 2,
                  5, 3.5,
                  10, 5,
                ],
                'circle-color': [
                  'match',
                  ['get', 'provider'],
                  'AWS', '#FFE5B4',
                  'GCP', '#B8D4FF',
                  'Azure', '#B3E0FF',
                  '#CCCCCC',
                ],
                'circle-opacity': 0.6,
                'circle-pitch-alignment': 'map',
                'circle-pitch-scale': 'map',
                'circle-translate': [0, -1.5],
              },
            });
          }
          
          // Initial update of visible markers
          updateVisibleMarkers();
        } catch (err) {
          console.warn('Failed to setup exchange markers:', err);
        }
      });

      // Update visible markers when map moves or zooms
      map.on('moveend', updateVisibleMarkers);
      map.on('zoomend', updateVisibleMarkers);

      // Popup on hover for the circle layer
      const hoverPopup = new Popup({ 
        closeButton: false, 
        closeOnClick: false, 
        offset: 12,
        className: 'exchange-popup',
        maxWidth: '300px'
      });
      
      // Add hover handlers to all circle layers for better interaction
      ['exchanges-circles', 'exchanges-circles-glow', 'exchanges-circles-highlight'].forEach((layerId) => {
        map.on('mouseenter', layerId, (e: any) => {
          map.getCanvas().style.cursor = 'pointer';
          const feature = e.features?.[0];
          if (!feature) return;
          const [lng, lat] = feature.geometry.coordinates;
          const p = feature.properties;
          hoverPopup
            .setLngLat([lng, lat])
            .setHTML(`<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size:12px; line-height:1.4; padding: 4px;">
              <div style="font-weight:600; margin-bottom:2px; color: #333;">${p.name}</div>
              <div style="opacity:.8; color: #666;">${p.city}, ${p.country}</div>
              <div style="opacity:.8; color: #666;">${p.provider} - ${p.region}</div>
            </div>`)
            .addTo(map);
        });
        
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });
      });

      // Dynamically toggle terrain based on zoom to reduce GPU load
      if (ENABLE_TERRAIN) {
        const updateTerrainForZoom = () => {
          const z = map.getZoom();
          try {
            if (z >= 3 && z <= 9) {
              (map as any).setTerrain({ source: 'terrain-dem', exaggeration: 1.0 });
            } else {
              (map as any).setTerrain(null);
            }
          } catch {}
        };
        map.on('moveend', updateTerrainForZoom);
        map.on('load', updateTerrainForZoom);
      }

      const handleResize = () => map.resize();
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        markers.forEach((m) => m.remove());
        popupCleanup(map);
        map.remove();
      };
    } catch (e: any) {
      setError(e?.message || 'Failed to initialize map');
    }
  }, []);

  return (
    <div className="w-full h-screen relative">
      <div ref={containerRef} className="w-full h-full" />

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-black/80 text-white p-5 rounded-xl backdrop-blur-md shadow-2xl border border-white/10">
        <h3 className="font-bold mb-4 text-base tracking-wide">Exchange Server Locations</h3>
        <div className="space-y-3 text-sm">
          {/* AWS Legend Item */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center">
              {/* Glow layer */}
              <div className="absolute w-5 h-5 rounded-full bg-[#FF9900] opacity-30 blur-sm"></div>
              {/* Main circle */}
              <div className="relative w-4 h-4 rounded-full bg-[#FF9900] border-2 border-[#FFCC66] shadow-lg"></div>
              {/* Highlight layer */}
              <div className="absolute w-2 h-2 rounded-full bg-[#FFE5B4] opacity-60"></div>
            </div>
            <span className="font-medium">AWS</span>
          </div>
          
          {/* GCP Legend Item */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center">
              {/* Glow layer */}
              <div className="absolute w-5 h-5 rounded-full bg-[#4285F4] opacity-30 blur-sm"></div>
              {/* Main circle */}
              <div className="relative w-4 h-4 rounded-full bg-[#4285F4] border-2 border-[#6BA3F5] shadow-lg"></div>
              {/* Highlight layer */}
              <div className="absolute w-2 h-2 rounded-full bg-[#B8D4FF] opacity-60"></div>
            </div>
            <span className="font-medium">GCP</span>
          </div>
          
          {/* Azure Legend Item */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center">
              {/* Glow layer */}
              <div className="absolute w-5 h-5 rounded-full bg-[#0078D4] opacity-30 blur-sm"></div>
              {/* Main circle */}
              <div className="relative w-4 h-4 rounded-full bg-[#0078D4] border-2 border-[#4CA3E0] shadow-lg"></div>
              {/* Highlight layer */}
              <div className="absolute w-2 h-2 rounded-full bg-[#B3E0FF] opacity-60"></div>
            </div>
            <span className="font-medium">Azure</span>
          </div>
        </div>
        {MAPBOX_ACCESS_TOKEN ? null : !MAPTILER_KEY ? (
          <div className="mt-4 pt-3 border-t border-white/20 text-xs text-amber-200/80">
            Using demo tiles. For high-detail globe, set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN or NEXT_PUBLIC_MAPTILER_KEY in .env.local
          </div>
        ) : null}
      </div>

      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-3 py-2 rounded">
          {error}
        </div>
      )}
    </div>
  );
}

function popupCleanup(map: MapboxMap) {
  const nodes = document.querySelectorAll('.mapboxgl-popup');
  nodes.forEach((n) => n.parentElement?.removeChild(n));
}
