import { NextRequest } from "next/server";
import { CLOUD_REGIONS } from "@/data/network";
import type { LatencyHistoryPoint, TimeRangeKey } from "@/types/latency";

/**
 * API Route: /api/latency
 * -----------------------
 * Returns a lightweight snapshot derived from the `/api/latency/history`
 * endpoint so the client can consume the freshest datapoint while avoiding
 * duplicating transformation logic. Results are cached for ~10 seconds so we
 * only re-query Cloudflare (through the history endpoint) at that cadence.
 */

type LatencySnapshot = {
  regionId: string;
  location: string;
  latencyIdle: number | null;
  latencyLoaded: number | null;
  jitterIdle: number | null;
  capturedAt: string;
};

type CacheEntry = {
  data: LatencySnapshot[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 10_000;
const snapshotCache = new Map<string, CacheEntry>();

export async function GET(request: NextRequest) {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    return Response.json(
      { message: "Cloudflare API token not configured." },
      { status: 500 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const requestedRegionIds = searchParams.get("regions");
  const rangeParam = parseRangeParam(searchParams.get("range"));

  const regionIds = requestedRegionIds
    ? requestedRegionIds
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : CLOUD_REGIONS.map((item) => item.id);

  const uniqueRegionIds = Array.from(new Set(regionIds));

  const knownRegions = uniqueRegionIds
    .map((regionId) =>
      CLOUD_REGIONS.find((item) => item.id === regionId)
    )
    .filter(
      (item): item is (typeof CLOUD_REGIONS)[number] => Boolean(item)
    );

  if (!knownRegions.length) {
    return Response.json(
      { message: "No matching Cloudflare regions found for request." },
      { status: 400 }
    );
  }

  const cacheKey = createCacheKey(uniqueRegionIds, rangeParam);
  const now = Date.now();
  const cached = snapshotCache.get(cacheKey);

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return Response.json(
      {
        data: cached.data,
        cachedAt: new Date(cached.fetchedAt).toISOString(),
        cacheTtlMs: CACHE_TTL_MS,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const origin = request.nextUrl.origin;

  const snapshots = await Promise.all(
    knownRegions.map((region) =>
      fetchLatestHistorySnapshot({
        origin,
        regionId: region.id,
        countryCode: region.countryCode,
        range: rangeParam,
      })
    )
  );

  snapshotCache.set(cacheKey, { data: snapshots, fetchedAt: now });

  return Response.json(
    {
      data: snapshots,
      cachedAt: new Date(now).toISOString(),
      cacheTtlMs: CACHE_TTL_MS,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function createCacheKey(regionIds: string[], range: TimeRangeKey): string {
  return `${range}::${regionIds
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join(",")}`;
}

function parseRangeParam(value: string | null): TimeRangeKey {
  if (isTimeRangeKey(value)) {
    return value;
  }
  return "1h";
}

function isTimeRangeKey(value: string | null): value is TimeRangeKey {
  return value === "1h" || value === "24h" || value === "7d" || value === "30d";
}

async function fetchLatestHistorySnapshot({
  origin,
  regionId,
  countryCode,
  range,
}: {
  origin: string;
  regionId: string;
  countryCode: string;
  range: TimeRangeKey;
}): Promise<LatencySnapshot> {
  const historyUrl = new URL("/api/latency/history", origin);
  historyUrl.searchParams.set("region", regionId);
  historyUrl.searchParams.set("range", range);

  try {
    console.log(
      "[latency-snapshot] history request:",
      historyUrl.toString()
    );
    const response = await fetch(historyUrl.toString(), {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `[latency-snapshot] History request failed for region ${regionId}:`,
        response.status,
        await response.text().catch(() => "")
      );
      return buildEmptySnapshot(regionId, countryCode);
    }

    const payload = (await response.json()) as {
      points?: LatencyHistoryPoint[];
      queriedAt?: string;
    };

    const points = Array.isArray(payload.points) ? payload.points : [];
    const latestPoint =
      points.length > 0 ? points[points.length - 1] : null;

    return {
      regionId,
      location: countryCode,
      latencyIdle: latestPoint?.latencyIdle ?? null,
      latencyLoaded: latestPoint?.latencyLoaded ?? null,
      jitterIdle: latestPoint?.jitterIdle ?? null,
      capturedAt:
        latestPoint?.timestamp ??
        payload.queriedAt ??
        new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `[latency-snapshot] Failed to fetch history for region ${regionId}:`,
      error
    );
    return buildEmptySnapshot(regionId, countryCode);
  }
}

function buildEmptySnapshot(
  regionId: string,
  countryCode: string
): LatencySnapshot {
  return {
    regionId,
    location: countryCode,
    latencyIdle: null,
    latencyLoaded: null,
    jitterIdle: null,
    capturedAt: new Date().toISOString(),
  };
}