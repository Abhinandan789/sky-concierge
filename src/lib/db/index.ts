import { randomUUID } from "node:crypto";
import type { SkyDb } from "./types";

export type { SkyDb } from "./types";

export interface AlertSubscriptionRow {
  id: string;
  email: string;
  lat: number;
  lon: number;
  events: string;
  enabled: number;
  /** 1 once the subscriber confirmed their email (double opt-in). */
  verified: number;
  verifyToken: string | null;
  unsubscribeToken: string | null;
  /** Events requested by an unverified re-submit of a verified row; applied
   * only after the owner confirms (NULL = no pending change). */
  pendingEvents: string | null;
  /** Comma-separated NORAD ids tracked for this subscription (NULL = the
   * server-configured set). */
  satelliteIds: string | null;
  /** NORAD ids requested by an unverified re-submit of a verified row. */
  pendingSatelliteIds: string | null;
  createdAt: string;
}

export interface AlertLogRow {
  id: string;
  subscriptionId: string;
  eventType: string;
  message: string;
  dateKey: string;
  sentAt: string;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lat: number;
  lon: number;
  events: string;
  enabled: number;
  createdAt: string;
}

export interface EmailEventRow {
  id: string;
  email: string;
  eventType: string;
  emailId: string | null;
  detail: string;
  createdAt: string;
}

/** Delivery state of an email subscription, updated by the Resend webhook. */
export type EmailStatus = "ok" | "delivered" | "bounced" | "complained";

const globalForDb = globalThis as unknown as {
  skyDb: Promise<SkyDb> | undefined;
};

/**
 * App-wide database singleton. Production reads DATABASE_URL (hosted
 * Postgres/Neon). With the URL unset or set to ":memory:", an ephemeral
 * in-memory Postgres (PGlite) is used — ideal for local dev and tests, but
 * nothing persists across restarts. The Postgres adapter is only loaded when
 * a real URL is configured, so the WASM-backed PGlite never ships into the
 * deployed bundle path.
 */
export function getDb(): Promise<SkyDb> {
  if (!globalForDb.skyDb) {
    const url = process.env.DATABASE_URL ?? "";
    globalForDb.skyDb =
      url && url !== ":memory:"
        ? import("./pg").then((m) => m.createPostgresDb(url))
        : import("./memory").then((m) => m.createMemoryDb());
  }
  return globalForDb.skyDb;
}

function newToken() {
  return randomUUID().replace(/-/g, "");
}

export interface UpsertSubscriptionInput {
  email: string;
  lat: number;
  lon: number;
  events: string;
  /** Comma-separated NORAD ids; empty/undefined = the server-configured set. */
  satelliteIds?: string;
  /**
   * Whether the subscription skips email confirmation. Defaults to true (the
   * console/dev path); the API passes false when it will send a real
   * verification email and expects the subscriber to confirm.
   */
  verified?: boolean;
}

export interface UpsertSubscriptionResult {
  id: string;
  verified: boolean;
  verifyToken: string;
  unsubscribeToken: string;
  /** True when the request only changed events/enabled pending confirmation
   * (an unverified re-submit of an already-verified row). */
  pendingChange: boolean;
}

/**
 * Create or refresh the subscription for an email address. Returns the
 * subscription id — the same id on re-subscribe at any location, so an
 * address never ends up with two rows (and thus two sets of alert emails).
 *
 * Security model for unverified re-submits (double opt-in): a request that
 * isn't verified may never mutate an already-verified row's events, location
 * or enabled state. Instead the requested changes are parked in the pending_*
 * columns and applied only after the owner confirms via email. An attacker
 * who knows an address can therefore neither re-enable an opted-out
 * subscription, move it to a new location, nor change which alerts the owner
 * receives.
 */
