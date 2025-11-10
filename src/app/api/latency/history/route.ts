import { NextRequest } from 'next/server';
import { CLOUD_REGIONS } from '@/data/network';
import type { HistoryStats, LatencyHistoryPoint, TimeRangeKey } from '@/types/latency';

const TIME_RANGE_TO_DURATION: Record<TimeRangeKey, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const CLOUD_FLARE_IQI_ENDPOINT =
  'https://api.cloudflare.com/client/v4/radar/quality/iqi/timeseries_groups';

export async function GET(request: NextRequest) {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!apiToken) {
    return Response.json(
      { message: 'Cloudflare API token not configured.' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const regionId = searchParams.get('region') ?? '';
  const rangeParam = (searchParams.get('range') as TimeRangeKey) ?? '24h';

  const region = CLOUD_REGIONS.find((item) => item.id === regionId);
  if (!region) {
    return Response.json(
      { message: 'Unknown region identifier supplied.' },
      { status: 400 }
    );
  }

  const duration =
    TIME_RANGE_TO_DURATION[rangeParam] ?? TIME_RANGE_TO_DURATION['24h'];
  const dateEnd = new Date();
  const dateStart = new Date(dateEnd.getTime() - duration);

  const url = new URL(CLOUD_FLARE_IQI_ENDPOINT);
  url.searchParams.set('metrics', 'latency_idle,latency_loaded,jitter_idle');
  url.searchParams.set('location', region.countryCode);
  url.searchParams.set('dateStart', dateStart.toISOString());
  url.searchParams.set('dateEnd', dateEnd.toISOString());
  url.searchParams.set('format', 'JSON');

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      return Response.json(
        {
          message:
            errorPayload?.errors?.[0]?.message ??
            `Cloudflare responded with ${response.status}`,
        },
        { status: response.status }
      );
    }

    const payload = (await response.json()) as {
      result?: unknown;
    };

    const points = extractHistoryPoints(payload);
    const stats = computeHistoryStats(points);

    return Response.json(
      {
        points,
        stats,
        queriedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : 'Unexpected error contacting Cloudflare Radar.',
      },
      { status: 500 }
    );
  }
}

function extractHistoryPoints(payload: { result?: unknown }): LatencyHistoryPoint[] {
  const result = payload.result as
    | {
        serie_0?:
          | {
              timestamps?: unknown;
              latencyIdle?: unknown;
              latency_idle?: unknown;
              latencyLoaded?: unknown;
              latency_loaded?: unknown;
              jitterIdle?: unknown;
              jitter_idle?: unknown;
            }
          | Array<Record<string, unknown>>;
      }
    | undefined;

  if (!result) {
    return [];
  }

  const rawSerie = result.serie_0;

  if (!rawSerie) {
    return [];
  }

  if (Array.isArray(rawSerie)) {
    return rawSerie
      .map((entry) => {
        const dimensions = entry?.dimensions as
          | { datetime?: string; timestamp?: string }
          | undefined;
        const metrics = entry?.metrics as
          | {
              latencyIdle?: number | string | null;
              latencyLoaded?: number | string | null;
              jitterIdle?: number | string | null;
            }
          | undefined;
        const timestamp =
          dimensions?.datetime ??
          dimensions?.timestamp ??
          (entry?.timestamp as string | undefined);
        if (!timestamp) {
          return null;
        }
        return normalizeHistoryPoint({
          timestamp,
          latencyIdle: metrics?.latencyIdle,
          latencyLoaded: metrics?.latencyLoaded,
          jitterIdle: metrics?.jitterIdle,
        });
      })
      .filter((point): point is LatencyHistoryPoint => Boolean(point));
  }

  const timestamps = toArrayOfStrings(
    (rawSerie as { timestamps?: unknown }).timestamps
  );
  const latencyIdle = toArrayOfNumbers(
    (rawSerie as { latencyIdle?: unknown; latency_idle?: unknown })
      .latencyIdle ??
      (rawSerie as { latency_idle?: unknown }).latency_idle
  );
  const latencyLoaded = toArrayOfNumbers(
    (rawSerie as { latencyLoaded?: unknown; latency_loaded?: unknown })
      .latencyLoaded ??
      (rawSerie as { latency_loaded?: unknown }).latency_loaded
  );
  const jitterIdle = toArrayOfNumbers(
    (rawSerie as { jitterIdle?: unknown; jitter_idle?: unknown }).jitterIdle ??
      (rawSerie as { jitter_idle?: unknown }).jitter_idle
  );

  const points: LatencyHistoryPoint[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    points.push({
      timestamp: timestamps[index],
      latencyIdle:
        latencyIdle[index] !== undefined ? latencyIdle[index] ?? null : null,
      latencyLoaded:
        latencyLoaded[index] !== undefined
          ? latencyLoaded[index] ?? null
          : null,
      jitterIdle:
        jitterIdle[index] !== undefined ? jitterIdle[index] ?? null : null,
    });
  }
  return points;
}

function normalizeHistoryPoint(entry: {
  timestamp: string;
  latencyIdle?: number | string | null;
  latencyLoaded?: number | string | null;
  jitterIdle?: number | string | null;
}): LatencyHistoryPoint {
  return {
    timestamp: entry.timestamp,
    latencyIdle: parseNullableNumber(entry.latencyIdle),
    latencyLoaded: parseNullableNumber(entry.latencyLoaded),
    jitterIdle: parseNullableNumber(entry.jitterIdle),
  };
}

function parseNullableNumber(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toArrayOfStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'string' ? item : String(item ?? '')
      )
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function toArrayOfNumbers(value: unknown): Array<number | null> {
  if (Array.isArray(value)) {
    return value.map((item) => parseNullableNumber(item as never));
  }
  return [];
}

function computeHistoryStats(points: LatencyHistoryPoint[]): HistoryStats {
  const latencyValues = points
    .map((point) => point.latencyIdle)
    .filter((value): value is number => typeof value === 'number');

  if (!latencyValues.length) {
    return {
      min: null,
      max: null,
      avg: null,
      samples: 0,
    };
  }

  const min = Math.min(...latencyValues);
  const max = Math.max(...latencyValues);
  const avg =
    latencyValues.reduce((sum, value) => sum + value, 0) /
    latencyValues.length;

  return {
    min,
    max,
    avg,
    samples: latencyValues.length,
  };
}

