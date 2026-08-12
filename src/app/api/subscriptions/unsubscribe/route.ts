import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { disableSubscription, getDb } from "@/lib/db";

export const runtime = "nodejs";

const UNSUB_LIMIT = 20;
const UNSUB_WINDOW_MS = 60_000;

const limiter = new RateLimiter();

interface UnsubscribeBody {
  token?: unknown;
}

export async function POST(request: NextRequest) {
  const rate = limiter.check(clientIp(request), UNSUB_LIMIT, UNSUB_WINDOW_MS);
  if (!rate.allowed) {
    return jsonError(
      "Too many requests — please try again in a minute.",
      429,
      "RATE_LIMITED",
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  let body: UnsubscribeBody;
  try {
    body = (await request.json()) as UnsubscribeBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "INVALID_BODY");
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return jsonError("An unsubscribe token is required.", 400, "MISSING_TOKEN");
  }

  const found = await disableSubscription(await getDb(), token);
  // Idempotent: unsubscribing twice (or after the token expired) is still OK.
  return jsonOk({ unsubscribed: true, found });
}