export async function upsertSubscription(
  db: SkyDb,
  input: UpsertSubscriptionInput,
): Promise<UpsertSubscriptionResult> {
  const { email, lat, lon, events } = input;
  const satelliteIds = input.satelliteIds?.trim() || null;
  const verified = input.verified ?? true;
  const verifyToken = newToken();
  const unsubscribeToken = newToken();

  await db.run(
    `INSERT INTO alert_subscriptions
       (id, email, lat, lon, events, satellite_ids, enabled, verified,
        verify_token, unsubscribe_token, pending_events, pending_satellite_ids,
        pending_lat, pending_lon)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, NULL, NULL, NULL, NULL)
     ON CONFLICT (email) DO UPDATE SET
       -- Verified requests (console mode) and pending rows move the location
       -- in place; unverified re-submits of a verified row leave it parked.
       lat = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0
           THEN excluded.lat
           ELSE alert_subscriptions.lat
       END,
       lon = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0
           THEN excluded.lon
           ELSE alert_subscriptions.lon
       END,
       verified = GREATEST(alert_subscriptions.verified, excluded.verified),
       verify_token = excluded.verify_token,
       -- A verified row keeps its unsubscribe token: an unverified re-submit
       -- must neither harvest nor rotate the owner's token.
       unsubscribe_token = CASE
         WHEN alert_subscriptions.verified = 1
           THEN alert_subscriptions.unsubscribe_token
           ELSE excluded.unsubscribe_token
       END,
       events = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0
           THEN excluded.events
           ELSE alert_subscriptions.events
       END,
       satellite_ids = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0
           THEN excluded.satellite_ids
           ELSE alert_subscriptions.satellite_ids
       END,
       enabled = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0
           THEN 1
           ELSE alert_subscriptions.enabled
       END,
       -- Park changes to a verified row until the owner confirms: different
       -- events, satellites or location, or a re-enable request against an
       -- opted-out subscription. NULL vs NULL never parks (IS DISTINCT FROM
       -- is the null-safe inequality).
       pending_events = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0 THEN NULL
         WHEN excluded.events != alert_subscriptions.events THEN excluded.events
         WHEN alert_subscriptions.enabled = 0 THEN alert_subscriptions.events
         ELSE alert_subscriptions.pending_events
       END,
       pending_satellite_ids = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0 THEN NULL
         WHEN excluded.satellite_ids IS DISTINCT FROM alert_subscriptions.satellite_ids
           THEN excluded.satellite_ids
         ELSE alert_subscriptions.pending_satellite_ids
       END,
       pending_lat = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0 THEN NULL
         WHEN excluded.lat != alert_subscriptions.lat THEN excluded.lat
         ELSE alert_subscriptions.pending_lat
       END,
       pending_lon = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0 THEN NULL
         WHEN excluded.lon != alert_subscriptions.lon THEN excluded.lon
         ELSE alert_subscriptions.pending_lon
       END`,
    [
      randomUUID(),
      email,
      lat,
      lon,
      events,
      satelliteIds,
      verified ? 1 : 0,
      verifyToken,
      unsubscribeToken,
    ],
  );

  const row = await db.get<{
    id: string;
    verified: number;
    verify_token: string;
    unsubscribe_token: string;
    pending_events: string | null;
    pending_satellite_ids: string | null;
    pendingLat: number | null;
    pendingLon: number | null;
  }>(
    `SELECT id, verified, verify_token, unsubscribe_token, pending_events,
            pending_satellite_ids, pending_lat AS "pendingLat",
            pending_lon AS "pendingLon"
     FROM alert_subscriptions WHERE email = $1`,
    [email],
  );

  if (!row) {
    throw new Error("Subscription insert failed.");
  }
  return {
    id: row.id,
    verified: row.verified === 1,
    verifyToken: row.verify_token,
    unsubscribeToken: row.unsubscribe_token,
    pendingChange:
      row.pending_events !== null ||
      row.pending_satellite_ids !== null ||
      row.pendingLat !== null ||
      row.pendingLon !== null,
  };
}

/** Verified + enabled subscriptions only — unconfirmed emails never receive alerts. */
export async function listEnabledSubscriptions(
  db: SkyDb,
): Promise<AlertSubscriptionRow[]> {
  return db.all<AlertSubscriptionRow>(
    `SELECT id, email, lat, lon, events, enabled, verified,
            verify_token AS "verifyToken", unsubscribe_token AS "unsubscribeToken",
            satellite_ids AS "satelliteIds",
            pending_satellite_ids AS "pendingSatelliteIds",
            created_at AS "createdAt"
     FROM alert_subscriptions
     WHERE enabled = 1 AND verified = 1`,
  );
}

