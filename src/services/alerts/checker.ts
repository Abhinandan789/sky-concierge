import { getDb, insertAlertLogIfNotExists, listEnabledSubscriptions } from "@/lib/db";
import { formatCompass, formatTime } from "@/lib/utils";
import { buildTonightBrief } from "@/services/sky/brief";
import type { AlertEventType } from "@/types";
import { ConsoleSender, type AlertMessage, type AlertSender } from "./sender";

const ISS_ALERT_LEAD_MINUTES = 60;
const SHOWER_ALERT_DAYS = 3;
const AURORA_ALERT_LEVELS = ["MODERATE", "HIGH", "STORM"] as const;

export interface DueAlert {
  subscriptionId: string;
  email: string;
  eventType: AlertEventType;
  message: AlertMessage;
}

export interface AlertCheckOptions {
  sender?: AlertSender;
  now?: Date;
  fetcher?: typeof fetch;
}

export interface AlertCheckResult {
  checked: number;
  sent: number;
}

/** UTC day key used for per-day alert deduplication, e.g. "2026-08-11". */
function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function buildCandidates(
  subscription: {
    id: string;
    email: string;
    lat: number;
    lon: number;
    events: string;
  },
  now: Date,
  fetcher: typeof fetch,
): Promise<DueAlert[]> {
  const events = subscription.events
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean) as AlertEventType[];

  const brief = await buildTonightBrief(
    { lat: subscription.lat, lon: subscription.lon },
    { now, fetcher },
  );

  const candidates: DueAlert[] = [];

  if (events.includes("iss") && brief.issPasses.length > 0) {
    const next = brief.issPasses[0];
    const minutesUntil = Math.round(
      (next.start.getTime() - now.getTime()) / 60_000,
    );
    // Skip passes that are already underway.
    if (minutesUntil >= 0 && minutesUntil <= ISS_ALERT_LEAD_MINUTES) {
      candidates.push({
        subscriptionId: subscription.id,
        email: subscription.email,
        eventType: "iss",
        message: {
          subject: `ISS pass in ~${minutesUntil} min over your location`,
          body: [
            `Rises ${formatTime(next.start)} and reaches ${next.maxElevationDeg}° for ${Math.round(next.durationMinutes)} minutes.`,
            `Look ${formatCompass(next.maxAzimuthDeg)} at ${formatTime(next.max)} — no telescope needed.`,
          ].join("\n"),
        },
      });
    }
  }

  if (events.includes("aurora") && brief.aurora) {
    const level = brief.aurora.level as (typeof AURORA_ALERT_LEVELS)[number];
    if (AURORA_ALERT_LEVELS.includes(level)) {
      candidates.push({
        subscriptionId: subscription.id,
        email: subscription.email,
        eventType: "aurora",
        message: {
          subject: `Aurora watch tonight — Kp ${brief.aurora.maxKpTonight}`,
          body: `Predicted Kp ${brief.aurora.maxKpTonight} (${brief.aurora.level}) in the next 12 hours.\n${brief.aurora.viewingLatitudeHint}.\nFind a dark spot with a clear northern view.`,
        },
      });
    }
  }

  if (events.includes("showers")) {
    const peakSoon = brief.showers.find(
      (shower) =>
        shower.daysUntilPeak >= 0 && shower.daysUntilPeak <= SHOWER_ALERT_DAYS,
    );
    if (peakSoon) {
      candidates.push({
        subscriptionId: subscription.id,
        email: subscription.email,
        eventType: "showers",
        message: {
          subject:
            peakSoon.daysUntilPeak === 0
              ? `${peakSoon.name} peak tonight ✨`
              : `${peakSoon.name} peak in ${peakSoon.daysUntilPeak} days`,
          body: `${peakSoon.name} peaks on ${peakSoon.peakDate} with up to ${peakSoon.zhr} meteors/hour.\nBest viewing after midnight, away from city lights.`,
        },
      });
    }
  }

  return candidates;
}

/**
 * Evaluate every enabled subscription and dispatch any alerts that are due.
 * Deduplication is enforced atomically by the UNIQUE(subscription_id,
 * event_type, date_key) index, so overlapping runs can never double-send.
 */
export async function runAlertCheck(
  options: AlertCheckOptions = {},
): Promise<AlertCheckResult> {
  const sender = options.sender ?? new ConsoleSender();
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const db = getDb();

  const subscriptions = listEnabledSubscriptions(db);
  const dateKey = utcDateKey(now);

  let sent = 0;
  for (const subscription of subscriptions) {
    const candidates = await buildCandidates(subscription, now, fetcher);

    for (const candidate of candidates) {
      const claimed = insertAlertLogIfNotExists(db, {
        subscriptionId: candidate.subscriptionId,
        eventType: candidate.eventType,
        message: candidate.message.subject,
        dateKey,
      });
      if (!claimed) {
        continue; // already alerted for this event today
      }

      await sender.send(candidate.email, candidate.message);
      sent += 1;
    }
  }

  return { checked: subscriptions.length, sent };
}
