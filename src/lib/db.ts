import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  events     TEXT NOT NULL DEFAULT 'iss,aurora,showers',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email, lat, lon)
);

CREATE TABLE IF NOT EXISTS alert_logs (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  message         TEXT NOT NULL,
  date_key        TEXT NOT NULL,
  sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (subscription_id) REFERENCES alert_subscriptions(id) ON DELETE CASCADE,
  UNIQUE(subscription_id, event_type, date_key)
);

CREATE INDEX IF NOT EXISTS idx_logs_sub_event_sent
  ON alert_logs(subscription_id, event_type, sent_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  events     TEXT NOT NULL DEFAULT 'iss,aurora,showers',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_logs (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  message         TEXT NOT NULL,
  date_key        TEXT NOT NULL,
  sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  UNIQUE(subscription_id, event_type, date_key)
);
`;

/**
 * Idempotently add a column that may not exist on databases created before it
 * was introduced. Keeps the "no migrations CLI" promise: the schema converges
 * on startup regardless of which version created the file.
 */
function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  ddl: string,
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as { name: string }[];
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * Open (and initialize) a Sky Concierge database. The schema is idempotent so
 * no migration tooling is needed — CREATE TABLE IF NOT EXISTS on startup,
 * plus column additions for pre-existing databases.
 */
export function createSkyDb(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA_SQL);

  // Columns added after v0.1 — existing databases get them on next startup.
  ensureColumn(
    db,
    "alert_subscriptions",
    "verified",
    "verified INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(db, "alert_subscriptions", "verify_token", "verify_token TEXT");
  ensureColumn(
    db,
    "alert_subscriptions",
    "unsubscribe_token",
    "unsubscribe_token TEXT",
  );

  // Existing subscribers predate double opt-in; treat them as verified and
  // give them unsubscribe tokens so links work immediately.
  db.exec(
    `UPDATE alert_subscriptions
     SET verified = 1,
         unsubscribe_token = COALESCE(unsubscribe_token, lower(hex(randomblob(16)))),
         verify_token = COALESCE(verify_token, lower(hex(randomblob(16))))
     WHERE unsubscribe_token IS NULL OR verify_token IS NULL`,
  );

  return db;
}

const globalForDb = globalThis as unknown as {
  skyDb: DatabaseSync | undefined;
};

/** App-wide singleton; keeps Next.js dev hot-reload from reopening the DB. */
export function getDb(): DatabaseSync {
  if (!globalForDb.skyDb) {
    globalForDb.skyDb = createSkyDb(process.env.SKY_DB_PATH ?? "data/sky.db");
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
}

/**
 * Create or refresh a subscription for (email, lat, lon). Returns the
 * subscription id — the same id on re-subscribe, so no duplicates. Re-subscribing
 * an already-verified subscriber keeps them verified; unverified ones get a
 * fresh confirmation token.
 */
export function upsertSubscription(
  db: DatabaseSync,
  input: UpsertSubscriptionInput,
): UpsertSubscriptionResult {
  const { email, lat, lon, events } = input;
  const verified = input.verified ?? true;
  const verifyToken = newToken();
  const unsubscribeToken = newToken();

  db.prepare(
    `INSERT INTO alert_subscriptions
       (id, email, lat, lon, events, enabled, verified, verify_token, unsubscribe_token)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(email, lat, lon) DO UPDATE SET
       events = excluded.events,
       enabled = 1,
       verified = MAX(alert_subscriptions.verified, excluded.verified),
       verify_token = excluded.verify_token,
       -- A verified row keeps its unsubscribe token: an unverified re-submit
       -- (e.g. someone submitting an address they don't control) must neither
       -- harvest nor rotate the owner's token. Unverified rows get fresh ones.
       unsubscribe_token = CASE
         WHEN alert_subscriptions.verified = 1
           THEN alert_subscriptions.unsubscribe_token
           ELSE excluded.unsubscribe_token
       END`,
  ).run(
    randomUUID(),
    email,
    lat,
    lon,
    events,
    verified ? 1 : 0,
    verifyToken,
    unsubscribeToken,
  );

  const row = db
    .prepare(
      `SELECT id, verified, verify_token, unsubscribe_token
       FROM alert_subscriptions WHERE email = ? AND lat = ? AND lon = ?`,
    )
    .get(email, lat, lon) as
    | {
        id: string;
        verified: number;
        verify_token: string;
        unsubscribe_token: string;
      }
    | undefined;

  if (!row) {
    throw new Error("Subscription insert failed.");
  }
  return {
    id: row.id,
    verified: row.verified === 1,
    verifyToken: row.verify_token,
    unsubscribeToken: row.unsubscribe_token,
  };
}

/** Verified + enabled subscriptions only — unconfirmed emails never receive alerts. */
export function listEnabledSubscriptions(
  db: DatabaseSync,
): AlertSubscriptionRow[] {
  return db
    .prepare(
      `SELECT id, email, lat, lon, events, enabled, verified,
              verify_token AS verifyToken, unsubscribe_token AS unsubscribeToken,
              created_at AS createdAt
       FROM alert_subscriptions
       WHERE enabled = 1 AND verified = 1`,
    )
    .all() as unknown as AlertSubscriptionRow[];
}

/** Disable a subscription by its unsubscribe token. Returns true when found. */
export function disableSubscription(db: DatabaseSync, token: string): boolean {
  const result = db
    .prepare(
      `UPDATE alert_subscriptions SET enabled = 0 WHERE unsubscribe_token = ?`,
    )
    .run(token);
  return result.changes > 0;
}

/** Confirm a subscription's email by its verification token. */
export function verifySubscription(db: DatabaseSync, token: string): boolean {
  const result = db
    .prepare(
      `UPDATE alert_subscriptions SET verified = 1 WHERE verify_token = ?`,
    )
    .run(token);
  return result.changes > 0;
}

/**
 * Record a dispatched alert. Returns true only if the log was newly inserted —
 * the UNIQUE(subscription_id, event_type, date_key) constraint makes this
 * atomic, so concurrent runs can never double-send.
 */
export function insertAlertLogIfNotExists(
  db: DatabaseSync,
  input: {
    subscriptionId: string;
    eventType: string;
    message: string;
    dateKey: string;
  },
): boolean {
  const result = db
    .prepare(
      `INSERT INTO alert_logs (id, subscription_id, event_type, message, date_key)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(subscription_id, event_type, date_key) DO NOTHING`,
    )
    .run(
      randomUUID(),
      input.subscriptionId,
      input.eventType,
      input.message,
      input.dateKey,
    );
  return result.changes > 0;
}

/**
 * Remove a claimed alert log entry. Used to roll back a claim when the send
 * fails, so the alert is retried on the next run instead of being swallowed.
 */
export function removeAlertLog(
  db: DatabaseSync,
  input: { subscriptionId: string; eventType: string; dateKey: string },
): void {
  db.prepare(
    `DELETE FROM alert_logs
     WHERE subscription_id = ? AND event_type = ? AND date_key = ?`,
  ).run(input.subscriptionId, input.eventType, input.dateKey);
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
export function upsertPushSubscription(
  db: DatabaseSync,
  input: PushSubscriptionInput,
): string {
  const { endpoint, p256dh, auth, lat, lon, events } = input;
  db.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, lat, lon, events, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       lat = excluded.lat,
       lon = excluded.lon,
       events = excluded.events,
       enabled = 1`,
  ).run(randomUUID(), endpoint, p256dh, auth, lat, lon, events);

  const row = db
    .prepare(`SELECT id FROM push_subscriptions WHERE endpoint = ?`)
    .get(endpoint) as { id: string } | undefined;
  if (!row) {
    throw new Error("Push subscription insert failed.");
  }
  return row.id;
}

