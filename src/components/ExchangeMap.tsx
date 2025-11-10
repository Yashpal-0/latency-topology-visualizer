'use client';

/**
 * ExchangeMap
 * -----------
 * Core client component of the Latency Topology Visualizer. It:
 *  - boots the Mapbox globe and control chrome,
 *  - renders exchange and cloud-region markers,
 *  - polls Cloudflare Radar (through `/api/latency`) for live latency metrics, and
 *  - draws animated latency links to highlight the best-performing region for every exchange.
 *
 * Inline comments throughout the module document the main data-flow and rendering decisions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  CLOUD_REGIONS,
  EXCHANGE_LOCATIONS,
  type CloudProvider,
} from '@/data/network';
import LatencyHistoryPanel from '@/components/LatencyHistoryPanel';
import type {
  HistoryStats,
  LatencyHistoryPoint,
  TimeRangeKey,
} from '@/types/latency';

type LatencyStatus = 'low' | 'medium' | 'high' | 'unknown';

type LatencySnapshot = {
  regionId: string;
  location: string;
  latencyIdle: number | null;
  latencyLoaded: number | null;
  jitterIdle: number | null;
  capturedAt: string;
};

const PROVIDER_COLORS: Record<CloudProvider, string> = {
  AWS: '#f97316',
  GCP: '#22d3ee',
  Azure: '#8b5cf6',
};

const PROVIDER_FILL_COLORS: Record<CloudProvider, string> = {
  AWS: 'rgba(249, 115, 22, 0.22)',
  GCP: 'rgba(34, 211, 238, 0.22)',
  Azure: 'rgba(139, 92, 246, 0.22)',
};

type ProviderVisibilityMap = Record<CloudProvider, boolean>;

type RegionMarkerEntry = {
  marker: mapboxgl.Marker;
  region: (typeof CLOUD_REGIONS)[number];
  element: HTMLDivElement;
};

type LatencyVisibilityMap = Record<LatencyStatus, boolean>;

type LayerVisibilityState = {
  realtime: boolean;
  history: boolean;
  regions: boolean;
};

type SearchResult = {
  id: string;
  label: string;
  type: 'exchange' | 'region';
  provider: CloudProvider;
  coordinates: [number, number];
  meta: string;
  disabled?: boolean;
};

type PerformanceMetrics = {
  sampleCount: number;
  averageLatency: number | null;
  maxLatency: number | null;
  minLatency: number | null;
  visibleRegionCount: number;
  status: 'Operational' | 'Degraded' | 'Paused';
};

type FeatureCollectionConfig = {
  providerVisibility?: ProviderVisibilityMap;
  exchangeFilter?: string;
  allowedStatuses?: LatencyVisibilityMap;
  realtimeEnabled?: boolean;
};

const LATENCY_COLORS: Record<LatencyStatus, string> = {
  low: '#22c55e',
  medium: '#facc15',
  high: '#f97316',
  unknown: 'rgba(148,163,184,0.35)',
};

const LATENCY_THRESHOLDS = {
  low: 45,
  medium: 110,
};

// Static catalogue of the major exchanges we want to surface on the globe.


const CONNECTION_SOURCE_ID = 'latency-connections';
const CONNECTION_LAYER_ID = 'latency-lines';
const CONNECTION_LABEL_LAYER_ID = 'latency-labels';

const REGION_BOUNDARY_SOURCE_ID = 'region-boundaries';
const REGION_BOUNDARY_LAYER_ID = 'region-boundary-fill';
const REGION_BOUNDARY_OUTLINE_LAYER_ID = 'region-boundary-outline';
const REGION_BOUNDARY_RADIUS_KM = 600;
const REGION_BOUNDARY_SEGMENTS = 64;
const EARTH_RADIUS_KM = 6371;

const EXCHANGE_DISPLAY_ALL = 'all';

const LAYER_VISIBILITY_DEFAULT: LayerVisibilityState = {
  realtime: true,
  history: true,
  regions: true,
};

const LATENCY_DEFAULT_VISIBILITY: LatencyVisibilityMap = {
  low: true,
  medium: true,
  high: true,
  unknown: true,
};

// Sequence of dash patterns used to animate latency lines.
const dashArraySequence: [number, number, number][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 1.5],
  [3, 4, 2],
];

const DEFAULT_EXCHANGE_ID = EXCHANGE_LOCATIONS[0]?.id ?? '';
const DEFAULT_REGION_ID = CLOUD_REGIONS[0]?.id ?? '';

export default function ExchangeMap() {
  // Mapbox artefacts we must clean up manually.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const exchangeMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const regionMarkersRef = useRef<RegionMarkerEntry[]>([]);
  const dashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [latencySnapshots, setLatencySnapshots] = useState<
    Record<string, LatencySnapshot>
  >({});
  const [latencyError, setLatencyError] = useState<string | null>(null);
  const [visibleProviders, setVisibleProviders] = useState<ProviderVisibilityMap>(
    {
      AWS: true,
      GCP: true,
      Azure: true,
    }
  );
  const [layerVisibility, setLayerVisibility] =
    useState<LayerVisibilityState>(LAYER_VISIBILITY_DEFAULT);
  const [displayExchangeFilter, setDisplayExchangeFilter] =
    useState<string>(EXCHANGE_DISPLAY_ALL);
  const [latencyFilters, setLatencyFilters] =
    useState<LatencyVisibilityMap>(LATENCY_DEFAULT_VISIBILITY);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExchange, setSelectedExchange] = useState<string>(
    DEFAULT_EXCHANGE_ID || EXCHANGE_LOCATIONS[0]?.id || ''
  );
  const [selectedRegion, setSelectedRegion] = useState<string>(
    DEFAULT_REGION_ID || CLOUD_REGIONS[0]?.id || ''
  );
  const [selectedRange, setSelectedRange] =
    useState<TimeRangeKey>('24h');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPoints, setHistoryPoints] = useState<LatencyHistoryPoint[]>([]);
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [historyQueriedAt, setHistoryQueriedAt] = useState<string | null>(null);
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const visibleProvidersRef = useRef(visibleProviders);
  const exchangeFilterRef = useRef(displayExchangeFilter);
  const latencyFiltersRef = useRef(latencyFilters);
  const layerVisibilityRef = useRef(layerVisibility);

  // Derive the freshest timestamp so the legend can display "Updated HH:MM:SS".
  const lastUpdated = useMemo(() => {
    const values = Object.values(latencySnapshots);
    if (!values.length) {
      return null;
    }
    return values
      .map((entry) => entry.capturedAt)
      .sort()
      .reverse()[0];
  }, [latencySnapshots]);

  useEffect(() => {
    if (!selectedExchange && EXCHANGE_LOCATIONS.length > 0) {
      setSelectedExchange(EXCHANGE_LOCATIONS[0].id);
    }
  }, [selectedExchange]);

  useEffect(() => {
    visibleProvidersRef.current = visibleProviders;
  }, [visibleProviders]);

  useEffect(() => {
    exchangeFilterRef.current = displayExchangeFilter;
  }, [displayExchangeFilter]);

  useEffect(() => {
    latencyFiltersRef.current = latencyFilters;
  }, [latencyFilters]);

  useEffect(() => {
    layerVisibilityRef.current = layerVisibility;
  }, [layerVisibility]);

  useEffect(() => {
    const current = CLOUD_REGIONS.find((entry) => entry.id === selectedRegion);
    if (current && visibleProviders[current.provider]) {
      return;
    }

    const fallback = CLOUD_REGIONS.find(
      (entry) => visibleProviders[entry.provider]
    );
    if (fallback?.id && fallback.id !== selectedRegion) {
      setSelectedRegion(fallback.id);
    }
    if (!fallback && selectedRegion) {
      setSelectedRegion('');
    }
  }, [selectedRegion, visibleProviders]);

  const exchangeOptions = useMemo(
    () =>
      EXCHANGE_LOCATIONS.map((exchange) => ({
        id: exchange.id,
        label: `${exchange.name} • ${exchange.city}`,
      })),
    []
  );

  const exchangeFilterOptions = useMemo(
    () => [
      { id: EXCHANGE_DISPLAY_ALL, label: 'All Exchanges' },
      ...exchangeOptions,
    ],
    [exchangeOptions]
  );

  const regionOptions = useMemo(
    () =>
      CLOUD_REGIONS.filter((region) => visibleProviders[region.provider]).map(
        (region) => ({
          id: region.id,
          label: `${region.name} • ${region.city}`,
        })
      ),
    [visibleProviders]
  );

  const formattedHistoryQueriedAt = useMemo(() => {
    if (!historyQueriedAt) {
      return null;
    }
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(historyQueriedAt));
  }, [historyQueriedAt]);

  const toggleProviderVisibility = useCallback((provider: CloudProvider) => {
    setVisibleProviders((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  }, []);

  const selectedRegionDetails = useMemo(
    () =>
      CLOUD_REGIONS.find((region) => region.id === selectedRegion) ?? null,
    [selectedRegion]
  );

  const searchResults = useMemo<SearchResult[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }
    const exchangeMatches: SearchResult[] = EXCHANGE_LOCATIONS.filter(
      (exchange) =>
        exchange.name.toLowerCase().includes(query) ||
        exchange.city.toLowerCase().includes(query) ||
        exchange.id.toLowerCase().includes(query)
    ).map((exchange) => ({
      id: exchange.id,
      label: exchange.name,
      type: 'exchange',
      provider: exchange.provider,
      coordinates: exchange.coordinates,
      meta: `${exchange.city}, ${exchange.country}`,
      disabled: false,
    }));

    const regionMatches: SearchResult[] = CLOUD_REGIONS.filter(
      (region) =>
        region.name.toLowerCase().includes(query) ||
        region.city.toLowerCase().includes(query) ||
        region.regionCode.toLowerCase().includes(query)
    ).map((region) => ({
      id: region.id,
      label: region.name,
      type: 'region',
      provider: region.provider,
      coordinates: region.coordinates,
      meta: `${region.city}, ${region.country}`,
      disabled: visibleProviders[region.provider] === false,
    }));

    return [...exchangeMatches, ...regionMatches].slice(0, 8);
  }, [searchQuery, visibleProviders]);

  const metrics = useMemo<PerformanceMetrics>(() => {
    const snapshots = Object.values(latencySnapshots);
    const activeSamples = snapshots
      .map((entry) => entry.latencyIdle)
      .filter((value): value is number => typeof value === 'number');
    const averageLatency =
      activeSamples.reduce((sum, value) => sum + value, 0) /
      (activeSamples.length || 1);
    const maxLatency = activeSamples.length
      ? Math.max(...activeSamples)
      : null;
    const minLatency = activeSamples.length
      ? Math.min(...activeSamples)
      : null;
    const visibleRegionCount = CLOUD_REGIONS.filter(
      (region) => visibleProviders[region.provider]
    ).length;
    return {
      sampleCount: snapshots.length,
      averageLatency:
        Number.isFinite(averageLatency) && activeSamples.length
          ? averageLatency
          : null,
      maxLatency,
      minLatency,
      visibleRegionCount,
      status: latencyError
        ? 'Degraded'
        : layerVisibility.realtime
        ? 'Operational'
        : 'Paused',
    };
  }, [latencySnapshots, latencyError, layerVisibility.realtime, visibleProviders]);

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      if (result.disabled) {
        return;
      }
      setSearchQuery('');
      if (result.type === 'exchange') {
        setSelectedExchange(result.id);
        setDisplayExchangeFilter(result.id);
        const exchange = EXCHANGE_LOCATIONS.find(
          (entry) => entry.id === result.id
        );
        if (exchange && mapRef.current) {
          mapRef.current.flyTo({
            center: exchange.coordinates,
            zoom: 4.5,
            pitch: 55,
            bearing: mapRef.current.getBearing(),
            duration: 1400,
            essential: true,
          });
        }
      } else {
        setSelectedRegion(result.id);
        const region = CLOUD_REGIONS.find((entry) => entry.id === result.id);
        if (region && mapRef.current) {
          mapRef.current.flyTo({
            center: region.coordinates,
            zoom: 4,
            pitch: 50,
            bearing: mapRef.current.getBearing(),
            duration: 1400,
            essential: true,
          });
        }
      }
    },
    []
  );

  const toggleLatencyFilter = useCallback((status: LatencyStatus) => {
    setLatencyFilters((prev) => {
      const next = { ...prev, [status]: !prev[status] };
      const hasActive = Object.values(next).some(Boolean);
      if (!hasActive) {
        return prev;
      }
      return next;
    });
  }, []);

  const toggleLayerVisibility = useCallback(
    (layer: keyof LayerVisibilityState) => {
      setLayerVisibility((prev) => ({
        ...prev,
        [layer]: !prev[layer],
      }));
    },
    []
  );

  useEffect(() => {
    // Initialise Mapbox once we have a DOM node and token.
    if (!containerRef.current || mapRef.current) {
      return;
    }

    if (!accessToken) {
      return;
    }

    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      projection: 'globe',
      center: [10, 20],
      zoom: 1.25,
      pitch: 45,
      bearing: -35,
      antialias: true,
      attributionControl: false,
    });

    mapRef.current = map;
    popupRef.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnMove: true,
      offset: 18,
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }));
    map.addControl(new mapboxgl.FullscreenControl());
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 160, unit: 'metric' }));

    const handleStyleLoad = () => {
      // Post-style enhancements: fog, terrain, atmosphere.
      map.setFog({
        range: [0.8, 8],
        'horizon-blend': 0.4,
        color: '#161b33',
        'high-color': '#3f87a6',
        'space-color': '#000000',
        'star-intensity': 0.5,
      });

      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.3 });
      }

      if (!map.getLayer('sky')) {
        map.addLayer({
          id: 'sky',
          type: 'sky',
          paint: {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 0.0],
            'sky-atmosphere-sun-intensity': 15,
          },
        });
      }
    };

    const handleLoad = () => {
      map.addSource(REGION_BOUNDARY_SOURCE_ID, {
        type: 'geojson',
        data: toRegionBoundaryCollection(visibleProvidersRef.current),
      });

      map.addLayer({
        id: REGION_BOUNDARY_LAYER_ID,
        type: 'fill',
        source: REGION_BOUNDARY_SOURCE_ID,
        paint: {
          'fill-color': ['get', 'fillColor'],
          'fill-opacity': ['get', 'fillOpacity'],
        },
      });

      map.addLayer({
        id: REGION_BOUNDARY_OUTLINE_LAYER_ID,
        type: 'line',
        source: REGION_BOUNDARY_SOURCE_ID,
        paint: {
          'line-color': ['get', 'strokeColor'],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            0.2,
            4,
            0.8,
            8,
            1.6,
          ],
          'line-dasharray': [2, 2],
          'line-opacity': 0.9,
        },
      });

      const boundaryEnter = (event: mapboxgl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = event.features?.[0];
        if (!feature || !popupRef.current) {
          return;
        }
        const properties = feature.properties as
          | {
              regionName?: string;
              provider?: CloudProvider;
              regionCode?: string;
              serverCount?: number;
            }
          | undefined;
        popupRef.current
          .setLngLat(event.lngLat)
          .setHTML(
            `<div class="latency-popup">
              <h3>${properties?.regionName ?? 'Region'}</h3>
              <p>${properties?.provider ?? ''} • ${properties?.regionCode ?? ''}</p>
              <span class="latency-chip latency-low">${properties?.serverCount ?? 0} servers</span>
            </div>`
          )
          .addTo(map);
      };

      const boundaryLeave = () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      };

      const boundaryClick = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }
        const properties = feature.properties as
          | {
              regionId?: string;
            }
          | undefined;
        if (properties?.regionId) {
          setSelectedRegion(properties.regionId);
          const region = CLOUD_REGIONS.find(
            (entry) => entry.id === properties.regionId
          );
          if (region) {
            map.flyTo({
              center: region.coordinates,
              zoom: Math.max(map.getZoom(), 3.4),
              pitch: 50,
              bearing: map.getBearing(),
              duration: 1600,
              essential: true,
            });
          }
        }
      };

      map.on('mouseenter', REGION_BOUNDARY_LAYER_ID, boundaryEnter);
      map.on('mouseleave', REGION_BOUNDARY_LAYER_ID, boundaryLeave);
      map.on('click', REGION_BOUNDARY_LAYER_ID, boundaryClick);

      // Latency source & layers
      map.addSource(CONNECTION_SOURCE_ID, {
        type: 'geojson',
        data: toFeatureCollection({}, {
          providerVisibility: visibleProvidersRef.current,
          exchangeFilter: exchangeFilterRef.current,
          allowedStatuses: latencyFiltersRef.current,
          realtimeEnabled: layerVisibilityRef.current.realtime,
        }),
      });

      map.addLayer({
        id: CONNECTION_LAYER_ID,
        type: 'line',
        source: CONNECTION_SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 0.4,
            2, 1.4,
            5, 3,
            8, 6,
          ],
          'line-color': ['get', 'color'],
          'line-opacity': [
            'case',
            ['==', ['get', 'status'], 'unknown'],
            0.25,
            0.85,
          ],
          'line-dasharray': [0, 2, 1],
        },
      });

      map.addLayer({
        id: CONNECTION_LABEL_LAYER_ID,
        type: 'symbol',
        source: CONNECTION_SOURCE_ID,
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'case',
            ['!', ['has', 'latencyLabel']],
            '',
            ['get', 'latencyLabel'],
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 9,
            4, 11,
            8, 13,
          ],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
          'text-keep-upright': true,
          'text-offset': [0, 0.35],
          'text-optional': true,
        },
        paint: {
          'text-color': '#e2e8f0',
          'text-halo-color': 'rgba(15, 23, 42, 0.85)',
          'text-halo-width': 1.2,
        },
      });

      const lineEnter = (event: mapboxgl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = event.features?.[0] as
          | mapboxgl.MapboxGeoJSONFeature
          | undefined;
        if (
          !feature ||
          feature.geometry.type !== 'LineString' ||
          !popupRef.current
        ) {
          return;
        }

        const properties = feature.properties as
          | {
              exchangeName: string;
              regionName: string;
              provider: CloudProvider;
              latencyLabel?: string;
              status: LatencyStatus;
              regionCode?: string;
              serverCount?: number;
            }
          | undefined;

        const latencyLabel = properties?.latencyLabel ?? 'Latency unavailable';
        popupRef.current
          .setLngLat(event.lngLat)
          .setHTML(
            `<div class="latency-popup">
              <h3>${properties?.exchangeName ?? 'Exchange'}</h3>
              <p>${properties?.regionName ?? 'Region'} • ${properties?.provider ?? ''}</p>
              <p style="font-size:0.75rem;color:rgba(148,163,184,0.9);margin:0.15rem 0 0;">
                ${properties?.regionCode ?? ''} • ${properties?.serverCount ?? 0} servers
              </p>
              <span class="latency-chip latency-${properties?.status ?? 'unknown'}">${latencyLabel}</span>
            </div>`
          )
          .addTo(map);
      };

      const lineLeave = () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      };

      const lineClick = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0] as
          | mapboxgl.MapboxGeoJSONFeature
          | undefined;
        if (!feature || feature.geometry.type !== 'LineString') {
          return;
        }

        const properties = feature.properties as
          | {
              exchangeId?: string;
              regionId?: string;
            }
          | undefined;

        if (properties?.exchangeId) {
          setSelectedExchange(properties.exchangeId);
        }
        if (properties?.regionId) {
          setSelectedRegion(properties.regionId);
        }

        const lineCoordinates = feature.geometry
          .coordinates as [number, number][];
        if (Array.isArray(lineCoordinates) && lineCoordinates.length) {
          const midpoint =
            lineCoordinates[Math.floor(lineCoordinates.length / 2)];
          map.flyTo({
            center: midpoint,
            zoom: Math.max(map.getZoom(), 2.6),
            pitch: 50,
            bearing: map.getBearing(),
            duration: 1400,
            essential: true,
          });
        }
      };

      map.on('mouseenter', CONNECTION_LAYER_ID, lineEnter);
      map.on('mouseleave', CONNECTION_LAYER_ID, lineLeave);
      map.on('click', CONNECTION_LAYER_ID, lineClick);
      let dashIndex = 0;
      dashIntervalRef.current = setInterval(() => {
        if (!map.getLayer(CONNECTION_LAYER_ID)) {
          return;
        }
        map.setPaintProperty(
          CONNECTION_LAYER_ID,
          'line-dasharray',
          dashArraySequence[dashIndex]
        );
        dashIndex = (dashIndex + 1) % dashArraySequence.length;
      }, 120);

      exchangeMarkersRef.current = EXCHANGE_LOCATIONS.map((exchange) => {
        const el = document.createElement('div');
        el.className = 'exchange-marker';
        el.style.setProperty('--marker-color', PROVIDER_COLORS[exchange.provider]);
        el.dataset.exchangeId = exchange.id;

        const marker = new mapboxgl.Marker({
          element: el,
          anchor: 'bottom',
        })
          .setLngLat(exchange.coordinates)
          .addTo(map);

        el.addEventListener('mouseenter', () => {
          popupRef.current
            ?.setLngLat(exchange.coordinates)
            .setHTML(
              `<div class="marker-popup">
                <h3>${exchange.name}</h3>
                <p>${exchange.city}, ${exchange.country}</p>
                <span class="badge">${exchange.provider}</span>
              </div>`
            )
            .addTo(map);
        });

        el.addEventListener('mouseleave', () => {
          popupRef.current?.remove();
        });

        el.addEventListener('click', () => {
          setSelectedExchange(exchange.id);
          map.flyTo({
            center: exchange.coordinates,
            zoom: 4.2,
            pitch: 55,
            bearing: map.getBearing() + 12,
            duration: 1800,
            essential: true,
          });
          popupRef.current
            ?.setLngLat(exchange.coordinates)
            .setHTML(
              `<div class="marker-popup">
                <h3>${exchange.name}</h3>
                <p>${exchange.city}, ${exchange.country}</p>
                <span class="badge">${exchange.provider}</span>
              </div>`
            )
            .addTo(map);
        });

        return marker;
      });

      regionMarkersRef.current = CLOUD_REGIONS.map((region) => {
        const el = document.createElement('div');
        el.className = 'cloud-region-marker';
        el.style.setProperty('--marker-color', PROVIDER_COLORS[region.provider]);
        el.dataset.regionId = region.id;
        el.dataset.provider = region.provider;
        el.style.display = visibleProvidersRef.current[region.provider] ? '' : 'none';

        const marker = new mapboxgl.Marker({
          element: el,
          anchor: 'center',
        })
          .setLngLat(region.coordinates)
          .addTo(map);

        el.addEventListener('mouseenter', () => {
          popupRef.current
            ?.setLngLat(region.coordinates)
            .setHTML(
              `<div class="marker-popup">
                <h3>${region.name}</h3>
                <p>${region.city}, ${region.country}</p>
                <p style="font-size:0.75rem;color:rgba(148,163,184,0.9);margin:0.15rem 0 0;">
                  ${region.regionCode.toUpperCase()} • ${region.serverCount} servers
                </p>
                <span class="badge">${region.provider}</span>
              </div>`
            )
            .addTo(map);
        });

        el.addEventListener('mouseleave', () => {
          popupRef.current?.remove();
        });

        el.addEventListener('click', () => {
          setSelectedRegion(region.id);
          map.flyTo({
            center: region.coordinates,
            zoom: 3.6,
            pitch: 50,
            bearing: map.getBearing(),
            duration: 1400,
            essential: true,
          });
          popupRef.current
            ?.setLngLat(region.coordinates)
            .setHTML(
              `<div class="marker-popup">
                <h3>${region.name}</h3>
                <p>${region.city}, ${region.country}</p>
                <p style="font-size:0.75rem;color:rgba(148,163,184,0.9);margin:0.15rem 0 0;">
                  ${region.regionCode.toUpperCase()} • ${region.serverCount} servers
                </p>
                <span class="badge">${region.provider}</span>
              </div>`
            )
            .addTo(map);
        });

        return { marker, region, element: el };
      });

      map.on('remove', () => {
        map.off('mouseenter', CONNECTION_LAYER_ID, lineEnter);
        map.off('mouseleave', CONNECTION_LAYER_ID, lineLeave);
        map.off('click', CONNECTION_LAYER_ID, lineClick);
        map.off('mouseenter', REGION_BOUNDARY_LAYER_ID, boundaryEnter);
        map.off('mouseleave', REGION_BOUNDARY_LAYER_ID, boundaryLeave);
        map.off('click', REGION_BOUNDARY_LAYER_ID, boundaryClick);
        if (dashIntervalRef.current) {
          clearInterval(dashIntervalRef.current);
          dashIntervalRef.current = null;
        }
      });
    };

    map.on('style.load', handleStyleLoad);
    map.on('load', handleLoad);

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      if (dashIntervalRef.current) {
        clearInterval(dashIntervalRef.current);
        dashIntervalRef.current = null;
      }
      exchangeMarkersRef.current.forEach((marker) => marker.remove());
      regionMarkersRef.current.forEach(({ marker }) => marker.remove());
      popupRef.current?.remove();
      map.off('style.load', handleStyleLoad);
      map.off('load', handleLoad);
      map.remove();
      window.removeEventListener('resize', handleResize);
    };
  }, [accessToken]);

  useEffect(() => {
    // Whenever latency snapshots or filters change, refresh the geojson source.
    if (!mapRef.current) {
      return;
    }
    const source = mapRef.current.getSource(CONNECTION_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;
    if (!source) {
      return;
    }
    source.setData(
      toFeatureCollection(latencySnapshots, {
        providerVisibility: visibleProviders,
        exchangeFilter: displayExchangeFilter,
        allowedStatuses: latencyFilters,
        realtimeEnabled: layerVisibility.realtime,
      })
    );
  }, [
    latencySnapshots,
    visibleProviders,
    displayExchangeFilter,
    latencyFilters,
    layerVisibility.realtime,
  ]);

  useEffect(() => {
    // Poll Cloudflare Radar via our API every 10 seconds.
    const desiredRegionIds = CLOUD_REGIONS.map((region) => region.id);

    let isCancelled = false;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    const pullLatency = async () => {
      try {
        const params = new URLSearchParams({
          regions: desiredRegionIds.join(','),
        });
        const response = await fetch(`/api/latency?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          const errorPayload = await response.json().catch(() => null);
          throw new Error(errorPayload?.message ?? 'Cloudflare latency service unavailable');
        }
        const payload: {
          data: LatencySnapshot[];
        } = await response.json();
        if (isCancelled) {
          return;
        }
        const next: Record<string, LatencySnapshot> = {};
        payload.data.forEach((entry) => {
          next[entry.regionId] = entry;
        });
        setLatencySnapshots(next);
        setLatencyError(null);
      } catch (error) {
        if (isCancelled) {
          return;
        }
        setLatencyError(
          error instanceof Error ? error.message : 'Unable to refresh latency'
        );
      }
    };

    pullLatency();
    refreshTimer = setInterval(pullLatency, 10000);

    return () => {
      isCancelled = true;
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      const boundarySource = mapRef.current.getSource(
        REGION_BOUNDARY_SOURCE_ID
      ) as mapboxgl.GeoJSONSource | undefined;
      if (boundarySource) {
        boundarySource.setData(toRegionBoundaryCollection(visibleProviders));
      }
    }

    regionMarkersRef.current.forEach(({ element, region }) => {
      const shouldShow =
        layerVisibility.regions && visibleProviders[region.provider];
      element.style.display = shouldShow ? '' : 'none';
    });
  }, [visibleProviders, layerVisibility.regions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const realtimeVisibility = layerVisibility.realtime ? 'visible' : 'none';
    if (map.getLayer(CONNECTION_LAYER_ID)) {
      map.setLayoutProperty(CONNECTION_LAYER_ID, 'visibility', realtimeVisibility);
    }
    if (map.getLayer(CONNECTION_LABEL_LAYER_ID)) {
      map.setLayoutProperty(
        CONNECTION_LABEL_LAYER_ID,
        'visibility',
        realtimeVisibility
      );
    }
    const regionVisibility = layerVisibility.regions ? 'visible' : 'none';
    if (map.getLayer(REGION_BOUNDARY_LAYER_ID)) {
      map.setLayoutProperty(
        REGION_BOUNDARY_LAYER_ID,
        'visibility',
        regionVisibility
      );
    }
    if (map.getLayer(REGION_BOUNDARY_OUTLINE_LAYER_ID)) {
      map.setLayoutProperty(
        REGION_BOUNDARY_OUTLINE_LAYER_ID,
        'visibility',
        regionVisibility
      );
    }
  }, [layerVisibility.realtime, layerVisibility.regions]);

  useEffect(() => {
    if (!layerVisibility.history) {
      setHistoryPoints([]);
      setHistoryStats(null);
      setHistoryLoading(false);
      setHistoryError(null);
      return;
    }
    if (!selectedRegion) {
      setHistoryPoints([]);
      setHistoryStats(null);
      return;
    }

    const controller = new AbortController();

    const fetchHistory = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const params = new URLSearchParams({
          region: selectedRegion,
          range: selectedRange,
          exchange: selectedExchange,
        });

        const response = await fetch(
          `/api/latency/history?${params.toString()}`,
          {
            cache: 'no-store',
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          const errorPayload = await response.json().catch(() => null);
          throw new Error(
            errorPayload?.message ?? 'Unable to load latency history'
          );
        }

        const payload: {
          points?: LatencyHistoryPoint[];
          stats?: HistoryStats | null;
          queriedAt?: string | null;
        } = await response.json();

        if (controller.signal.aborted) {
          return;
        }

        setHistoryPoints(payload.points ?? []);
        setHistoryStats(payload.stats ?? null);
        setHistoryQueriedAt(payload.queriedAt ?? new Date().toISOString());
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setHistoryError(
          error instanceof Error
            ? error.message
            : 'Unable to load latency history'
        );
      } finally {
        if (!controller.signal.aborted) {
          setHistoryLoading(false);
        }
      }
    };

    fetchHistory();

    return () => {
      controller.abort();
    };
  }, [selectedExchange, selectedRegion, selectedRange, layerVisibility.history]);

  return (
    <div className="relative flex h-[calc(100vh-0px)] w-full flex-col">
      <div ref={containerRef} className="relative h-full w-full" />

      <aside className="pointer-events-none absolute top-6 left-6 flex w-[20rem] flex-col gap-4 text-sm text-white">
        <div className="pointer-events-auto rounded-xl bg-slate-900/80 p-4 shadow-lg backdrop-blur">
          <p className="text-[0.7rem] uppercase tracking-[0.3em] text-slate-400">
            Exchange Topology
          </p>
          <h2 className="mt-1 text-xl font-semibold">Global Latency Network</h2>
          <p className="mt-2 text-xs text-slate-300">
            Rotate, pan, and zoom to explore exchange co-location hubs across
            AWS, GCP, and Azure infrastructure.
          </p>
          {lastUpdated && (
            <p className="mt-3 text-[0.65rem] uppercase tracking-[0.2em] text-slate-400">
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </p>
          )}
          {latencyError && (
            <p className="mt-3 text-xs font-medium text-amber-300">
              {latencyError}
            </p>
          )}
        </div>

        <div className="pointer-events-auto rounded-xl bg-slate-900/80 p-4 shadow-lg backdrop-blur">
          <p className="text-[0.65rem] uppercase tracking-[0.35em] text-slate-500">
            Control Panel
          </p>

          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="uppercase tracking-[0.25em] text-slate-500">
                Quick Search
              </span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Exchange or region..."
                className="w-full rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400"
              />
            </label>
            {searchQuery && (
              <ul className="max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/80 text-xs text-slate-200">
                {searchResults.length === 0 && (
                  <li className="px-3 py-2 text-slate-500">No matches found</li>
                )}
                {searchResults.map((result) => (
                  <li key={`${result.type}-${result.id}`}>
                    <button
                      type="button"
                      onClick={() => handleSearchSelect(result)}
                      disabled={result.disabled}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition ${
                        result.disabled
                          ? 'cursor-not-allowed text-slate-500'
                          : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="flex flex-col">
                        <span className="font-medium text-slate-100">
                          {result.label}
                        </span>
                        <span className="text-[0.65rem] text-slate-400">
                          {result.meta}
                        </span>
                      </span>
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{
                          backgroundColor: PROVIDER_COLORS[result.provider],
                          opacity: result.disabled ? 0.4 : 1,
                        }}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label className="flex flex-col gap-1 text-xs">
              <span className="uppercase tracking-[0.25em] text-slate-500">
                Display Exchange
              </span>
              <select
                value={displayExchangeFilter}
                onChange={(event) => setDisplayExchangeFilter(event.target.value)}
                className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-slate-100 outline-none focus:border-cyan-400"
              >
                {exchangeFilterOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-2 text-xs">
              <span className="uppercase tracking-[0.25em] text-slate-500">
                Cloud Providers
              </span>
              <ul className="flex flex-col gap-2">
                {(Object.entries(PROVIDER_COLORS) as [CloudProvider, string][]).map(
                  ([provider, color]) => {
                    const isActive = visibleProviders[provider];
                    return (
                      <li key={provider} className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full transition-opacity"
                            style={{
                              backgroundColor: color,
                              opacity: isActive ? 1 : 0.3,
                            }}
                          />
                          <span className="font-medium">{provider}</span>
                        </span>
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <span className="text-[0.7rem] uppercase tracking-[0.2em] text-slate-500">
                            {isActive ? 'On' : 'Off'}
                          </span>
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={() => toggleProviderVisibility(provider)}
                            className="h-3.5 w-3.5 accent-slate-200"
                          />
                        </label>
                      </li>
                    );
                  }
                )}
              </ul>
            </div>

            <div className="flex flex-col gap-2 text-xs">
              <span className="uppercase tracking-[0.25em] text-slate-500">
                Latency Range
              </span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(LATENCY_COLORS) as LatencyStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleLatencyFilter(status)}
                    className={`rounded-full px-3 py-1 text-[0.7rem] font-medium transition ${
                      latencyFilters[status]
                        ? 'bg-slate-100 text-slate-900'
                        : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700/80'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 text-xs">
              <span className="uppercase tracking-[0.25em] text-slate-500">
                Layers
              </span>
              <ul className="flex flex-col gap-2">
                {[
                  { key: 'realtime', label: 'Real-time Latency' },
                  { key: 'history', label: 'History Panel' },
                  { key: 'regions', label: 'Region Boundaries' },
                ].map((layer) => (
                  <li key={layer.key} className="flex items-center justify-between">
                    <span className="font-medium">{layer.label}</span>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <span className="text-[0.7rem] uppercase tracking-[0.2em] text-slate-500">
                        {layerVisibility[layer.key as keyof LayerVisibilityState] ? 'On' : 'Off'}
                      </span>
                      <input
                        type="checkbox"
                        checked={layerVisibility[layer.key as keyof LayerVisibilityState]}
                        onChange={() =>
                          toggleLayerVisibility(layer.key as keyof LayerVisibilityState)
                        }
                        className="h-3.5 w-3.5 accent-slate-200"
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </aside>

      <div className="pointer-events-none absolute top-6 right-6 flex flex-col gap-4 text-sm text-white">
        <div className="pointer-events-auto rounded-xl bg-slate-900/85 p-4 shadow-xl backdrop-blur">
          <p className="text-[0.65rem] uppercase tracking-[0.35em] text-slate-500">
            Performance Snapshot
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-200">
            <MetricTile label="Status">
              <span
                className={`font-semibold ${
                  metrics.status === 'Operational'
                    ? 'text-emerald-300'
                    : metrics.status === 'Paused'
                    ? 'text-slate-300'
                    : 'text-amber-300'
                }`}
              >
                {metrics.status}
              </span>
            </MetricTile>
            <MetricTile label="Active Samples">
              <span className="font-medium text-slate-100">
                {metrics.sampleCount}
              </span>
            </MetricTile>
            <MetricTile label="Visible Regions">
              <span className="font-medium text-slate-100">
                {metrics.visibleRegionCount}
              </span>
            </MetricTile>
            <MetricTile label="Avg Latency">
              <span className="font-medium text-slate-100">
                {metrics.averageLatency !== null
                  ? `${metrics.averageLatency.toFixed(1)} ms`
                  : '—'}
              </span>
            </MetricTile>
            <MetricTile label="Min">
              <span className="font-medium text-slate-100">
                {metrics.minLatency !== null
                  ? `${metrics.minLatency.toFixed(1)} ms`
                  : '—'}
              </span>
            </MetricTile>
            <MetricTile label="Max">
              <span className="font-medium text-slate-100">
                {metrics.maxLatency !== null
                  ? `${metrics.maxLatency.toFixed(1)} ms`
                  : '—'}
              </span>
            </MetricTile>
          </div>
        </div>

        <div className="pointer-events-auto rounded-xl bg-slate-900/85 p-4 shadow-xl backdrop-blur">
          <p className="text-[0.65rem] uppercase tracking-[0.35em] text-slate-500">
            Latency Bands
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            <li className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-8 rounded-full"
                  style={{ backgroundColor: LATENCY_COLORS.low }}
                />
                <span>Low</span>
              </span>
              <span>&lt; {LATENCY_THRESHOLDS.low} ms</span>
            </li>
            <li className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-8 rounded-full"
                  style={{ backgroundColor: LATENCY_COLORS.medium }}
                />
                <span>Medium</span>
              </span>
              <span>
                {LATENCY_THRESHOLDS.low} - {LATENCY_THRESHOLDS.medium} ms
              </span>
            </li>
            <li className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-8 rounded-full"
                  style={{ backgroundColor: LATENCY_COLORS.high }}
                />
                <span>High</span>
              </span>
              <span>&gt; {LATENCY_THRESHOLDS.medium} ms</span>
            </li>
          </ul>
        </div>
      </div>

      {selectedRegionDetails && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 w-[22rem] -translate-x-1/2 text-sm text-white">
          <div className="pointer-events-auto rounded-2xl bg-slate-900/85 p-4 text-slate-200 shadow-2xl backdrop-blur">
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-slate-500 text-center">
              Region Details
            </p>
            <h3 className="mt-2 text-lg font-semibold text-center">
              {selectedRegionDetails.name}
            </h3>
            <p className="mt-1 text-xs text-center text-slate-300">
              {selectedRegionDetails.city}, {selectedRegionDetails.country}
            </p>
            <ul className="mt-4 grid grid-cols-3 gap-3 text-xs text-slate-300">
              <li className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                <span className="text-[0.55rem] uppercase tracking-[0.3em] text-slate-500">
                  Provider
                </span>
                <span className="font-medium text-slate-100">
                  {selectedRegionDetails.provider}
                </span>
              </li>
              <li className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                <span className="text-[0.55rem] uppercase tracking-[0.3em] text-slate-500">
                  Region
                </span>
                <span className="font-medium text-slate-100">
                  {selectedRegionDetails.regionCode}
                </span>
              </li>
              <li className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                <span className="text-[0.55rem] uppercase tracking-[0.3em] text-slate-500">
                  Servers
                </span>
                <span className="font-medium text-slate-100">
                  {selectedRegionDetails.serverCount}
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {layerVisibility.history && (
        <div className="pointer-events-none absolute bottom-6 right-6 max-w-lg text-white">
          <LatencyHistoryPanel
            exchangeOptions={exchangeOptions}
            regionOptions={regionOptions}
            selectedExchange={selectedExchange}
            onSelectExchange={setSelectedExchange}
            selectedRegion={selectedRegion}
            onSelectRegion={setSelectedRegion}
            selectedRange={selectedRange}
            onSelectRange={setSelectedRange}
            history={historyPoints}
            stats={historyStats}
            loading={historyLoading}
            error={historyError}
            lastUpdatedLabel={formattedHistoryQueriedAt}
          />
        </div>
      )}

      {!accessToken && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/80">
          <div className="pointer-events-auto max-w-md rounded-xl border border-white/10 bg-slate-900/80 p-6 text-center text-slate-200 shadow-xl backdrop-blur">
            <p className="text-lg font-semibold">Mapbox token required</p>
            <p className="mt-2 text-sm text-slate-300">
              Provide a valid `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` in an `.env.local`
              file to activate the interactive globe.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function getLatencyStatus(value: number | null): LatencyStatus {
  // Map raw millisecond values to qualitative buckets for colouring.
  if (value === null || Number.isNaN(value)) {
    return 'unknown';
  }
  if (value <= LATENCY_THRESHOLDS.low) {
    return 'low';
  }
  if (value <= LATENCY_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'high';
}

/**
 * Convert the latest latency snapshots into a GeoJSON FeatureCollection understood by Mapbox.
 */
