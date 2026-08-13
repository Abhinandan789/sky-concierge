import { siteUrl } from "@/config/site";
import {
  disablePushSubscription,
  getDb,
  insertAlertLogIfNotExists,
  insertPushLogIfNotExists,
  listEnabledPushSubscriptions,
  listEnabledSubscriptions,
  removeAlertLog,
  removePushLog,
  type PushSubscriptionRow,
  type SkyDb,
} from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  formatCompass,
  formatDayTime,
  formatTime,
  timeZoneFor,
} from "@/lib/utils";
import { buildTonightBrief } from "@/services/sky/brief";
import type { AlertEventType, SkyBrief } from "@/types";
import {
  renderAlertEmail,
  renderDigestEmail,
  type DigestSection,
} from "./email-template";
import { sendPush } from "./push";
import {
  ConsoleSender,
  createSender,
  type AlertMessage,
  type AlertSender,
} from "./sender";

const ISS_ALERT_LEAD_MINUTES = 60;
const SHOWER_ALERT_DAYS = 3;
const AURORA_ALERT_LEVELS = ["MODERATE", "HIGH", "STORM"] as const;
/** How close (degrees) an email subscription's location must be to a push
 * subscription for a notification to match. */
const PUSH_PROXIMITY_DEG = 1.0;

export interface SubscriptionLike {
  id: string;
  email: string;
  lat: number;
  lon: number;
  events: string;
  /** Comma-separated NORAD ids; empty/absent = the server-configured set. */
  satelliteIds?: string | null;
  unsubscribeToken?: string | null;
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
  db?: SkyDb;
}

export interface AlertCheckResult {
  checked: number;
  sent: number;
}

/** UTC day key used for per-day alert deduplication, e.g. "2026-08-11". */
function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** ISO week key (e.g. "2026-W33") used to send digests at most once a week. */
export function isoWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7; // Sun = 7, Mon = 1 … Sat = 6
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // move to this week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    (d.getTime() - yearStart.getTime()) / 86_400_000 / 7 + 1 / 7,
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * NORAD ids a subscription tracks (validated numeric, deduped), or undefined
 * when none are stored — in which case the brief uses the server set.
 */
function noradIdsFor(subscription: SubscriptionLike): string[] | undefined {
  const raw = subscription.satelliteIds?.trim() ?? "";
  if (raw === "") {
    return undefined;
  }
  const ids: string[] = [];
  for (const id of raw.split(",")) {
    const trimmed = id.trim();
    if (/^\d{1,8}$/.test(trimmed) && !ids.includes(trimmed)) {
      ids.push(trimmed);
    }
  }
  return ids.length > 0 ? ids : undefined;
}

/** Approximate proximity check for matching push subscriptions to a location. */
function nearLocation(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): boolean {
  return (
    Math.abs(lat1 - lat2) <= PUSH_PROXIMITY_DEG &&
    Math.abs(lon1 - lon2) <= PUSH_PROXIMITY_DEG
  );
}

/** Unsubscribe URL for a subscription, or undefined when it has no token. */
function unsubscribeUrlFor(
  subscription: SubscriptionLike,
): string | undefined {
  if (!subscription.unsubscribeToken) {
    return undefined;
  }
  return `${siteUrl()}/unsubscribe?token=${subscription.unsubscribeToken}`;
}

/**
 * Every emailed alert carries an unsubscribe link (CAN-SPAM friendly).
 * The HTML body already embeds the link in its footer; the text body gets it
 * appended here, and the RFC 2369 List-Unsubscribe headers give mail clients
 * (and Gmail's one-click unsubscribe) a machine-readable escape hatch — a
 * real deliverability win with Gmail's spam classifier.
 */
