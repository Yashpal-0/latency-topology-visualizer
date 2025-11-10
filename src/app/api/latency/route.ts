import { NextRequest } from "next/server";

/**
 * API Route: /api/latency
 * -----------------------
 * Acts as a lightweight proxy in front of Cloudflare Radar's Speed Test Summary endpoint.
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

  const endpoint = "https://api.cloudflare.com/client/v4/radar/quality/speed/summary";
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
      url.searchParams.append("location", code);
      url.searchParams.append("limit", "1");

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Cloudflare returned ${response.status}`);
        }

        const payload = (await response.json()) as {
          result?: {
            meta?: { lastUpdated?: string };
            summary_0?: {
              latencyIdle?: string | number;
              latencyLoaded?: string | number;
              jitterIdle?: string | number;
            };
          };
        };

        const summary = payload.result?.summary_0;

        // Persist the metrics keyed by location so exchanges can look them up later.
        metricsByLocation.set(code, {
          latencyIdle: summary?.latencyIdle
            ? Number(summary.latencyIdle)
            : null,
          latencyLoaded: summary?.latencyLoaded
            ? Number(summary.latencyLoaded)
            : null,
          jitterIdle: summary?.jitterIdle ? Number(summary.jitterIdle) : null,
          capturedAt:
            payload.result?.meta?.lastUpdated ??
            new Date().toISOString(),
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

