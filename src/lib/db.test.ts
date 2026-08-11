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

  it("keeps a verified row's unsubscribe token stable across unverified re-submits", () => {
    const db = createSkyDb(":memory:");
    const first = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });

    // Re-submitting as unverified (double opt-in pending) must not rotate the
    // verified row's token — that would let anyone who knows an address and
    // coordinates invalidate the owner's saved unsubscribe link.
    const second = upsertSubscription(db, {
      email: "a@b.co",
      lat: 40.7,
      lon: -74,
      events: "iss,aurora",
      verified: false,
    });
    expect(second.verified).toBe(true);
    expect(second.unsubscribeToken).toBe(first.unsubscribeToken);

    // A never-confirmed row still gets fresh tokens on every re-submit.
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