function withUnsubscribeFooter(
  message: AlertMessage,
  subscription: SubscriptionLike,
): AlertMessage {
  const url = unsubscribeUrlFor(subscription);
  if (!url) {
    return message;
  }
  return {
    subject: message.subject,
    body: `${message.body}\n\n—\nSky Concierge · unsubscribe: ${url}`,
    html: message.html,
    headers: {
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/**
 * Pure decision logic: given a subscription and a computed sky brief, which
 * alerts are due right now? No I/O — fully unit-testable.
 */
export function candidatesFromBrief(
  subscription: SubscriptionLike,
  brief: SkyBrief,
  now: Date,
  timeZone?: string,
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
      const satelliteName = next.satelliteName ?? "ISS";
      const rises = formatTime(next.start, timeZone);
      const lookAt = formatTime(next.max, timeZone);
      const duration = Math.round(next.durationMinutes);
      candidates.push({
        subscriptionId: subscription.id,
        email: subscription.email,
        eventType: "iss",
        message: {
          subject: `${satelliteName} pass in ~${minutesUntil} min over your location`,
          body: [
            `Rises ${rises} and reaches ${next.maxElevationDeg}° for ${duration} minutes.`,
            `Look ${formatCompass(next.maxAzimuthDeg)} at ${lookAt} — no telescope needed.`,
          ].join("\n"),
          html: renderAlertEmail({
            eyebrow: "Satellite pass",
            title: `${satelliteName} in ~${minutesUntil} min`,
            intro: `Get ready — a ${satelliteName} pass is coming up over your location.`,
            facts: [
              { label: "Rises", value: rises },
              {
                label: "Peak",
                value: `${next.maxElevationDeg}° elevation for ${duration} minutes`,
              },
              {
                label: "Look",
                value: `${formatCompass(next.maxAzimuthDeg)} at ${lookAt} — no telescope needed`,
              },
            ],
            unsubscribeUrl: unsubscribeUrlFor(subscription),
          }),
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
          html: renderAlertEmail({
            eyebrow: "Aurora alert",
            title: `Aurora watch tonight`,
            intro: `The forecast predicts active aurora conditions in the next 12 hours.`,
            facts: [
              {
                label: "Intensity",
                value: `Predicted Kp ${brief.aurora.maxKpTonight} (${brief.aurora.level})`,
              },
              { label: "Where", value: brief.aurora.viewingLatitudeHint },
            ],
            note: "Find a dark spot with a clear northern view.",
            unsubscribeUrl: unsubscribeUrlFor(subscription),
          }),
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
          html: renderAlertEmail({
            eyebrow: "Meteor shower",
            title:
              peakSoon.daysUntilPeak === 0
                ? `${peakSoon.name} — peak tonight`
                : `${peakSoon.name} — peak in ${peakSoon.daysUntilPeak} days`,
            intro: `Up to ${peakSoon.zhr} meteors an hour at the peak.`,
            facts: [
              { label: "Peak date", value: peakSoon.peakDate },
              { label: "Rate", value: `up to ${peakSoon.zhr} meteors/hour` },
            ],
            note: "Best viewing after midnight, away from city lights.",
            unsubscribeUrl: unsubscribeUrlFor(subscription),
          }),
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
    { now, fetcher, noradIds: noradIdsFor(subscription) },
  );
  const timeZone = timeZoneFor(subscription.lat, subscription.lon);
  return candidatesFromBrief(subscription, brief, now, timeZone);
}

/**
 * Send push notifications for due alerts to matching browser subscriptions.
 * Every (push subscription, event type) pair that gets a candidate is marked
 * as covered so the standalone push pass below only evaluates the rest.
 */
async function dispatchPushAlerts(params: {
  subscription: SubscriptionLike;
  candidates: DueAlert[];
  db: SkyDb;
  dateKey: string;
  pushSubs: PushSubscriptionRow[];
  covered: Set<string>;
}): Promise<number> {
  const { subscription, candidates, db, dateKey, pushSubs, covered } = params;
  if (candidates.length === 0) {
    return 0;
  }

  let sent = 0;
  for (const candidate of candidates) {
    const matching = pushSubs.filter(
      (pushSub) =>
        nearLocation(
          pushSub.lat,
          pushSub.lon,
          subscription.lat,
          subscription.lon,
        ) &&
        pushSub.events
          .split(",")
          .map((event) => event.trim())
          .includes(candidate.eventType),
    );

    for (const pushSub of matching) {
      covered.add(`${pushSub.id}:${candidate.eventType}`);
      const claimed = await insertPushLogIfNotExists(db, {
        subscriptionId: pushSub.id,
        eventType: candidate.eventType,
        message: candidate.message.subject,
        dateKey,
      });
      if (!claimed) {
        continue; // already notified for this event today
      }

      try {
        await sendPush(pushSub, {
          title: candidate.message.subject,
          body: candidate.message.body,
          url: `/?lat=${subscription.lat}&lon=${subscription.lon}#tonight`,
        });
        sent += 1;
      } catch (error) {
        // Roll back so the notification retries on the next run.
        await removePushLog(db, {
          subscriptionId: pushSub.id,
          eventType: candidate.eventType,
          dateKey,
        });
        // A permanent 404/410 means the browser revoked or lost this push
        // endpoint — retrying it forever would poison every cron run. Disable
        // it and move on; only transient failures rethrow for a retry.
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await disablePushSubscription(db, pushSub.endpoint);
          logger.warn("Push endpoint expired — disabled", {
            endpoint: pushSub.endpoint,
            statusCode,
          });
          continue;
        }
        throw error;
      }
    }
  }

  return sent;
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
  const db = options.db ?? (await getDb());

  const subscriptions = await listEnabledSubscriptions(db);
  const pushSubs = await listEnabledPushSubscriptions(db);
  const dateKey = utcDateKey(now);
  // (push subscription id, event type) pairs already evaluated via a nearby
  // email subscription's candidates — the standalone pass skips these.
  const covered = new Set<string>();

  let sent = 0;
  for (const subscription of subscriptions) {
    const candidates = await buildCandidates(subscription, now, fetcher);

    for (const candidate of candidates) {
      const claimed = await insertAlertLogIfNotExists(db, {
        subscriptionId: candidate.subscriptionId,
        eventType: candidate.eventType,
        message: candidate.message.subject,
        dateKey,
      });
      if (!claimed) {
        continue; // already alerted for this event today
      }

      try {
        await sender.send(
          candidate.email,
          withUnsubscribeFooter(candidate.message, subscription),
        );
        sent += 1;
      } catch (error) {
        // Roll back the claim so a transient send failure doesn't swallow
        // the alert — the next run will retry it. Then fail loudly.
        await removeAlertLog(db, {
          subscriptionId: candidate.subscriptionId,
          eventType: candidate.eventType,
          dateKey,
        });
        throw error;
      }
    }

    sent += await dispatchPushAlerts({
      subscription,
      candidates,
      db,
      dateKey,
      pushSubs,
      covered,
    });
  }

  // Standalone push pass: browsers with push-only subscriptions (or event
  // types no nearby email subscription covers) still get evaluated — at their
  // own location, with their own event selection. Atomic per-day dedup means
  // anything already dispatched above can never be double-sent.
  let pushChecked = 0;
  for (const pushSub of pushSubs) {
    const uncoveredEvents = pushSub.events
      .split(",")
      .map((event) => event.trim())
      .filter(Boolean)
      .filter((event) => !covered.has(`${pushSub.id}:${event}`));
    if (uncoveredEvents.length === 0) {
      continue;
    }
    pushChecked += 1;

    const brief = await buildTonightBrief(
      { lat: pushSub.lat, lon: pushSub.lon },
      { now, fetcher },
    );
    const timeZone = timeZoneFor(pushSub.lat, pushSub.lon);
    const synthetic: SubscriptionLike = {
      id: pushSub.id,
      email: "",
      lat: pushSub.lat,
      lon: pushSub.lon,
      events: uncoveredEvents.join(","),
    };
    const candidates = candidatesFromBrief(synthetic, brief, now, timeZone);
    if (candidates.length > 0) {
      sent += await dispatchPushAlerts({
        subscription: synthetic,
        candidates,
        db,
        dateKey,
        pushSubs: [pushSub],
        covered,
      });
    }
  }

  return { checked: subscriptions.length + pushChecked, sent };
}

// ─── Weekly digest ─────────────────────────────────────────────────────────

export interface DigestOptions {
  sender?: AlertSender;
  now?: Date;
  fetcher?: typeof fetch;
  db?: SkyDb;
}

/**
 * Compose the weekly "sky highlights" email from a computed brief — as
 * plain text for compatibility and as styled HTML for the pretty version.
 */
export function composeDigestMessage(
  brief: SkyBrief,
  now: Date,
  timeZone?: string,
  unsubscribeUrl?: string,
): AlertMessage {
  const lines: string[] = [
    `Weekly sky highlights for your location (${brief.location.lat.toFixed(2)}, ${brief.location.lon.toFixed(2)}):`,
  ];

  const nextPasses = brief.issPasses.slice(0, 3);
  if (nextPasses.length > 0) {
    lines.push("", "Satellite passes:");
    for (const pass of nextPasses) {
      lines.push(
        `  • ${formatDayTime(pass.start, timeZone)} — ${pass.satelliteName ?? "Satellite"}, max ${pass.maxElevationDeg}° for ${Math.round(pass.durationMinutes)} min`,
      );
    }
  }

  const showersSoon = brief.showers.filter(
    (shower) => shower.daysUntilPeak >= 0 && shower.daysUntilPeak <= 14,
  );
  if (showersSoon.length > 0) {
    lines.push("", "Meteor showers:");
    for (const shower of showersSoon) {
      lines.push(
        `  • ${shower.name} peaks ${shower.daysUntilPeak === 0 ? "tonight" : `in ${shower.daysUntilPeak} days`} (~${shower.zhr}/hr)`,
      );
    }
  }

  if (brief.aurora) {
    lines.push(
      "",
      `Aurora watch: predicted Kp ${brief.aurora.maxKpTonight} (${brief.aurora.level}).`,
    );
  }

  const moonLine = `Moon: ${brief.moon.phaseName}, ${Math.round(brief.moon.illumination * 100)}% illuminated.`;
  lines.push("", moonLine, "");
  const dateLabel = now.toLocaleDateString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  lines.push(dateLabel);

  const quiet = nextPasses.length === 0 && showersSoon.length === 0 && !brief.aurora;
  if (quiet) {
    lines.splice(1, 0, "", "Nothing notable this week — the sky is quiet.");
  }

  const sections: DigestSection[] = [];
  if (nextPasses.length > 0) {
    sections.push({
      title: "Satellite passes",
      items: nextPasses.map(
        (pass) =>
          `${formatDayTime(pass.start, timeZone)} — ${pass.satelliteName ?? "Satellite"}, max ${pass.maxElevationDeg}° for ${Math.round(pass.durationMinutes)} min`,
      ),
    });
  }
  if (showersSoon.length > 0) {
    sections.push({
      title: "Meteor showers",
      items: showersSoon.map(
        (shower) =>
          `${shower.name} peaks ${shower.daysUntilPeak === 0 ? "tonight" : `in ${shower.daysUntilPeak} days`} (~${shower.zhr}/hr)`,
      ),
    });
  }
  if (brief.aurora) {
    sections.push({
      title: "Aurora watch",
      items: [`Predicted Kp ${brief.aurora.maxKpTonight} (${brief.aurora.level}). ${brief.aurora.viewingLatitudeHint}.`],
    });
  }
  sections.push({ title: "Moon", items: [moonLine] });

  return {
    subject: "Sky Concierge — weekly sky highlights",
    body: lines.join("\n"),
    html: renderDigestEmail({
      dateLabel,
      sections,
      quietNote: quiet ? "Nothing notable this week — the sky is quiet." : undefined,
      unsubscribeUrl,
    }),
  };
}

/**
 * Send the weekly digest to every verified subscription, at most once per
 * ISO week (dedup via the same atomic alert_logs mechanism).
 */
export async function runDigestCheck(
  options: DigestOptions = {},
): Promise<AlertCheckResult> {
  const sender = options.sender ?? createSender();
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const db = options.db ?? (await getDb());

  const weekKey = isoWeekKey(now);
  const subscriptions = await listEnabledSubscriptions(db);

  let sent = 0;
  for (const subscription of subscriptions) {
    const claimed = await insertAlertLogIfNotExists(db, {
      subscriptionId: subscription.id,
      eventType: "digest",
      message: "weekly digest",
      dateKey: weekKey,
    });
    if (!claimed) {
      continue; // digest already sent this week
    }

    try {
      const brief = await buildTonightBrief(
        { lat: subscription.lat, lon: subscription.lon },
        { now, fetcher, noradIds: noradIdsFor(subscription) },
      );
      const timeZone = timeZoneFor(subscription.lat, subscription.lon);
      await sender.send(
        subscription.email,
        withUnsubscribeFooter(
          composeDigestMessage(
            brief,
            now,
            timeZone,
            unsubscribeUrlFor(subscription),
          ),
          subscription,
        ),
      );
      sent += 1;
    } catch (error) {
      await removeAlertLog(db, {
        subscriptionId: subscription.id,
        eventType: "digest",
        dateKey: weekKey,
      });
      throw error;
    }
  }

  return { checked: subscriptions.length, sent };
}

// Re-exported for callers that want an explicit console sender in tests/scripts.
export { ConsoleSender };
