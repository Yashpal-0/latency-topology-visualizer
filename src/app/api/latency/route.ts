import { NextRequest } from "next/server";

/**
 * API Route: /api/latency
 * -----------------------
 * Acts as a lightweight proxy in front of Cloudflare Radar's Internet Quality Index (IQI) timeseries endpoint.
 * This keeps our Mapbox client clean (no secret tokens) and allows for basic shaping of the response.
 */

type LatencySnapshot = {
  regionId: string;
  location: string;
  latencyIdle: number | null;
  latencyLoaded: number | null;
  jitterIdle: number | null;
  capturedAt: string;
};

type RegionDescriptor = {
  id: string;
  countryCode: string;
};

const CLOUD_REGIONS: RegionDescriptor[] = [
  { id: "aws-virginia", countryCode: "US" },
  { id: "aws-london", countryCode: "GB" },
  { id: "aws-frankfurt", countryCode: "DE" },
  { id: "gcp-singapore", countryCode: "SG" },
  { id: "gcp-california", countryCode: "US" },
  { id: "gcp-hongkong", countryCode: "HK" },
  { id: "azure-amsterdam", countryCode: "NL" },
  { id: "azure-hongkong", countryCode: "HK" },
  { id: "azure-zurich", countryCode: "CH" },
  { id: "azure-seoul", countryCode: "KR" },
];

export async function GET(request: NextRequest) {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!apiToken) {
    // With no token we cannot hit the Radar API, so inform the client explicitly.
    return Response.json(
      { message: "Cloudflare API token not configured." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedRegionIds = searchParams.get("regions");

  const regionIds = requestedRegionIds
    ? requestedRegionIds.split(",").map((value) => value.trim())
    : CLOUD_REGIONS.map((item) => item.id);

  const knownRegions = regionIds
    .map((regionId) => CLOUD_REGIONS.find((item) => item.id === regionId))
    .filter((item): item is RegionDescriptor => Boolean(item));

  if (!knownRegions.length) {
    // Reject unknown regions early to avoid unnecessary upstream calls.
    return Response.json(
      { message: "No matching Cloudflare regions found for request." },
      { status: 400 }
    );
  }

  const uniqueCountryCodes = Array.from(
    new Set(knownRegions.map((item) => item.countryCode))
  );

  const endpoint =
    "https://api.cloudflare.com/client/v4/radar/quality/iqi/timeseries_groups";
  const metricsByLocation = new Map<
    string,
    {
      latencyIdle: number | null;
      latencyLoaded: number | null;
      jitterIdle: number | null;
      capturedAt: string;
    }
  >();

  await Promise.all(
    uniqueCountryCodes.map(async (code) => {
      const url = new URL(endpoint);
      url.searchParams.set("metric", "LATENCY");
      url.searchParams.set("location", code);
      url.searchParams.set("format", "JSON");
      url.searchParams.set("dateRange", "1d");

      try {
        console.log(
          "[latency-snapshot] Cloudflare request:",
          url.toString()
        );
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

        const payloadText = await response.text();
        if (!response.ok) {
          console.error(
            "Cloudflare latency summary error payload:",
            payloadText
          );
          throw new Error(
            `Cloudflare returned ${response.status}${
              payloadText ? `: ${payloadText}` : ""
            }`
          );
        }

        const payload = JSON.parse(payloadText) as {
          result?: {
            serie_0?: Record<string, unknown>;
            meta?: { lastUpdated?: string };
          };
        };

        const latestPoint = extractLatestLatencyPoint(payload.result?.serie_0);

        if (!latestPoint) {
          console.warn(
            `No latency points returned for location ${code}. Payload:`,
            payload.result
          );
          return;
        }

        metricsByLocation.set(code, {
          latencyIdle: latestPoint.latencyIdle,
          latencyLoaded: latestPoint.latencyLoaded,
          jitterIdle: latestPoint.jitterIdle,
          capturedAt: latestPoint.timestamp,
        });
      } catch (error) {
        console.error("Failed to fetch Cloudflare latency summary:", error);
      }
    })
  );

  const responsePayload: LatencySnapshot[] = knownRegions.map((region) => {
    // Convert the map keyed by location into the shape expected by the client.
    const metrics = metricsByLocation.get(region.countryCode);
    return {
      regionId: region.id,
      location: region.countryCode,
      latencyIdle: metrics?.latencyIdle ?? null,
      latencyLoaded: metrics?.latencyLoaded ?? null,
      jitterIdle: metrics?.jitterIdle ?? null,
      capturedAt: metrics?.capturedAt ?? new Date().toISOString(),
    };
  });

  return Response.json({ data: responsePayload }, { status: 200 });
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function extractLatestLatencyPoint(
  serie: Record<string, unknown> | Array<Record<string, unknown>> | undefined
):
  | {
      timestamp: string;
      latencyIdle: number | null;
      latencyLoaded: number | null;
      jitterIdle: number | null;
    }
  | null {
  if (!serie) {
    return null;
  }

  if (Array.isArray(serie)) {
    for (let index = serie.length - 1; index >= 0; index -= 1) {
      const entry = serie[index] ?? {};
      const timestamp = extractTimestamp(entry);
      if (!timestamp) {
        continue;
      }
      const metrics =
        (entry.metrics as Record<string, unknown> | undefined) ?? entry;
      const latencyIdle = parseNullableNumber(
        metrics?.latencyIdle ?? metrics?.p50 ?? metrics?.latency
      );
      const latencyLoaded = parseNullableNumber(
        metrics?.latencyLoaded ?? metrics?.p75 ?? metrics?.p90
      );
      const jitterIdle = parseNullableNumber(
        metrics?.jitterIdle ?? metrics?.p25 ?? metrics?.latencyJitter
      );

      if (latencyIdle !== null || latencyLoaded !== null || jitterIdle !== null) {
        return {
          timestamp,
          latencyIdle,
          latencyLoaded,
          jitterIdle,
        };
      }
    }
    return null;
  }

  const timestamps = toArrayOfStrings(serie.timestamps);
  if (!timestamps.length) {
    return null;
  }

  const p50 = toArrayOfNumbers(serie.p50);
  const p75 = toArrayOfNumbers(serie.p75);
  const p25 = toArrayOfNumbers(serie.p25);

  for (let index = timestamps.length - 1; index >= 0; index -= 1) {
    const timestamp = timestamps[index];
    const latencyIdle = p50[index] ?? null;
    const latencyLoaded = p75[index] ?? null;
    const jitterIdle = p25[index] ?? null;

    if (
      latencyIdle !== null ||
      latencyLoaded !== null ||
      jitterIdle !== null
    ) {
      return {
        timestamp,
        latencyIdle,
        latencyLoaded,
        jitterIdle,
      };
    }
  }

  return null;
}

function extractTimestamp(entry: Record<string, unknown>): string | null {
  const dimensions = entry.dimensions as
    | { datetime?: string; timestamp?: string }
    | undefined;
  const candidates: Array<unknown> = [
    dimensions?.datetime,
    dimensions?.timestamp,
    entry.timestamp,
    entry.datetime,
    entry.time,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

function toArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (entry === null || entry === undefined) {
        return "";
      }
      return String(entry);
    })
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toArrayOfNumbers(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => parseNullableNumber(entry));
}

