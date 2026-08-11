import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { parseSatelliteIds } from "@/config/satellites";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { parseNumber, validateLatLon } from "@/lib/utils";
import { buildTonightBrief } from "@/services/sky/brief";

export const runtime = "nodejs";

const BRIEF_LIMIT = 60;
const BRIEF_WINDOW_MS = 60_000;

const limiter = new RateLimiter();

export async function GET(request: NextRequest) {
  const rate = limiter.check(clientIp(request), BRIEF_LIMIT, BRIEF_WINDOW_MS);
  if (!rate.allowed) {
    return jsonError(
      "Too many requests — please try again in a minute.",
      429,
      "RATE_LIMITED",
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  const lat = parseNumber(request.nextUrl.searchParams.get("lat"));
  const lon = parseNumber(request.nextUrl.searchParams.get("lon"));

  if (lat === null || lon === null) {
    return jsonError(
      "Query parameters 'lat' and 'lon' are required.",
      400,
      "MISSING_COORDINATES",
    );
  }

  const validation = validateLatLon(lat, lon);
  if (validation) {
    return jsonError(validation, 400, "INVALID_COORDINATES");
  }

  // Optional ?norad=25544,48274 — overrides the server-configured set.
  const satelliteIds = parseSatelliteIds(
    request.nextUrl.searchParams.get("norad"),
  );
  if (!satelliteIds.valid) {
    return jsonError(
      "Invalid 'norad' parameter — expected comma-separated NORAD catalog numbers (up to 4).",
      400,
      "INVALID_SATELLITE_IDS",
    );
  }
  const noradIds = satelliteIds.ids.length > 0 ? satelliteIds.ids : undefined;

  try {
    const brief = await buildTonightBrief({ lat, lon }, { noradIds });
    return jsonOk(brief, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=600" },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Brief generation failed.",
      500,
      "BRIEF_FAILED",
    );
  }
}