function toFeatureCollection(
  latencyByRegion: Record<string, LatencySnapshot | undefined>,
  config: FeatureCollectionConfig = {}
): FeatureCollection<LineString> {
  if (config.realtimeEnabled === false) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }
  const features: Feature<LineString>[] = [];

  CLOUD_REGIONS.forEach((region) => {
    if (
      config.providerVisibility &&
      config.providerVisibility[region.provider] === false
    ) {
      return;
    }
    // Look up the most recent latency for this region (if Cloudflare provided one).
    const latencySnapshot = latencyByRegion[region.id];
    const latencyValue =
      typeof latencySnapshot?.latencyIdle === 'number'
        ? Number(latencySnapshot.latencyIdle.toFixed(1))
        : null;
    const status = getLatencyStatus(latencyValue);
    const color = LATENCY_COLORS[status];
    const latencyLabel =
      latencyValue !== null ? `${latencyValue.toFixed(1)} ms` : undefined;
    if (config.allowedStatuses && !config.allowedStatuses[status]) {
      return;
    }

    EXCHANGE_LOCATIONS.forEach((exchange) => {
      if (
        config.exchangeFilter &&
        config.exchangeFilter !== EXCHANGE_DISPLAY_ALL &&
        exchange.id !== config.exchangeFilter
      ) {
        return;
      }
      // Each exchange-region pair becomes one animated line on the globe.
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [region.coordinates, exchange.coordinates],
        },
        properties: {
          id: `${region.id}-${exchange.id}`,
          exchangeId: exchange.id,
          regionId: region.id,
          exchangeName: exchange.name,
          regionName: region.name,
          provider: region.provider,
          latency: latencyValue,
          latencyLabel,
          status,
          color,
          serverCount: region.serverCount,
          regionCode: region.regionCode,
        },
      });
    });
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

