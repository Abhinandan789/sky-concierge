import type { SkyDb } from "./types";

/**
 * Postgres schema for Sky Concierge. Idempotent by design — CREATE TABLE IF
 * NOT EXISTS plus per-column ALTER TABLE ... ADD COLUMN IF NOT EXISTS — so a
 * pre-existing database converges on startup without a migration tool.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL,
  lat                   DOUBLE PRECISION NOT NULL,
  lon                   DOUBLE PRECISION NOT NULL,
  events                TEXT NOT NULL DEFAULT 'iss,aurora,showers',
  satellite_ids         TEXT,
  pending_satellite_ids TEXT,
  pending_lat           DOUBLE PRECISION,
  pending_lon           DOUBLE PRECISION,
  enabled               INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS alert_logs (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  message         TEXT NOT NULL,
  date_key        TEXT NOT NULL,
  sent_at         TEXT NOT NULL DEFAULT (now()::text),
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
  lat        DOUBLE PRECISION NOT NULL,
  lon        DOUBLE PRECISION NOT NULL,
  events     TEXT NOT NULL DEFAULT 'iss,aurora,showers',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE IF NOT EXISTS push_logs (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  message         TEXT NOT NULL,
  date_key        TEXT NOT NULL,
  sent_at         TEXT NOT NULL DEFAULT (now()::text),
  FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  UNIQUE(subscription_id, event_type, date_key)
);

CREATE TABLE IF NOT EXISTS email_events (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  event_type TEXT NOT NULL,
  email_id   TEXT,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE INDEX IF NOT EXISTS idx_email_events_email ON email_events(email, created_at);
`;

/** Columns added after the initial schema — converged onto existing tables. */
const EXTRA_COLUMNS = [
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS verify_token TEXT`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS pending_events TEXT`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS satellite_ids TEXT`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS pending_satellite_ids TEXT`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS pending_lat DOUBLE PRECISION`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS pending_lon DOUBLE PRECISION`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'ok'`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS bounced_at TEXT`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS last_email_event TEXT`,
  `ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS last_email_event_at TEXT`,
];

/**
 * Bring a database to the current schema. Runs once per database instance, at
 * adapter creation, before any query function is used.
 */
export async function initSchema(db: SkyDb): Promise<void> {
  await db.exec(SCHEMA_SQL);
  for (const ddl of EXTRA_COLUMNS) {
    await db.exec(ddl);
  }
  // Rows that predate the token columns (or were created before double opt-in)
  // are treated as verified and get working tokens immediately, so existing
  // subscribers' confirmation/unsubscribe links keep working.
  await db.exec(
    `UPDATE alert_subscriptions
     SET verified = 1,
         unsubscribe_token = COALESCE(unsubscribe_token, lower(replace(gen_random_uuid()::text, '-', ''))),
         verify_token = COALESCE(verify_token, lower(replace(gen_random_uuid()::text, '-', '')))
     WHERE unsubscribe_token IS NULL OR verify_token IS NULL`,
  );
}
