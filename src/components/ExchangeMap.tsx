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

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  CLOUD_REGIONS,
  EXCHANGE_LOCATIONS,
  type CloudProvider,
  type CloudRegion,
  type ExchangeLocation,
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
  const regionMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const dashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [latencySnapshots, setLatencySnapshots] = useState<
    Record<string, LatencySnapshot>
  >({});
  const [latencyError, setLatencyError] = useState<string | null>(null);
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
    if (!selectedRegion && CLOUD_REGIONS.length > 0) {
      setSelectedRegion(CLOUD_REGIONS[0].id);
    }
  }, [selectedRegion]);

  const exchangeOptions = useMemo(
    () =>
      EXCHANGE_LOCATIONS.map((exchange) => ({
        id: exchange.id,
        label: `${exchange.name} • ${exchange.city}`,
      })),
    []
  );

  const regionOptions = useMemo(
    () =>
      CLOUD_REGIONS.map((region) => ({
        id: region.id,
        label: `${region.name} • ${region.city}`,
      })),
    []
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
      // Latency source & layers
      map.addSource(CONNECTION_SOURCE_ID, {
        type: 'geojson',
        data: toFeatureCollection({}),
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
            }
          | undefined;

        const latencyLabel = properties?.latencyLabel ?? 'Latency unavailable';
        popupRef.current
          .setLngLat(event.lngLat)
          .setHTML(
            `<div class="latency-popup">
              <h3>${properties?.exchangeName ?? 'Exchange'}</h3>
              <p>${properties?.regionName ?? 'Region'} • ${properties?.provider ?? ''}</p>
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
        });

        return marker;
      });

      map.on('remove', () => {
        map.off('mouseenter', CONNECTION_LAYER_ID, lineEnter);
        map.off('mouseleave', CONNECTION_LAYER_ID, lineLeave);
        map.off('click', CONNECTION_LAYER_ID, lineClick);
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
      regionMarkersRef.current.forEach((marker) => marker.remove());
      popupRef.current?.remove();
      map.off('style.load', handleStyleLoad);
      map.off('load', handleLoad);
      map.remove();
      window.removeEventListener('resize', handleResize);
    };
  }, [accessToken]);

  useEffect(() => {
    // Whenever latency snapshots change, refresh the geojson source.
    if (!mapRef.current) {
      return;
    }
    const source = mapRef.current.getSource(CONNECTION_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;
    if (!source) {
      return;
    }
    source.setData(toFeatureCollection(latencySnapshots));
  }, [latencySnapshots]);

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
  }, [selectedExchange, selectedRegion, selectedRange]);

  return (
    <div className="relative flex h-[calc(100vh-0px)] w-full flex-col">
      <div ref={containerRef} className="relative h-full w-full" />

      <aside className="pointer-events-none absolute top-6 left-6 flex max-w-xs flex-col gap-4 text-sm text-white">
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
            Cloud Providers
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {Object.entries(PROVIDER_COLORS).map(([provider, color]) => (
              <li key={provider} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs font-medium">{provider}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pointer-events-auto rounded-xl bg-slate-900/80 p-4 shadow-lg backdrop-blur">
          <p className="text-[0.65rem] uppercase tracking-[0.35em] text-slate-500">
            Latency Ranges
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
              <span>{LATENCY_THRESHOLDS.low} - {LATENCY_THRESHOLDS.medium} ms</span>
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

      </aside>

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
  latencyByRegion: Record<string, LatencySnapshot | undefined>
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];

  CLOUD_REGIONS.forEach((region) => {
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

    EXCHANGE_LOCATIONS.forEach((exchange) => {
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
        },
      });
    });
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}


function handleResize() {
  // Keep CSS custom properties in sync so overlays can size themselves responsively.
  const root = document.documentElement;
  const width = root.clientWidth;
  const height = root.clientHeight;
  root.style.setProperty('--viewport-width', `${width}px`);
  root.style.setProperty('--viewport-height', `${height}px`);
}

