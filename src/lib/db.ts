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

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL,
  lat                   REAL NOT NULL,
  lon                   REAL NOT NULL,
  events                TEXT NOT NULL DEFAULT 'iss,aurora,showers',
  satellite_ids         TEXT,
  pending_satellite_ids TEXT,
  pending_lat           REAL,
  pending_lon           REAL,
  enabled               INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email)
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
  ensureColumn(
    db,
    "alert_subscriptions",
    "pending_events",
    "pending_events TEXT",
  );
  ensureColumn(
    db,
    "alert_subscriptions",
    "satellite_ids",
    "satellite_ids TEXT",
  );
  ensureColumn(
    db,
    "alert_subscriptions",
    "pending_satellite_ids",
    "pending_satellite_ids TEXT",
  );
  ensureColumn(db, "alert_subscriptions", "pending_lat", "pending_lat REAL");
  ensureColumn(db, "alert_subscriptions", "pending_lon", "pending_lon REAL");

  // Existing subscribers predate double opt-in; treat them as verified and
  // give them unsubscribe tokens so links work immediately.
  db.exec(
    `UPDATE alert_subscriptions
     SET verified = 1,
         unsubscribe_token = COALESCE(unsubscribe_token, lower(hex(randomblob(16)))),
         verify_token = COALESCE(verify_token, lower(hex(randomblob(16))))
     WHERE unsubscribe_token IS NULL OR verify_token IS NULL`,
  );

  migrateToUniqueEmail(db);

  return db;
}

/**
 * Migrate databases created before subscriptions were unique per email address.
 *
 * v0.1–v0.3 keyed subscriptions on (email, lat, lon), so the same address at a
 * different location silently became a second row — meaning duplicate alert
 * emails. This rebuilds the table with UNIQUE(email) and keeps a single row per
 * address: the newest verified one wins (so an owner's confirmed row and its
 * unsubscribe token survive), otherwise the newest row. Runs only when the
 * legacy constraint is detected, so it's a no-op for fresh databases.
 */
function migrateToUniqueEmail(db: DatabaseSync): void {
  const table = db
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE type = 'table' AND name = 'alert_subscriptions'`,
    )
    .get() as { sql?: string } | undefined;
  if (!table?.sql?.includes("UNIQUE(email, lat, lon)")) {
    return;
  }

  db.exec(`CREATE TABLE alert_subscriptions_new (
    id                    TEXT PRIMARY KEY,
    email                 TEXT NOT NULL,
    lat                   REAL NOT NULL,
    lon                   REAL NOT NULL,
    events                TEXT NOT NULL DEFAULT 'iss,aurora,showers',
    satellite_ids         TEXT,
    pending_satellite_ids TEXT,
    pending_lat           REAL,
    pending_lon           REAL,
    enabled               INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    verified              INTEGER NOT NULL DEFAULT 0,
    verify_token          TEXT,
    unsubscribe_token     TEXT,
    pending_events        TEXT,
    UNIQUE(email)
  );`);

  db.exec(`INSERT INTO alert_subscriptions_new
    SELECT s.id, s.email, s.lat, s.lon, s.events, s.satellite_ids,
           s.pending_satellite_ids, s.pending_lat, s.pending_lon,
           s.enabled, s.created_at, s.verified, s.verify_token,
           s.unsubscribe_token, s.pending_events
    FROM alert_subscriptions s
    WHERE s.id = (
      SELECT s2.id FROM alert_subscriptions s2
      WHERE s2.email = s.email
      ORDER BY s2.verified DESC, s2.created_at DESC, s2.id
      LIMIT 1
    )`);

  db.exec(`DROP TABLE alert_subscriptions`);
  db.exec(`ALTER TABLE alert_subscriptions_new RENAME TO alert_subscriptions`);

  // Dropped duplicates leave orphaned log rows behind (foreign keys are off by
  // default in SQLite); sweep them so alert_logs only ever references live rows.
  db.exec(`DELETE FROM alert_logs
    WHERE subscription_id NOT IN (SELECT id FROM alert_subscriptions)`);
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
export function upsertSubscription(
  db: DatabaseSync,
  input: UpsertSubscriptionInput,
): UpsertSubscriptionResult {
  const { email, lat, lon, events } = input;
  const satelliteIds = input.satelliteIds?.trim() || null;
  const verified = input.verified ?? true;
  const verifyToken = newToken();
  const unsubscribeToken = newToken();

  db.prepare(
    `INSERT INTO alert_subscriptions
       (id, email, lat, lon, events, satellite_ids, enabled, verified,
        verify_token, unsubscribe_token, pending_events, pending_satellite_ids,
        pending_lat, pending_lon)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL, NULL, NULL)
     ON CONFLICT(email) DO UPDATE SET
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
       verified = MAX(alert_subscriptions.verified, excluded.verified),
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
       -- opted-out subscription. NULL vs NULL never parks (IS NOT is false).
       pending_events = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0 THEN NULL
         WHEN excluded.events != alert_subscriptions.events THEN excluded.events
         WHEN alert_subscriptions.enabled = 0 THEN alert_subscriptions.events
         ELSE alert_subscriptions.pending_events
       END,
       pending_satellite_ids = CASE
         WHEN excluded.verified = 1 OR alert_subscriptions.verified = 0 THEN NULL
         WHEN excluded.satellite_ids IS NOT alert_subscriptions.satellite_ids
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
  ).run(
    randomUUID(),
    email,
    lat,
    lon,
    events,
    satelliteIds,
    verified ? 1 : 0,
    verifyToken,
    unsubscribeToken,
  );

  const row = db
    .prepare(
      `SELECT id, verified, verify_token, unsubscribe_token, pending_events,
              pending_satellite_ids, pending_lat AS pendingLat,
              pending_lon AS pendingLon
       FROM alert_subscriptions WHERE email = ?`,
    )
    .get(email) as
    | {
        id: string;
        verified: number;
        verify_token: string;
        unsubscribe_token: string;
        pending_events: string | null;
        pending_satellite_ids: string | null;
        pendingLat: number | null;
        pendingLon: number | null;
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
    pendingChange:
      row.pending_events !== null ||
      row.pending_satellite_ids !== null ||
      row.pendingLat !== null ||
      row.pendingLon !== null,
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
              satellite_ids AS satelliteIds,
              pending_satellite_ids AS pendingSatelliteIds,
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

/**
 * Confirm a subscription's email by its verification token. Also applies any
 * pending changes (events, satellites or location from an unverified
 * re-submit) — the owner confirming the email is the authorization for those
 * mutations.
 */
export function verifySubscription(db: DatabaseSync, token: string): boolean {
  const result = db
    .prepare(
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
       WHERE verify_token = ?`,
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
