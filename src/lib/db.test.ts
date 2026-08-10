import { describe, expect, it } from "vitest";
import {
  createSkyDb,
  insertAlertLogIfNotExists,
  listEnabledSubscriptions,
  upsertSubscription,
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

    expect(second).toBe(first);
    expect(listEnabledSubscriptions(db)).toHaveLength(1);
  });

  it("dedupes alerts per subscription + event + UTC day", () => {
    const db = createSkyDb(":memory:");
    const id = upsertSubscription(db, {
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
    expect(
      insertAlertLogIfNotExists(db, { ...log, eventType: "aurora" }),
    ).toBe(true);
    // The same event on a new day is allowed.
    expect(
      insertAlertLogIfNotExists(db, { ...log, dateKey: "2026-08-12" }),
    ).toBe(true);
  });

  it("lists only enabled subscriptions", () => {
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

    db.prepare("UPDATE alert_subscriptions SET enabled = 0 WHERE email = ?").run(
      "c@d.co",
    );

    expect(listEnabledSubscriptions(db)).toHaveLength(1);
    expect(listEnabledSubscriptions(db)[0].email).toBe("a@b.co");
  });
});
