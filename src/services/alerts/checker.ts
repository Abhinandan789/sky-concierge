import type { DatabaseSync } from "node:sqlite";
import {
  getDb,
  insertAlertLogIfNotExists,
  listEnabledSubscriptions,
  removeAlertLog,
} from "@/lib/db";
import { formatCompass, formatTime } from "@/lib/utils";
import { buildTonightBrief } from "@/services/sky/brief";
import type { AlertEventType, SkyBrief } from "@/types";
import { ConsoleSender, createSender, type AlertMessage, type AlertSender } from "./sender";

const ISS_ALERT_LEAD_MINUTES = 60;
const SHOWER_ALERT_DAYS = 3;
const AURORA_ALERT_LEVELS = ["MODERATE", "HIGH", "STORM"] as const;

export interface SubscriptionLike {
  id: string;
  email: string;
  lat: number;
  lon: number;
  events: string;
}

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
  db?: DatabaseSync;
}

export interface AlertCheckResult {
  checked: number;
  sent: number;
}

/** UTC day key used for per-day alert deduplication, e.g. "2026-08-11". */
function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Pure decision logic: given a subscription and a computed sky brief, which
 * alerts are due right now? No I/O — fully unit-testable.
 */
export function candidatesFromBrief(
  subscription: SubscriptionLike,
  brief: SkyBrief,
  now: Date,
): DueAlert[] {
  const events = subscription.events
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean) as AlertEventType[];

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

async function buildCandidates(
  subscription: SubscriptionLike,
  now: Date,
  fetcher: typeof fetch,
): Promise<DueAlert[]> {
  const brief = await buildTonightBrief(
    { lat: subscription.lat, lon: subscription.lon },
    { now, fetcher },
  );
  return candidatesFromBrief(subscription, brief, now);
}

/**
 * Evaluate every enabled subscription and dispatch any alerts that are due.
 * Deduplication is enforced atomically by the UNIQUE(subscription_id,
 * event_type, date_key) index, so overlapping runs can never double-send.
 * If a send fails, its claim is rolled back and the run fails loudly, so the
 * alert is retried on the next run rather than swallowed.
 */
export async function runAlertCheck(
  options: AlertCheckOptions = {},
): Promise<AlertCheckResult> {
  const sender = options.sender ?? createSender();
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const db = options.db ?? getDb();

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

      try {
        await sender.send(candidate.email, candidate.message);
        sent += 1;
      } catch (error) {
        // Roll back the claim so a transient send failure doesn't swallow
        // the alert — the next run will retry it. Then fail loudly.
        removeAlertLog(db, {
          subscriptionId: candidate.subscriptionId,
          eventType: candidate.eventType,
          dateKey,
        });
        throw error;
      }
    }
  }

  return { checked: subscriptions.length, sent };
}

// Re-exported for callers that want an explicit console sender in tests/scripts.
export { ConsoleSender };