export function listEnabledPushSubscriptions(
  db: DatabaseSync,
): PushSubscriptionRow[] {
  return db
    .prepare(
      `SELECT id, endpoint, p256dh, auth, lat, lon, events, enabled, created_at AS createdAt
       FROM push_subscriptions WHERE enabled = 1`,
    )
    .all() as unknown as PushSubscriptionRow[];
}

/** Disable a push subscription by endpoint (e.g. after the browser unsubscribes). */
export function disablePushSubscription(
  db: DatabaseSync,
  endpoint: string,
): boolean {
  const result = db
    .prepare(`UPDATE push_subscriptions SET enabled = 0 WHERE endpoint = ?`)
    .run(endpoint);
  return result.changes > 0;
}

/** Dedup for push notifications, mirroring alert_logs. */
export function insertPushLogIfNotExists(
  db: DatabaseSync,
  input: {
    subscriptionId: string;
    eventType: string;
    message: string;
    dateKey: string;
  },
): boolean {
  const result = db
    .prepare(
      `INSERT INTO push_logs (id, subscription_id, event_type, message, date_key)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(subscription_id, event_type, date_key) DO NOTHING`,
    )
    .run(
      randomUUID(),
      input.subscriptionId,
      input.eventType,
      input.message,
      input.dateKey,
    );
  return result.changes > 0;
}

export function removePushLog(
  db: DatabaseSync,
  input: { subscriptionId: string; eventType: string; dateKey: string },
): void {
  db.prepare(
    `DELETE FROM push_logs
     WHERE subscription_id = ? AND event_type = ? AND date_key = ?`,
  ).run(input.subscriptionId, input.eventType, input.dateKey);
}