/** Disable a subscription by its unsubscribe token. Returns true when found. */
export async function disableSubscription(
  db: SkyDb,
  token: string,
): Promise<boolean> {
  const changes = await db.run(
    `UPDATE alert_subscriptions SET enabled = 0 WHERE unsubscribe_token = $1`,
    [token],
  );
  return changes > 0;
}

/**
 * Confirm a subscription's email by its verification token. Also applies any
 * pending changes (events, satellites or location from an unverified
 * re-submit) — the owner confirming the email is the authorization for those
 * mutations.
 */
export async function verifySubscription(
  db: SkyDb,
  token: string,
): Promise<boolean> {
  const changes = await db.run(
    `UPDATE alert_subscriptions
     SET verified = 1,
         lat = COALESCE(pending_lat, lat),
         lon = COALESCE(pending_lon, lon),
         events = COALESCE(pending_events, events),
         satellite_ids = COALESCE(pending_satellite_ids, satellite_ids),
         enabled = 1,
         pending_events = NULL,
         pending_satellite_ids = NULL,
         pending_lat = NULL,
         pending_lon = NULL
     WHERE verify_token = $1`,
    [token],
  );
  return changes > 0;
}

/**
 * Record a dispatched alert. Returns true only if the log was newly inserted —
 * the UNIQUE(subscription_id, event_type, date_key) constraint makes this
 * atomic, so concurrent runs can never double-send.
 */
export async function insertAlertLogIfNotExists(
  db: SkyDb,
  input: {
    subscriptionId: string;
    eventType: string;
    message: string;
    dateKey: string;
  },
): Promise<boolean> {
  const changes = await db.run(
    `INSERT INTO alert_logs (id, subscription_id, event_type, message, date_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subscription_id, event_type, date_key) DO NOTHING`,
    [
      randomUUID(),
      input.subscriptionId,
      input.eventType,
      input.message,
      input.dateKey,
    ],
  );
  return changes > 0;
}

/**
 * Remove a claimed alert log entry. Used to roll back a claim when the send
 * fails, so the alert is retried on the next run instead of being swallowed.
 */
export async function removeAlertLog(
  db: SkyDb,
  input: { subscriptionId: string; eventType: string; dateKey: string },
): Promise<void> {
  await db.run(
    `DELETE FROM alert_logs
     WHERE subscription_id = $1 AND event_type = $2 AND date_key = $3`,
    [input.subscriptionId, input.eventType, input.dateKey],
  );
}

// ─── Email delivery tracking (Resend webhook) ──────────────────────────────

export interface EmailWebhookInput {
  /** Recipient address the event is about. */
  email: string;
  /** Resend event type, e.g. "email.delivered" / "email.bounced". */
  eventType: string;
  emailId?: string | null;
  /** Resend bounce_type ("Permanent" / "Transient" / "Undetermined"). */
  bounceType?: string | null;
  /** Short human-readable detail stored on the event log. */
  detail?: string;
}

/**
 * Record a Resend delivery event and reflect it on the matching subscription
 * (matched by the recipient's email — the address is the stable key across
 * subscription moves). Bounces/complaints mark the row as failed: the status
 * flips to "bounced"/"complained", `bounced_at` is stamped, and the
 * subscription is disabled so the alert engine stops emailing a dead address.
 * Transient bounces stay enabled (Resend retries those on its own).
 *
 * Returns the affected subscription id, or null when no subscription uses the
 * address (e.g. a verification email for a signup that was never completed).
 */
