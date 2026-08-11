import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { disablePushSubscription, getDb, upsertPushSubscription } from "@/lib/db";
import { parseNumber, validateLatLon } from "@/lib/utils";
import { ALERT_EVENT_TYPES, type AlertEventType } from "@/types";

export const runtime = "nodejs";

const PUSH_LIMIT = 20;
const PUSH_WINDOW_MS = 60_000;

const limiter = new RateLimiter();

interface PushBody {
  endpoint?: unknown;
  keys?: unknown;
  lat?: unknown;
  lon?: unknown;
  events?: unknown;
}

interface PushKeys {
  p256dh?: unknown;
  auth?: unknown;
}

export async function POST(request: NextRequest) {
  const rate = limiter.check(clientIp(request), PUSH_LIMIT, PUSH_WINDOW_MS);
  if (!rate.allowed) {
    return jsonError(
      "Too many requests — please try again in a minute.",
      429,
      "RATE_LIMITED",
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  let body: PushBody;
  try {
    body = (await request.json()) as PushBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "INVALID_BODY");
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!/^https:\/\//.test(endpoint)) {
    return jsonError(
      "A valid push endpoint (https) is required.",
      400,
      "INVALID_ENDPOINT",
    );
  }

  const keys = (body.keys ?? {}) as PushKeys;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  if (!p256dh || !auth) {
    return jsonError("Push keys (p256dh, auth) are required.", 400, "INVALID_KEYS");
  }

  const lat =
    typeof body.lat === "number" ? body.lat : parseNumber(String(body.lat));
  const lon =
    typeof body.lon === "number" ? body.lon : parseNumber(String(body.lon));
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

  const requested = Array.isArray(body.events) ? body.events : [];
  const events = requested.filter((event): event is AlertEventType =>
    ALERT_EVENT_TYPES.includes(event as AlertEventType),
  );
  if (events.length === 0) {
    return jsonError(
      "Select at least one event type (iss, aurora or showers).",
      400,
      "NO_EVENTS",
    );
  }

  try {
    const id = upsertPushSubscription(getDb(), {
      endpoint,
      p256dh,
      auth,
      lat,
      lon,
      events: events.join(","),
    });
    return jsonOk({ id }, { status: 201 });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not save the push subscription.",
      500,
      "PUSH_SUBSCRIPTION_SAVE_FAILED",
    );
  }
}

interface DeleteBody {
  endpoint?: unknown;
}

export async function DELETE(request: NextRequest) {
  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "INVALID_BODY");
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return jsonError("An endpoint is required.", 400, "MISSING_ENDPOINT");
  }

  const found = disablePushSubscription(getDb(), endpoint);
  return jsonOk({ unsubscribed: true, found });
}
