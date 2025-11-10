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
  const now = Date.now();
  // Cloudflare Radar timeseries rejects end timestamps that are equal to "now".
  // Subtract a small buffer so the requested window is safely in the past.
  const dateEnd = new Date(now - 60 * 1000);
  const dateStart = new Date(dateEnd.getTime() - duration);

  const url = new URL(CLOUD_FLARE_IQI_ENDPOINT);
  url.searchParams.set('metric', 'LATENCY');
  url.searchParams.set('location', region.countryCode);
  url.searchParams.set('dateStart', dateStart.toISOString());
  url.searchParams.set('dateEnd', dateEnd.toISOString());
  url.searchParams.set('format', 'JSON');

  try {
    console.log('[latency-history] Cloudflare request:', url.toString());
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

    const payload = (await response.json()) as { result?: unknown };

    const points = extractHistoryPoints(payload, {
      dateStart,
      dateEnd,
    });
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

function extractHistoryPoints(
  payload: { result?: unknown },
  context: { dateStart: Date; dateEnd: Date }
): LatencyHistoryPoint[] {
  const result = payload.result as
    | {
        serie_0?:
          | ({
              latencyIdle?: unknown;
              latency_idle?: unknown;
              latencyLoaded?: unknown;
              latency_loaded?: unknown;
              jitterIdle?: unknown;
              jitter_idle?: unknown;
            } & Record<string, unknown>)
          | Array<Record<string, unknown>>;
        histogram_0?:
          | ({
              timestamps?: unknown;
              buckets?: unknown;
              values?: unknown;
              data?: unknown;
            } & Record<string, unknown>)
          | Array<Record<string, unknown>>;
      }
    | undefined;

  if (!result) {
    return [];
  }

  const rawSerie = result.serie_0;
  const rawHistogram = (result as { histogram_0?: unknown }).histogram_0;

  if (!rawSerie && rawHistogram) {
    return extractHistogramPoints(rawHistogram, context);
  }

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

  const percentilePoints = extractPercentileSeries(
    rawSerie as Record<string, unknown>
  );
  if (percentilePoints.length) {
    return percentilePoints;
  }

  const timestamps = toArrayOfStrings(
    (rawSerie as { timestamps?: unknown }).timestamps
  );
  const latencyIdle = toArrayOfNumbers(
    (rawSerie as {
      latencyIdle?: unknown;
      latency_idle?: unknown;
      values?: unknown;
    }).latencyIdle ??
      (rawSerie as { latency_idle?: unknown }).latency_idle ??
      (rawSerie as { values?: unknown }).values
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

function extractPercentileSeries(rawSerie: Record<string, unknown>): LatencyHistoryPoint[] {
  const timestamps = toArrayOfStrings(rawSerie.timestamps);
  if (!timestamps.length) {
    return [];
  }

  const p50 = toArrayOfNumbers(rawSerie.p50);
  const p75 = toArrayOfNumbers(rawSerie.p75);
  const p25 = toArrayOfNumbers(rawSerie.p25);

  const points: LatencyHistoryPoint[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    points.push({
      timestamp: timestamps[index],
      latencyIdle:
        p50[index] !== undefined ? (p50[index] ?? null) : null,
      latencyLoaded:
        p75[index] !== undefined ? (p75[index] ?? null) : null,
      jitterIdle:
        p25[index] !== undefined ? (p25[index] ?? null) : null,
    });
  }

  return points;
}

function extractHistogramPoints(
  histogram: unknown,
  context: { dateStart: Date; dateEnd: Date }
): LatencyHistoryPoint[] {
  const entries = normalizeHistogramEntries(histogram);
  if (!entries.length) {
    return [];
  }

  const startMs = context.dateStart.getTime();
  const endMs = context.dateEnd.getTime();
  const total = entries.length;
  const step = total > 1 ? (endMs - startMs) / (total - 1) : 0;

  return entries.map((entry, index) => {
    const latency = parseLatencyFromHistogramEntry(entry);
    const timestamp = new Date(startMs + step * index).toISOString();

    return {
      timestamp,
      latencyIdle: latency,
      latencyLoaded: null,
      jitterIdle: null,
    };
  });
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

function normalizeHistogramEntries(histogram: unknown): Array<Record<string, unknown>> {
  if (!histogram) {
    return [];
  }

  if (Array.isArray(histogram)) {
    return histogram as Array<Record<string, unknown>>;
  }

  if (typeof histogram === 'object') {
    const buckets = (histogram as { buckets?: unknown }).buckets;
    const data = (histogram as { data?: unknown }).data;
    const values = (histogram as { values?: unknown }).values;

    if (Array.isArray(buckets) && Array.isArray(values) && buckets.length === values.length) {
      return buckets.map((bucket, index) => ({
        bucket,
        value: values[index] ?? null,
      }));
    }

    if (Array.isArray(buckets)) {
      return buckets as Array<Record<string, unknown>>;
    }

    if (Array.isArray(data)) {
      return data as Array<Record<string, unknown>>;
    }
  }

  return [];
}

function parseLatencyFromHistogramEntry(entry: Record<string, unknown>): number | null {
  const candidates: Array<unknown> = [
    entry.bucketStart,
    entry.bucket_start,
    entry.bucket,
    entry.bucketEnd,
    entry.bucket_end,
    entry.latency,
    entry.valueLatency,
    entry.value_latency,
    entry.value,
    entry.avgLatency,
    entry.avg_latency,
  ];

  for (const candidate of candidates) {
    const parsed = parseHistogramNumber(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function parseHistogramNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const matches = value.match(/-?\d+(\.\d+)?/);
    if (!matches) {
      return null;
    }
    const numeric = Number(matches[0]);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
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