export async function applyEmailWebhookEvent(
  db: SkyDb,
  input: EmailWebhookInput,
): Promise<string | null> {
  await db.run(
    `INSERT INTO email_events (id, email, event_type, email_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      randomUUID(),
      input.email,
      input.eventType,
      input.emailId ?? null,
      input.detail ?? "",
    ],
  );

  const now = new Date().toISOString();
  const failed =
    input.eventType === "email.bounced" ||
    input.eventType === "email.complained";
  // Permanent (and undetermined) bounces kill the address; transient ones are
  // usually full mailboxes Resend keeps retrying, so leave the sub enabled.
  const permanent =
    input.eventType === "email.complained" ||
    (input.eventType === "email.bounced" && input.bounceType !== "Transient");

  const status: EmailStatus =
    input.eventType === "email.bounced"
      ? "bounced"
      : input.eventType === "email.complained"
        ? "complained"
        : "delivered";

  const changes = await db.run(
    `UPDATE alert_subscriptions
     SET email_status = $1,
         last_email_event = $2,
         last_email_event_at = $3,
         bounced_at = CASE WHEN $4 THEN COALESCE(bounced_at, $5) ELSE bounced_at END,
         enabled = CASE WHEN $6 THEN 0 ELSE enabled END
     WHERE email = $7 AND enabled = 1`,
    [
      status,
      input.eventType,
      now,
      failed,
      now,
      permanent,
      input.email,
    ],
  );

  if (changes === 0) {
    return null;
  }
  const row = await db.get<{ id: string }>(
    `SELECT id FROM alert_subscriptions WHERE email = $1`,
    [input.email],
  );
  return row?.id ?? null;
}

/** Latest delivery events for an address (webhook debugging / admin). */
export async function listEmailEvents(
  db: SkyDb,
  email: string,
  limit = 50,
): Promise<EmailEventRow[]> {
  return db.all<EmailEventRow>(
    `SELECT id, email, event_type AS "eventType", email_id AS "emailId",
            detail, created_at AS "createdAt"
     FROM email_events WHERE email = $1 ORDER BY created_at DESC LIMIT $2`,
    [email, limit],
  );
}

// ─── Push subscriptions ────────────────────────────────────────────────────

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  lat: number;
  lon: number;
  events: string;
}

/** Create or refresh a browser push subscription (keyed by endpoint). */
export async function upsertPushSubscription(
  db: SkyDb,
  input: PushSubscriptionInput,
): Promise<string> {
  const { endpoint, p256dh, auth, lat, lon, events } = input;
  await db.run(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, lat, lon, events, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       lat = excluded.lat,
       lon = excluded.lon,
       events = excluded.events,
       enabled = 1`,
    [randomUUID(), endpoint, p256dh, auth, lat, lon, events],
  );

  const row = await db.get<{ id: string }>(
    `SELECT id FROM push_subscriptions WHERE endpoint = $1`,
    [endpoint],
  );
  if (!row) {
    throw new Error("Push subscription insert failed.");
  }
  return row.id;
}

export async function listEnabledPushSubscriptions(
  db: SkyDb,
): Promise<PushSubscriptionRow[]> {
  return db.all<PushSubscriptionRow>(
    `SELECT id, endpoint, p256dh, auth, lat, lon, events, enabled,
            created_at AS "createdAt"
     FROM push_subscriptions WHERE enabled = 1`,
  );
}

/** Disable a push subscription by endpoint (e.g. after the browser unsubscribes). */
export async function disablePushSubscription(
  db: SkyDb,
  endpoint: string,
): Promise<boolean> {
  const changes = await db.run(
    `UPDATE push_subscriptions SET enabled = 0 WHERE endpoint = $1`,
    [endpoint],
  );
  return changes > 0;
}

/** Dedup for push notifications, mirroring alert_logs. */
export async function insertPushLogIfNotExists(
  db: SkyDb,
  input: {
    subscriptionId: string;
    eventType: string;
    message: string;
    dateKey: string;
  },
): Promise<boolean> {
  const changes = await db.run(
    `INSERT INTO push_logs (id, subscription_id, event_type, message, date_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subscription_id, event_type, date_key) DO NOTHING`,
    [
      randomUUID(),
      input.subscriptionId,
      input.eventType,
      input.message,
      input.dateKey,
    ],
  );
  return changes > 0;
}

export async function removePushLog(
  db: SkyDb,
  input: { subscriptionId: string; eventType: string; dateKey: string },
): Promise<void> {
  await db.run(
    `DELETE FROM push_logs
     WHERE subscription_id = $1 AND event_type = $2 AND date_key = $3`,
    [input.subscriptionId, input.eventType, input.dateKey],
  );
}
