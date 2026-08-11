import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { parseSatelliteIds } from "@/config/satellites";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { getCachedTleSet } from "@/services/sky/cache";
import { resolveNoradIds } from "@/services/sky/brief";

export const runtime = "nodejs";

const TLES_LIMIT = 60;
const TLES_WINDOW_MS = 60_000;

const limiter = new RateLimiter();

export interface TleEntry {
  noradId: string;
  name: string;
  line1: string;
  line2: string;
}

/**
 * TLEs for the live satellite radar. The client propagates them locally with
 * satellite.js so the map animates in real time. Data comes from the same
 * TTL cache as the brief, so this doesn't hammer CelesTrak.
 */
export async function GET(request: NextRequest) {
  const rate = limiter.check(clientIp(request), TLES_LIMIT, TLES_WINDOW_MS);
  if (!rate.allowed) {
    return jsonError(
      "Too many requests — please try again in a minute.",
      429,
      "RATE_LIMITED",
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  // Empty ?norad= means "the server-configured set".
  const parsed = parseSatelliteIds(request.nextUrl.searchParams.get("norad"));
  if (!parsed.valid) {
    return jsonError(
      "Invalid 'norad' parameter — expected comma-separated NORAD catalog numbers (up to 4).",
      400,
      "INVALID_SATELLITE_IDS",
    );
  }
  const ids = resolveNoradIds(parsed.ids);

  const settled = await Promise.allSettled(
    ids.map(async (noradId) => {
      const tle = await getCachedTleSet(noradId);
      return { noradId, name: tle.name, line1: tle.line1, line2: tle.line2 };
    }),
  );

  const tles: TleEntry[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      tles.push(result.value);
    }
  }

  if (tles.length === 0) {
    return jsonError(
      "Couldn't fetch satellite TLEs — try again shortly.",
      500,
      "TLE_FETCH_FAILED",
    );
  }

  return jsonOk(
    { tles },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } },
  );
}
