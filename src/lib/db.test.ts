import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  createSkyDb,
  disableSubscription,
  disablePushSubscription,
  insertAlertLogIfNotExists,
  listEnabledPushSubscriptions,
  listEnabledSubscriptions,
  upsertPushSubscription,
  upsertSubscription,
  verifySubscription,
} from "./db";

describe("SQLite data layer", () => {
  it("keeps one subscription per email — a new location updates in place", () => {
    const db = createSkyDb(":memory:");

    const first = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });
    // Same email at a different location: same row, location + events move.
    const second = upsertSubscription(db, {
      email: "a@b.co",
      lat: 51.5,
      lon: -0.1,
      events: "iss,showers",
    });

    expect(second.id).toBe(first.id);
    const row = db
      .prepare(
        "SELECT lat, lon, events FROM alert_subscriptions WHERE email = 'a@b.co'",
      )
      .get() as { lat: number; lon: number; events: string };
    expect(row.lat).toBe(51.5);
    expect(row.lon).toBe(-0.1);
    expect(row.events).toBe("iss,showers");
    expect(listEnabledSubscriptions(db)).toHaveLength(1);
  });

  it("dedupes alerts per subscription + event + UTC day", () => {
    const db = createSkyDb(":memory:");
    const { id } = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });

    const log = {
      subscriptionId: id,
      eventType: "iss",
      message: "ISS pass alert",
      dateKey: "2026-08-11",
    };

    expect(insertAlertLogIfNotExists(db, log)).toBe(true);
    // Same event, same day — deduplicated.
    expect(insertAlertLogIfNotExists(db, log)).toBe(false);
    // A different event on the same day is allowed.
    expect(insertAlertLogIfNotExists(db, { ...log, eventType: "aurora" })).toBe(
      true,
    );
    // The same event on a new day is allowed.
    expect(
      insertAlertLogIfNotExists(db, { ...log, dateKey: "2026-08-12" }),
    ).toBe(true);
  });

  it("lists only enabled + verified subscriptions", () => {
    const db = createSkyDb(":memory:");
    upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });
    upsertSubscription(db, {
      email: "c@d.co",
      lat: 51.5,
      lon: -0.1,
      events: "aurora",
    });
    // Unverified (double opt-in pending) — must never be listed.
    upsertSubscription(db, {
      email: "pending@e.co",
      lat: 10,
      lon: 20,
      events: "iss",
      verified: false,
    });

    db.prepare(
      "UPDATE alert_subscriptions SET enabled = 0 WHERE email = ?",
    ).run("c@d.co");

    const listed = listEnabledSubscriptions(db);
    expect(listed).toHaveLength(1);
    expect(listed[0].email).toBe("a@b.co");
  });

  it("never mutates a verified row on an unverified re-submit — changes wait for confirmation", () => {
    const db = createSkyDb(":memory:");
    const first = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });

    // An unverified request (double opt-in pending) tries to change the
    // events and the location — neither must apply, and the owner's token
    // must not rotate.
    const second = upsertSubscription(db, {
      email: "a@b.co",
      lat: 51.5,
      lon: -0.1,
      events: "iss,aurora",
      verified: false,
    });
    expect(second.verified).toBe(true);
    expect(second.unsubscribeToken).toBe(first.unsubscribeToken);
    expect(second.pendingChange).toBe(true);
    const row = db
      .prepare(
        `SELECT events, enabled, lat, lon,
                pending_events AS pendingEvents,
                pending_lat AS pendingLat, pending_lon AS pendingLon
         FROM alert_subscriptions WHERE email = 'a@b.co'`,
      )
      .get() as {
      events: string;
      enabled: number;
      lat: number;
      lon: number;
      pendingEvents: string | null;
      pendingLat: number | null;
      pendingLon: number | null;
    };
    expect(row.events).toBe("iss"); // unchanged
    expect(row.enabled).toBe(1);
    expect(row.pendingEvents).toBe("iss,aurora"); // parked, not applied
    expect(row.lat).toBe(40.7); // location unchanged
    expect(row.lon).toBe(-74);
    expect(row.pendingLat).toBe(51.5); // new location parked
    expect(row.pendingLon).toBe(-0.1);

    // The owner confirming the email is what authorizes the changes.
    expect(verifySubscription(db, second.verifyToken)).toBe(true);
    const after = db
      .prepare(
        `SELECT events, enabled, lat, lon,
                pending_events AS pendingEvents,
                pending_lat AS pendingLat, pending_lon AS pendingLon
         FROM alert_subscriptions WHERE email = 'a@b.co'`,
      )
      .get() as {
      events: string;
      enabled: number;
      lat: number;
      lon: number;
      pendingEvents: string | null;
      pendingLat: number | null;
      pendingLon: number | null;
    };
    expect(after.events).toBe("iss,aurora");
    expect(after.enabled).toBe(1);
    expect(after.lat).toBe(51.5); // moved only after confirmation
    expect(after.lon).toBe(-0.1);
    expect(after.pendingEvents).toBeNull();
    expect(after.pendingLat).toBeNull();
    expect(after.pendingLon).toBeNull();
  });

  it("cannot re-enable an opted-out subscription without confirmation", () => {
    const db = createSkyDb(":memory:");
    const first = upsertSubscription(db, {
      email: "out@x.co",
      lat: 10,
      lon: 20,
      events: "iss",
    });
    disableSubscription(db, first.unsubscribeToken);
    expect(
      (
        db.prepare("SELECT enabled FROM alert_subscriptions").get() as {
          enabled: number;
        }
      ).enabled,
    ).toBe(0);

    // Same events, but the request is unverified — re-enabling is parked too.
    const resubmit = upsertSubscription(db, {
      email: "out@x.co",
      lat: 10,
      lon: 20,
      events: "iss",
      verified: false,
    });
    expect(resubmit.pendingChange).toBe(true);
    expect(
      (
        db.prepare("SELECT enabled FROM alert_subscriptions").get() as {
          enabled: number;
        }
      ).enabled,
    ).toBe(0);

    // Confirming the email re-enables and clears the pending change.
    expect(verifySubscription(db, resubmit.verifyToken)).toBe(true);
    const after = db
      .prepare(
        `SELECT enabled, pending_events AS pendingEvents
         FROM alert_subscriptions`,
      )
      .get() as { enabled: number; pendingEvents: string | null };
    expect(after.enabled).toBe(1);
    expect(after.pendingEvents).toBeNull();
  });

  it("stores per-subscription satellite ids (NULL = server default)", () => {
    const db = createSkyDb(":memory:");
    upsertSubscription(db, {
      email: "multi@x.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
      satelliteIds: "48274,25544",
    });

    const listed = listEnabledSubscriptions(db);
    expect(listed).toHaveLength(1);
    expect(listed[0].satelliteIds).toBe("48274,25544");

    // No selection → NULL, so the checker falls back to the server set.
    upsertSubscription(db, {
      email: "default@x.co",
      lat: 51.5,
      lon: -0.1,
      events: "iss",
    });
    const [multi, fallback] = listEnabledSubscriptions(db);
    expect(multi.satelliteIds).toBe("48274,25544");
    expect(fallback.satelliteIds).toBeNull();
  });

  it("parks a satellite change from an unverified re-submit until confirmation", () => {
    const db = createSkyDb(":memory:");
    const first = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
      satelliteIds: "25544",
    });

    // Unverified re-submit asks to track a different satellite — the stored
    // ids must NOT change until the owner confirms the email.
    const second = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
      satelliteIds: "48274",
      verified: false,
    });
    expect(second.pendingChange).toBe(true);
    expect(second.unsubscribeToken).toBe(first.unsubscribeToken);
    const row = db
      .prepare(
        `SELECT satellite_ids AS satelliteIds,
                pending_satellite_ids AS pendingSatelliteIds
         FROM alert_subscriptions WHERE email = 'a@b.co'`,
      )
      .get() as {
      satelliteIds: string | null;
      pendingSatelliteIds: string | null;
    };
    expect(row.satelliteIds).toBe("25544"); // unchanged
    expect(row.pendingSatelliteIds).toBe("48274"); // parked

    // Confirming applies the parked satellite change.
    expect(verifySubscription(db, second.verifyToken)).toBe(true);
    const after = db
      .prepare(
        `SELECT satellite_ids AS satelliteIds,
                pending_satellite_ids AS pendingSatelliteIds
         FROM alert_subscriptions WHERE email = 'a@b.co'`,
      )
      .get() as {
      satelliteIds: string | null;
      pendingSatelliteIds: string | null;
    };
    expect(after.satelliteIds).toBe("48274");
    expect(after.pendingSatelliteIds).toBeNull();
  });

  it("a never-confirmed row still gets fresh tokens on every re-submit", () => {
    const db = createSkyDb(":memory:");
    const pending = upsertSubscription(db, {
      email: "p@q.co",
      lat: 1,
      lon: 2,
      events: "iss",
      verified: false,
    });
    const pendingAgain = upsertSubscription(db, {
      email: "p@q.co",
      lat: 1,
      lon: 2,
      events: "aurora",
      verified: false,
    });
    expect(pendingAgain.verifyToken).not.toBe(pending.verifyToken);
    expect(pendingAgain.unsubscribeToken).not.toBe(pending.unsubscribeToken);
  });

  it("confirms subscriptions by verify token", () => {
    const db = createSkyDb(":memory:");
    const { verifyToken } = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
      verified: false,
    });

    expect(listEnabledSubscriptions(db)).toHaveLength(0);
    expect(verifySubscription(db, "bogus")).toBe(false);
    expect(verifySubscription(db, verifyToken)).toBe(true);
    expect(listEnabledSubscriptions(db)).toHaveLength(1);
  });

  it("disables subscriptions by unsubscribe token", () => {
    const db = createSkyDb(":memory:");
    const { unsubscribeToken } = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });

    expect(listEnabledSubscriptions(db)).toHaveLength(1);
    expect(disableSubscription(db, "bogus")).toBe(false);
    expect(disableSubscription(db, unsubscribeToken)).toBe(true);
    expect(listEnabledSubscriptions(db)).toHaveLength(0);
  });

  it("stores and disables push subscriptions by endpoint", () => {
    const db = createSkyDb(":memory:");
    const endpoint = "https://push.example.com/abc";
    const id = upsertPushSubscription(db, {
      endpoint,
      p256dh: "key1",
      auth: "auth1",
      lat: 40.7,
      lon: -74,
      events: "iss,aurora",
    });

    expect(id).toBeTruthy();
    expect(listEnabledPushSubscriptions(db)).toHaveLength(1);

    // Re-registering the same endpoint updates in place, no duplicates.
    upsertPushSubscription(db, {
      endpoint,
      p256dh: "key2",
      auth: "auth2",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });
    expect(listEnabledPushSubscriptions(db)).toHaveLength(1);
    expect(listEnabledPushSubscriptions(db)[0].p256dh).toBe("key2");

    expect(disablePushSubscription(db, endpoint)).toBe(true);
    expect(listEnabledPushSubscriptions(db)).toHaveLength(0);
  });

  it("migrates legacy (email, lat, lon) databases to one row per email", () => {
    const dir = mkdtempSync(join(tmpdir(), "sky-db-"));
    const path = join(dir, "legacy.db");
    try {
      // A pre-v0.3.1 database: unique per (email, lat, lon), so the same
      // address at two locations exists as two rows.
      const legacy = new DatabaseSync(path);
      legacy.exec(`CREATE TABLE alert_subscriptions (
        id                    TEXT PRIMARY KEY,
        email                 TEXT NOT NULL,
        lat                   REAL NOT NULL,
        lon                   REAL NOT NULL,
        events                TEXT NOT NULL DEFAULT 'iss,aurora,showers',
        satellite_ids         TEXT,
        pending_satellite_ids TEXT,
        enabled               INTEGER NOT NULL DEFAULT 1,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        verified              INTEGER NOT NULL DEFAULT 0,
        verify_token          TEXT,
        unsubscribe_token     TEXT,
        pending_events        TEXT,
        UNIQUE(email, lat, lon)
      );`);
      const insert = legacy.prepare(
        `INSERT INTO alert_subscriptions
           (id, email, lat, lon, events, verified, unsubscribe_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run("stale", "dup@x.co", 30, 40, "aurora", 0, "stale-token");
      insert.run("owner", "dup@x.co", 10, 20, "iss", 1, "owner-token");
      insert.run("solo", "solo@y.co", 5, 5, "iss", 1, "solo-token");
      legacy.close();

      const db = createSkyDb(path); // runs the migration on startup
      const rows = db
        .prepare("SELECT id, lat, lon FROM alert_subscriptions ORDER BY id")
        .all() as { id: string; lat: number; lon: number }[];
      // The verified owner row survives; the stale duplicate is dropped.
      expect(rows).toEqual([
        { id: "owner", lat: 10, lon: 20 },
        { id: "solo", lat: 5, lon: 5 },
      ]);
      // The migrated table is unique per email: another row now conflicts.
      expect(() =>
        db
          .prepare(
            `INSERT INTO alert_subscriptions
               (id, email, lat, lon, events)
             VALUES ('another', 'dup@x.co', 99, 99, 'iss')`,
          )
          .run(),
      ).toThrow();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
