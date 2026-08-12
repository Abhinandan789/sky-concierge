import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { jsonError, jsonOk } from "@/lib/api";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { getDb, upsertSubscription } from "@/lib/db";
import { isEmail, parseNumber, validateLatLon } from "@/lib/utils";

import { parseSatelliteIds } from "@/config/satellites";
import { createSender } from "@/services/alerts/sender";
import { ALERT_EVENT_TYPES, type AlertEventType } from "@/types";

export const runtime = "nodejs";

const SUB_LIMIT = 10;
const SUB_WINDOW_MS = 60_000;

const limiter = new RateLimiter();

interface SubscriptionBody {
  email?: unknown;
  lat?: unknown;
  lon?: unknown;
  events?: unknown;
  /** NORAD catalog ids to alert about (array of numbers/strings, up to 4). */
  satelliteIds?: unknown;
}

function parseCoordinates(body: SubscriptionBody): {
  lat: number | null;
  lon: number | null;
} {
  const lat =
    typeof body.lat === "number" ? body.lat : parseNumber(String(body.lat));
  const lon =
    typeof body.lon === "number" ? body.lon : parseNumber(String(body.lon));
  return { lat, lon };
}

export async function POST(request: NextRequest) {
  const rate = limiter.check(clientIp(request), SUB_LIMIT, SUB_WINDOW_MS);
  if (!rate.allowed) {
    return jsonError(
      "Too many requests — please try again in a minute.",
      429,
      "RATE_LIMITED",
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  let body: SubscriptionBody;
  try {
    body = (await request.json()) as SubscriptionBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "INVALID_BODY");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isEmail(email)) {
    return jsonError(
      "A valid email address is required.",
      400,
      "INVALID_EMAIL",
    );
  }

  const { lat, lon } = parseCoordinates(body);
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

  // Optional satellite selection (array of NORAD ids). Empty = server set.
  let satelliteIds: string | undefined;
  if (body.satelliteIds !== undefined) {
    const raw = Array.isArray(body.satelliteIds)
      ? body.satelliteIds.map(String).join(",")
      : String(body.satelliteIds);
    const parsed = parseSatelliteIds(raw);
    if (!parsed.valid) {
      return jsonError(
        "Invalid satellite selection — expected up to 4 numeric NORAD catalog ids.",
        400,
        "INVALID_SATELLITE_IDS",
      );
    }
    satelliteIds = parsed.ids.join(",");
  }

  // With a real email sender configured we require double opt-in; without
  // one (console/dev mode) the subscription is active immediately.
  const needsVerification = Boolean(process.env.RESEND_API_KEY);

  try {
    const subscription = await upsertSubscription(await getDb(), {
      email,
      lat,
      lon,
      events: events.join(","),
      satelliteIds,
      verified: !needsVerification,
    });

    // A pending change means an unverified request tried to alter an
    // already-verified subscription — the owner must confirm before the new
    // events/re-enable are applied, so email them a confirmation link too.
    if (
      needsVerification &&
      (!subscription.verified || subscription.pendingChange)
    ) {
      // Use the request's own origin unless SITE_URL is configured, so
      // confirmation links always point at the server the visitor is on
      // (dev servers rarely run on the localhost:3000 default).
      const baseUrl = process.env.SITE_URL ?? new URL(request.url).origin;
      const confirmUrl = `${baseUrl}/verify?token=${subscription.verifyToken}`;
      try {
        await createSender().send(email, {
          subject: subscription.pendingChange
            ? "Confirm your Sky Concierge alert changes"
            : "Confirm your Sky Concierge alerts",
          body: [
            subscription.pendingChange
              ? "Someone (possibly you) requested to update this Sky Concierge subscription."
              : "Thanks for subscribing to Sky Concierge!",
            "",
            subscription.pendingChange
              ? "Confirm your email to apply the changes."
              : "One more step: confirm your email to start receiving alerts.",
            "",
            confirmUrl,
            "",
            "If you didn't request this, you can safely ignore this email — nothing changes.",
          ].join("\n"),
        });
      } catch (error) {
        logger.error("Verification email send failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return jsonError(
          "Couldn't send the confirmation email. Please try again.",
          500,
          "VERIFICATION_SEND_FAILED",
        );
      }
    }

    return jsonOk(
      {
        id: subscription.id,
        verified: subscription.verified,
        // Unsubscribe tokens are only ever delivered inside alert emails —
        // never in API responses. An unauthenticated signup must not be able
        // to harvest a token for an address it doesn't control.
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error("Subscription save failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      "Could not save the subscription. Please try again.",
      500,
      "SUBSCRIPTION_SAVE_FAILED",
    );
  }
}
