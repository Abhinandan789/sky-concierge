import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { isEmail, parseNumber, validateLatLon } from "@/lib/utils";
import { ALERT_EVENT_TYPES, type AlertEventType } from "@/types";

export const runtime = "nodejs";

interface SubscriptionBody {
  email?: unknown;
  lat?: unknown;
  lon?: unknown;
  events?: unknown;
}

export async function POST(request: NextRequest) {
  let body: SubscriptionBody;
  try {
    body = (await request.json()) as SubscriptionBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "INVALID_BODY");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isEmail(email)) {
    return jsonError("A valid email address is required.", 400, "INVALID_EMAIL");
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
    // Upsert keeps one subscription per (email, lat, lon): re-subscribing
    // refreshes the event selection instead of creating duplicates.
    const subscription = await prisma.alertSubscription.upsert({
      where: { email_lat_lon: { email, lat, lon } },
      create: {
        email,
        lat,
        lon,
        events: events.join(","),
        enabled: true,
      },
      update: { events: events.join(","), enabled: true },
      select: { id: true },
    });

    return jsonOk({ id: subscription.id }, { status: 201 });
  } catch {
    return jsonError(
      "Could not save the subscription. Please try again.",
      500,
      "SUBSCRIPTION_SAVE_FAILED",
    );
  }
}
