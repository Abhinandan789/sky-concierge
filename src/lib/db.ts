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
`;

/**
 * Open (and initialize) a Sky Concierge database. The schema is idempotent so
 * no migration tooling is needed — CREATE TABLE IF NOT EXISTS on startup.
 */
export function createSkyDb(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA_SQL);
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

/**
 * Create or refresh a subscription for (email, lat, lon). Returns the
 * subscription id — the same id on re-subscribe, so no duplicates.
 */
export function upsertSubscription(
  db: DatabaseSync,
  input: { email: string; lat: number; lon: number; events: string },
): string {
  const { email, lat, lon, events } = input;
  db.prepare(
    `INSERT INTO alert_subscriptions (id, email, lat, lon, events, enabled)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(email, lat, lon) DO UPDATE SET events = excluded.events, enabled = 1`,
  ).run(randomUUID(), email, lat, lon, events);

  const row = db
    .prepare(`SELECT id FROM alert_subscriptions WHERE email = ? AND lat = ? AND lon = ?`)
    .get(email, lat, lon) as { id: string } | undefined;

  if (!row) {
    throw new Error("Subscription insert failed.");
  }
  return row.id;
}

export function listEnabledSubscriptions(db: DatabaseSync): AlertSubscriptionRow[] {
  return db
    .prepare(`SELECT id, email, lat, lon, events, enabled, created_at AS createdAt FROM alert_subscriptions WHERE enabled = 1`)
    .all() as unknown as AlertSubscriptionRow[];
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