function toRegionBoundaryCollection(
  providerVisibility: ProviderVisibilityMap,
  radiusKm: number = REGION_BOUNDARY_RADIUS_KM
): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];

  CLOUD_REGIONS.forEach((region) => {
    if (providerVisibility[region.provider] === false) {
      return;
    }
    const coordinates = generateCircleCoordinates(
      region.coordinates,
      radiusKm,
      REGION_BOUNDARY_SEGMENTS
    );

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates],
      },
      properties: {
        id: region.id,
        regionId: region.id,
        regionName: region.name,
        provider: region.provider,
        regionCode: region.regionCode,
        serverCount: region.serverCount,
        fillColor: PROVIDER_FILL_COLORS[region.provider],
        strokeColor: PROVIDER_COLORS[region.provider],
        fillOpacity: 0.22,
      },
    });
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

function generateCircleCoordinates(
  [centerLng, centerLat]: [number, number],
  radiusKm: number,
  steps: number
): [number, number][] {
  const coordinates: [number, number][] = [];
  const centerLatRad = (centerLat * Math.PI) / 180;
  const centerLngRad = (centerLng * Math.PI) / 180;
  const angularDistance = radiusKm / EARTH_RADIUS_KM;

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (2 * Math.PI * i) / steps;
    const pointLat = Math.asin(
      Math.sin(centerLatRad) * Math.cos(angularDistance) +
        Math.cos(centerLatRad) *
          Math.sin(angularDistance) *
          Math.cos(bearing)
    );
    const pointLng =
      centerLngRad +
      Math.atan2(
        Math.sin(bearing) *
          Math.sin(angularDistance) *
          Math.cos(centerLatRad),
        Math.cos(angularDistance) -
          Math.sin(centerLatRad) * Math.sin(pointLat)
      );

    const lngDeg = ((pointLng * 180) / Math.PI + 540) % 360 - 180;
    const latDeg = (pointLat * 180) / Math.PI;
    coordinates.push([lngDeg, latDeg]);
  }

  return coordinates;
}


function handleResize() {
  // Keep CSS custom properties in sync so overlays can size themselves responsively.
  const root = document.documentElement;
  const width = root.clientWidth;
  const height = root.clientHeight;
  root.style.setProperty('--viewport-width', `${width}px`);
  root.style.setProperty('--viewport-height', `${height}px`);
}

type MetricTileProps = {
  label: string;
  children: React.ReactNode;
};

function MetricTile({ label, children }: MetricTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
      <span className="text-[0.6rem] uppercase tracking-[0.35em] text-slate-500">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

