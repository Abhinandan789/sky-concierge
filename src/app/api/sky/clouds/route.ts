import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { parseNumber, validateLatLon } from "@/lib/utils";
import { getCachedCloudForecast } from "@/services/sky/cache";
import { summarizeCloudCover } from "@/services/sky/clouds";
import { getTonightBounds } from "@/services/sky/moon";

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

  const { searchParams } = new URL(request.url);
  const lat = parseNumber(searchParams.get("lat"));
  const lon = parseNumber(searchParams.get("lon"));
  if (lat === null || lon === null) {
    return jsonError(
      "Latitude and longitude are required.",
      400,
      "MISSING_COORDINATES",
    );
  }
  const validation = validateLatLon(lat, lon);
  if (validation) {
    return jsonError(validation, 400, "INVALID_COORDINATES");
  }

  try {
    const forecast = await getCachedCloudForecast(lat, lon);
    const bounds = getTonightBounds({ lat, lon }, new Date());
    if (!bounds) {
      return jsonOk({ level: "UNKNOWN", average: null });
    }
    const summary = summarizeCloudCover(forecast, bounds.start, bounds.end);
    return jsonOk({
      level: summary.level,
      average: summary.average,
    });
  } catch {
    return jsonOk({ level: "UNKNOWN", average: null });
  }
}
