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
  it("keeps one subscription per (email, lat, lon)", () => {
    const db = createSkyDb(":memory:");

    const first = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });
    const second = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss,showers",
    });

    expect(second.id).toBe(first.id);
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
    // events — it must NOT apply, and must not rotate the owner's token.
    const second = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss,aurora",
      verified: false,
    });
    expect(second.verified).toBe(true);
    expect(second.unsubscribeToken).toBe(first.unsubscribeToken);
    expect(second.pendingChange).toBe(true);
    const row = db
      .prepare(
        `SELECT events, enabled, pending_events AS pendingEvents
         FROM alert_subscriptions WHERE email = 'a@b.co'`,
      )
      .get() as {
      events: string;
      enabled: number;
      pendingEvents: string | null;
    };
    expect(row.events).toBe("iss"); // unchanged
    expect(row.enabled).toBe(1);
    expect(row.pendingEvents).toBe("iss,aurora"); // parked, not applied

    // The owner confirming the email is what authorizes the change.
    expect(verifySubscription(db, second.verifyToken)).toBe(true);
    const after = db
      .prepare(
        `SELECT events, enabled, pending_events AS pendingEvents
         FROM alert_subscriptions WHERE email = 'a@b.co'`,
      )
      .get() as {
      events: string;
      enabled: number;
      pendingEvents: string | null;
    };
    expect(after.events).toBe("iss,aurora");
    expect(after.enabled).toBe(1);
    expect(after.pendingEvents).toBeNull();
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
});
