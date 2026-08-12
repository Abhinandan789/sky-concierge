import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "./db/memory";
import type { SkyDb } from "./db/types";

// One PGlite per file (its WASM compile is a ~10s one-time cost); tests get
// isolation via a full table wipe instead of a fresh instance.
let db: SkyDb;

beforeAll(async () => {
  db = await createMemoryDb();
});

beforeEach(async () => {
  await db.exec(
    `DELETE FROM email_events;
     DELETE FROM push_logs;
     DELETE FROM alert_logs;
     DELETE FROM push_subscriptions;
     DELETE FROM alert_subscriptions;`,
  );
});
import {
  applyEmailWebhookEvent,
  disableSubscription,
  disablePushSubscription,
  insertAlertLogIfNotExists,
  listEmailEvents,
  listEnabledPushSubscriptions,
  listEnabledSubscriptions,
  upsertPushSubscription,
  upsertSubscription,
  verifySubscription,
} from "./db";

describe("data layer", () => {
  it("keeps one subscription per email — a new location updates in place", async () => {

    const first = await upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });
    // Same email at a different location: same row, location + events move.
    const second = await upsertSubscription(db, {
      email: "a@b.co",
      lat: 51.5,
      lon: -0.1,
      events: "iss,showers",
    });

    expect(second.id).toBe(first.id);
    const row = (await db.get(
      "SELECT lat, lon, events FROM alert_subscriptions WHERE email = $1",
      ["a@b.co"],
    )) as { lat: number; lon: number; events: string };
    expect(row.lat).toBe(51.5);
    expect(row.lon).toBe(-0.1);
    expect(row.events).toBe("iss,showers");
    expect(await listEnabledSubscriptions(db)).toHaveLength(1);
  });

  it("dedupes alerts per subscription + event + UTC day", async () => {
    const { id } = await upsertSubscription(db, {
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

    expect(await insertAlertLogIfNotExists(db, log)).toBe(true);
    // Same event, same day — deduplicated.
    expect(await insertAlertLogIfNotExists(db, log)).toBe(false);
    // A different event on the same day is allowed.
    expect(
      await insertAlertLogIfNotExists(db, { ...log, eventType: "aurora" }),
    ).toBe(true);
    // The same event on a new day is allowed.
    expect(
      await insertAlertLogIfNotExists(db, { ...log, dateKey: "2026-08-12" }),
    ).toBe(true);
  });

  it("lists only enabled + verified subscriptions", async () => {
    await upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });
    await upsertSubscription(db, {
      email: "c@d.co",
      lat: 51.5,
      lon: -0.1,
      events: "aurora",
    });
    // Unverified (double opt-in pending) — must never be listed.
    await upsertSubscription(db, {
      email: "pending@e.co",
      lat: 10,
      lon: 20,
      events: "iss",
      verified: false,
    });

    await db.run(
      "UPDATE alert_subscriptions SET enabled = 0 WHERE email = $1",
      ["c@d.co"],
    );

    const listed = await listEnabledSubscriptions(db);
    expect(listed).toHaveLength(1);
    expect(listed[0].email).toBe("a@b.co");
  });

  it("never mutates a verified row on an unverified re-submit — changes wait for confirmation", async () => {
    const first = await upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });

    // An unverified request (double opt-in pending) tries to change the
    // events and the location — neither must apply, and the owner's token
    // must not rotate.
    const second = await upsertSubscription(db, {
      email: "a@b.co",
      lat: 51.5,
      lon: -0.1,
      events: "iss,aurora",
      verified: false,
    });
    expect(second.verified).toBe(true);
    expect(second.unsubscribeToken).toBe(first.unsubscribeToken);
    expect(second.pendingChange).toBe(true);
    const row = (await db.get(
      `SELECT events, enabled, lat, lon,
              pending_events AS "pendingEvents",
              pending_lat AS "pendingLat", pending_lon AS "pendingLon"
       FROM alert_subscriptions WHERE email = $1`,
      ["a@b.co"],
    )) as {
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
    expect(await verifySubscription(db, second.verifyToken)).toBe(true);
    const after = (await db.get(
      `SELECT events, enabled, lat, lon,
              pending_events AS "pendingEvents",
              pending_lat AS "pendingLat", pending_lon AS "pendingLon"
       FROM alert_subscriptions WHERE email = $1`,
      ["a@b.co"],
    )) as {
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

  it("cannot re-enable an opted-out subscription without confirmation", async () => {
    const first = await upsertSubscription(db, {
      email: "out@x.co",
      lat: 10,
      lon: 20,
      events: "iss",
    });
    await disableSubscription(db, first.unsubscribeToken);
    expect(
      ((await db.get("SELECT enabled FROM alert_subscriptions")) as {
        enabled: number;
      }).enabled,
    ).toBe(0);

    // Same events, but the request is unverified — re-enabling is parked too.
    const resubmit = await upsertSubscription(db, {
      email: "out@x.co",
      lat: 10,
      lon: 20,
      events: "iss",
      verified: false,
    });
    expect(resubmit.pendingChange).toBe(true);
    expect(
      ((await db.get("SELECT enabled FROM alert_subscriptions")) as {
        enabled: number;
      }).enabled,
    ).toBe(0);

    // Confirming the email re-enables and clears the pending change.
    expect(await verifySubscription(db, resubmit.verifyToken)).toBe(true);
    const after = (await db.get(
      `SELECT enabled, pending_events AS "pendingEvents"
       FROM alert_subscriptions`,
    )) as { enabled: number; pendingEvents: string | null };
    expect(after.enabled).toBe(1);
    expect(after.pendingEvents).toBeNull();
  });

  it("stores per-subscription satellite ids (NULL = server default)", async () => {
    await upsertSubscription(db, {
      email: "multi@x.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
      satelliteIds: "48274,25544",
    });

    const listed = await listEnabledSubscriptions(db);
    expect(listed).toHaveLength(1);
    expect(listed[0].satelliteIds).toBe("48274,25544");

    // No selection → NULL, so the checker falls back to the server set.
    await upsertSubscription(db, {
      email: "default@x.co",
      lat: 51.5,
      lon: -0.1,
      events: "iss",
    });
    const [multi, fallback] = await listEnabledSubscriptions(db);
    expect(multi.satelliteIds).toBe("48274,25544");
    expect(fallback.satelliteIds).toBeNull();
  });

  it("parks a satellite change from an unverified re-submit until confirmation", async () => {
    const first = await upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
      satelliteIds: "25544",
    });

    // Unverified re-submit asks to track a different satellite — the stored
    // ids must NOT change until the owner confirms the email.
    const second = await upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
      satelliteIds: "48274",
      verified: false,
    });
    expect(second.pendingChange).toBe(true);
    expect(second.unsubscribeToken).toBe(first.unsubscribeToken);
    const row = (await db.get(
      `SELECT satellite_ids AS "satelliteIds",
              pending_satellite_ids AS "pendingSatelliteIds"
       FROM alert_subscriptions WHERE email = $1`,
      ["a@b.co"],
    )) as {
      satelliteIds: string | null;
      pendingSatelliteIds: string | null;
    };
    expect(row.satelliteIds).toBe("25544"); // unchanged
    expect(row.pendingSatelliteIds).toBe("48274"); // parked

    // Confirming applies the parked satellite change.
    expect(await verifySubscription(db, second.verifyToken)).toBe(true);
    const after = (await db.get(
      `SELECT satellite_ids AS "satelliteIds",
              pending_satellite_ids AS "pendingSatelliteIds"
       FROM alert_subscriptions WHERE email = $1`,
      ["a@b.co"],
    )) as {
      satelliteIds: string | null;
      pendingSatelliteIds: string | null;
    };
    expect(after.satelliteIds).toBe("48274");
    expect(after.pendingSatelliteIds).toBeNull();
  });

  it("a never-confirmed row still gets fresh tokens on every re-submit", async () => {
    const pending = await upsertSubscription(db, {
      email: "p@q.co",
      lat: 1,
      lon: 2,
      events: "iss",
      verified: false,
    });
    const pendingAgain = await upsertSubscription(db, {
      email: "p@q.co",
      lat: 1,
      lon: 2,
      events: "aurora",
      verified: false,
    });
    expect(pendingAgain.verifyToken).not.toBe(pending.verifyToken);
    expect(pendingAgain.unsubscribeToken).not.toBe(pending.unsubscribeToken);
  });

  it("confirms subscriptions by verify token", async () => {
    const { verifyToken } = await upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
      verified: false,
    });

    expect(await listEnabledSubscriptions(db)).toHaveLength(0);
    expect(await verifySubscription(db, "bogus")).toBe(false);
    expect(await verifySubscription(db, verifyToken)).toBe(true);
    expect(await listEnabledSubscriptions(db)).toHaveLength(1);
  });

  it("disables subscriptions by unsubscribe token", async () => {
    const { unsubscribeToken } = await upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });

    expect(await listEnabledSubscriptions(db)).toHaveLength(1);
    expect(await disableSubscription(db, "bogus")).toBe(false);
    expect(await disableSubscription(db, unsubscribeToken)).toBe(true);
    expect(await listEnabledSubscriptions(db)).toHaveLength(0);
  });

  it("stores and disables push subscriptions by endpoint", async () => {
    const endpoint = "https://push.example.com/abc";
    const id = await upsertPushSubscription(db, {
      endpoint,
      p256dh: "key1",
      auth: "auth1",
      lat: 40.7,
      lon: -74,
      events: "iss,aurora",
    });

    expect(id).toBeTruthy();
    expect(await listEnabledPushSubscriptions(db)).toHaveLength(1);

    // Re-registering the same endpoint updates in place, no duplicates.
    await upsertPushSubscription(db, {
      endpoint,
      p256dh: "key2",
      auth: "auth2",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });
    expect(await listEnabledPushSubscriptions(db)).toHaveLength(1);
    expect((await listEnabledPushSubscriptions(db))[0].p256dh).toBe("key2");

    expect(await disablePushSubscription(db, endpoint)).toBe(true);
    expect(await listEnabledPushSubscriptions(db)).toHaveLength(0);
  });

  it("marks a permanent bounce as failed and disables the subscription", async () => {
    const { id } = await upsertSubscription(db, {
      email: "bounce@x.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });

    const affected = await applyEmailWebhookEvent(db, {
      email: "bounce@x.co",
      eventType: "email.bounced",
      emailId: "email_123",
      bounceType: "Permanent",
      detail: "bounce_type=Permanent",
    });

    expect(affected).toBe(id);
    const row = (await db.get(
      `SELECT enabled, email_status AS "emailStatus", bounced_at AS "bouncedAt"
       FROM alert_subscriptions WHERE email = $1`,
      ["bounce@x.co"],
    )) as {
      enabled: number;
      emailStatus: string;
      bouncedAt: string | null;
    };
    expect(row.enabled).toBe(0);
    expect(row.emailStatus).toBe("bounced");
    expect(row.bouncedAt).toBeTruthy();
    expect(await listEnabledSubscriptions(db)).toHaveLength(0);

    // The event itself is tracked in the email_events log.
    const events = await listEmailEvents(db, "bounce@x.co");
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("email.bounced");
    expect(events[0].emailId).toBe("email_123");
  });

  it("keeps a transient bounce enabled (Resend retries those)", async () => {
    await upsertSubscription(db, {
      email: "soft@x.co",
      lat: 1,
      lon: 2,
      events: "iss",
    });

    const affected = await applyEmailWebhookEvent(db, {
      email: "soft@x.co",
      eventType: "email.bounced",
      bounceType: "Transient",
    });
    expect(affected).toBeTruthy();
    const row = (await db.get(
      `SELECT enabled, email_status AS "emailStatus"
       FROM alert_subscriptions WHERE email = $1`,
      ["soft@x.co"],
    )) as { enabled: number; emailStatus: string };
    expect(row.enabled).toBe(1); // still delivering
    expect(row.emailStatus).toBe("bounced"); // but the failure is recorded
  });

  it("disables subscriptions on spam complaints and records deliveries", async () => {
    await upsertSubscription(db, {
      email: "complaint@x.co",
      lat: 1,
      lon: 2,
      events: "iss",
    });
    await upsertSubscription(db, {
      email: "happy@x.co",
      lat: 3,
      lon: 4,
      events: "aurora",
    });

    expect(
      await applyEmailWebhookEvent(db, {
        email: "complaint@x.co",
        eventType: "email.complained",
      }),
    ).toBeTruthy();
    expect(
      await applyEmailWebhookEvent(db, {
        email: "happy@x.co",
        eventType: "email.delivered",
        emailId: "email_9",
      }),
    ).toBeTruthy();

    const complained = (await db.get(
      `SELECT enabled, email_status AS "emailStatus"
       FROM alert_subscriptions WHERE email = $1`,
      ["complaint@x.co"],
    )) as { enabled: number; emailStatus: string };
    expect(complained.enabled).toBe(0);
    expect(complained.emailStatus).toBe("complained");

    const delivered = (await db.get(
      `SELECT enabled, email_status AS "emailStatus"
       FROM alert_subscriptions WHERE email = $1`,
      ["happy@x.co"],
    )) as { enabled: number; emailStatus: string };
    expect(delivered.enabled).toBe(1);
    expect(delivered.emailStatus).toBe("delivered");

    // Both events are on the log; deliveries land after bounces per address.
    expect((await listEmailEvents(db, "happy@x.co"))[0].eventType).toBe(
      "email.delivered",
    );
  });

  it("logs events for addresses without a subscription and returns null", async () => {
    expect(
      await applyEmailWebhookEvent(db, {
        email: "ghost@x.co",
        eventType: "email.bounced",
        bounceType: "Permanent",
      }),
    ).toBeNull();
    expect(await listEmailEvents(db, "ghost@x.co")).toHaveLength(1);
  });
});
