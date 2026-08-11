import { describe, expect, it, vi } from "vitest";
import { createSkyDb, upsertSubscription } from "@/lib/db";
import { formatTime } from "@/lib/utils";
import type { IssPass, SkyBrief } from "@/types";
import {
  candidatesFromBrief,
  composeDigestMessage,
  isoWeekKey,
  runAlertCheck,
  runDigestCheck,
} from "./checker";

const NOW = new Date("2026-08-11T20:00:00Z");

function makePass(startOffsetMinutes: number): IssPass {
  const start = new Date(NOW.getTime() + startOffsetMinutes * 60_000);
  return {
    start,
    max: new Date(start.getTime() + 3 * 60_000),
    end: new Date(start.getTime() + 6 * 60_000),
    maxElevationDeg: 45,
    maxAzimuthDeg: 135,
    durationMinutes: 6,
  };
}

function makeBrief(overrides: Partial<SkyBrief> = {}): SkyBrief {
  return {
    location: { lat: 40.71, lon: -74.01 },
    generatedAt: NOW,
    issPasses: [],
    aurora: null,
    showers: [],
    moon: {
      illumination: 0.5,
      phaseName: "Full Moon",
      moonrise: null,
      moonset: null,
      bestViewingWindow: null,
      moonDownAllNight: false,
      darkHours: 0,
    },
    errors: [],
    ...overrides,
  };
}

const SUBSCRIPTION = {
  id: "sub-1",
  email: "a@b.co",
  lat: 40.71,
  lon: -74.01,
  events: "iss,aurora,showers",
};

/** A fetcher that never reaches the network — sections degrade gracefully. */
const offlineFetcher = (async () => {
  throw new Error("network unavailable");
}) as unknown as typeof fetch;

describe("candidatesFromBrief", () => {
  it("alerts when an ISS pass starts within the lead window", () => {
    const candidates = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({ issPasses: [makePass(30)] }),
      NOW,
    );
    expect(candidates.map((c) => c.eventType)).toContain("iss");
    expect(candidates.find((c) => c.eventType === "iss")?.message.subject).toBe(
      "ISS pass in ~30 min over your location",
    );
  });

  it("uses the satellite name in the alert subject when present", () => {
    const candidates = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({
        issPasses: [{ ...makePass(30), satelliteName: "ISS (ZARYA)" }],
      }),
      NOW,
    );
    expect(candidates.find((c) => c.eventType === "iss")?.message.subject).toBe(
      "ISS (ZARYA) pass in ~30 min over your location",
    );
  });

  it("renders alert times in the requested timezone", () => {
    const candidates = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({ issPasses: [makePass(30)] }),
      NOW,
      "America/New_York",
    );
    const body = candidates.find((c) => c.eventType === "iss")?.message.body;
    // The pass starts 30 min after NOW (20:00Z) → 20:30Z = 16:30 in New York.
    expect(body).toContain(
      formatTime(new Date(NOW.getTime() + 30 * 60_000), "America/New_York"),
    );
  });

  it("does not alert for an ISS pass already underway", () => {
    const candidates = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({ issPasses: [makePass(-5)] }),
      NOW,
    );
    expect(candidates.map((c) => c.eventType)).not.toContain("iss");
  });

  it("does not alert for an ISS pass more than an hour away", () => {
    const candidates = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({ issPasses: [makePass(90)] }),
      NOW,
    );
    expect(candidates.map((c) => c.eventType)).not.toContain("iss");
  });

  it("alerts for MODERATE or stronger aurora, never LOW", () => {
    const moderate = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({
        aurora: {
          maxKpTonight: 4.2,
          level: "MODERATE",
          viewingLatitudeHint: "hint",
        },
      }),
      NOW,
    );
    expect(moderate.map((c) => c.eventType)).toContain("aurora");

    const low = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({
        aurora: { maxKpTonight: 2, level: "LOW", viewingLatitudeHint: "hint" },
      }),
      NOW,
    );
    expect(low.map((c) => c.eventType)).not.toContain("aurora");
  });

  it("alerts for showers peaking within three days, not later or past", () => {
    const soon = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({
        showers: [
          {
            name: "Perseids",
            zhr: 100,
            peakDate: "2026-08-12",
            daysUntilPeak: 1,
            isPeakTonight: false,
            isPeakingThisWeek: true,
          },
        ],
      }),
      NOW,
    );
    expect(soon.map((c) => c.eventType)).toContain("showers");

    const far = candidatesFromBrief(
      SUBSCRIPTION,
      makeBrief({
        showers: [
          {
            name: "Geminids",
            zhr: 150,
            peakDate: "2026-12-14",
            daysUntilPeak: 125,
            isPeakTonight: false,
            isPeakingThisWeek: false,
          },
        ],
      }),
      NOW,
    );
    expect(far.map((c) => c.eventType)).not.toContain("showers");
  });

  it("respects the subscription's event selection", () => {
    const candidates = candidatesFromBrief(
      { ...SUBSCRIPTION, events: "aurora" },
      makeBrief({ issPasses: [makePass(30)] }),
      NOW,
    );
    expect(candidates).toHaveLength(0);
  });
});

describe("runAlertCheck", () => {
  it("dispatches due alerts once and dedupes on re-runs", async () => {
    const db = createSkyDb(":memory:");
    upsertSubscription(db, {
      email: "shower@example.com",
      lat: 40.71,
      lon: -74.01,
      events: "showers",
    });

    const sender = {
      send: vi.fn(async () => undefined),
    };

    // Aug 11 → Perseids peak in 1 day → shower alert is due.
    const now = new Date(2026, 7, 11, 20, 0, 0);

    const first = await runAlertCheck({
      db,
      sender,
      now,
      fetcher: offlineFetcher,
    });
    expect(first.checked).toBe(1);
    expect(first.sent).toBe(1);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(
      "shower@example.com",
      expect.objectContaining({ subject: expect.stringContaining("Perseids") }),
    );

    const second = await runAlertCheck({
      db,
      sender,
      now,
      fetcher: offlineFetcher,
    });
    expect(second.sent).toBe(0);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("rolls back the claim and rethrows when a send fails, then retries", async () => {
    const db = createSkyDb(":memory:");
    upsertSubscription(db, {
      email: "retry@example.com",
      lat: 40.71,
      lon: -74.01,
      events: "showers",
    });

    const failingSender = {
      send: vi.fn(async () => {
        throw new Error("smtp down");
      }),
    };
    const now = new Date(2026, 7, 11, 20, 0, 0);

    await expect(
      runAlertCheck({
        db,
        sender: failingSender,
        now,
        fetcher: offlineFetcher,
      }),
    ).rejects.toThrow("smtp down");

    // The claim was rolled back, so a healthy sender retries successfully.
    const healthySender = { send: vi.fn(async () => undefined) };
    const retry = await runAlertCheck({
      db,
      sender: healthySender,
      now,
      fetcher: offlineFetcher,
    });
    expect(retry.sent).toBe(1);
    expect(healthySender.send).toHaveBeenCalledTimes(1);
  });

  it("reports zero when nothing is due (no network needed)", async () => {
    const db = createSkyDb(":memory:");
    upsertSubscription(db, {
      email: "quiet@example.com",
      lat: 51.5,
      lon: -0.1,
      events: "aurora",
    });

    const sender = { send: vi.fn(async () => undefined) };
    const result = await runAlertCheck({
      db,
      sender,
      fetcher: offlineFetcher,
    });

    expect(result.sent).toBe(0);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("works with the console sender when no sender is provided", async () => {
    const db = createSkyDb(":memory:");
    upsertSubscription(db, {
      email: "console@example.com",
      lat: 40.71,
      lon: -74.01,
      events: "showers",
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await runAlertCheck({
        db,
        now: new Date(2026, 7, 11, 20, 0, 0),
        fetcher: offlineFetcher,
      });
      expect(result.sent).toBe(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("appends an unsubscribe link to every emailed alert", async () => {
    const db = createSkyDb(":memory:");
    const { unsubscribeToken } = upsertSubscription(db, {
      email: "unsub@example.com",
      lat: 40.71,
      lon: -74.01,
      events: "showers",
    });

    const sender = { send: vi.fn(async () => undefined) };
    await runAlertCheck({
      db,
      sender,
      now: new Date(2026, 7, 11, 20, 0, 0),
      fetcher: offlineFetcher,
    });

    const message = (
      sender.send.mock.calls[0] as unknown as [
        string,
        { subject: string; body: string },
      ]
    )[1];
    expect(message.body).toContain(`/unsubscribe?token=${unsubscribeToken}`);
  });
});

describe("isoWeekKey", () => {
  it("computes ISO week keys (incl. year-boundary weeks)", () => {
    // 2021-01-01 belongs to ISO week 53 of 2020.
    expect(isoWeekKey(new Date("2021-01-01T12:00:00Z"))).toBe("2020-W53");
    // Same week, different days → same key.
    expect(isoWeekKey(new Date("2026-08-10T00:00:00Z"))).toBe(
      isoWeekKey(new Date("2026-08-14T23:59:59Z")),
    );
    // Different weeks → different keys.
    expect(isoWeekKey(new Date("2026-08-10T12:00:00Z"))).not.toBe(
      isoWeekKey(new Date("2026-08-24T12:00:00Z")),
    );
  });
});

describe("composeDigestMessage", () => {
  it("mentions upcoming passes, showers and aurora when present", () => {
    const brief = makeBrief({
      issPasses: [{ ...makePass(60), satelliteName: "ISS (ZARYA)" }],
      aurora: { maxKpTonight: 5, level: "HIGH", viewingLatitudeHint: "hint" },
      showers: [
        {
          name: "Perseids",
          zhr: 100,
          peakDate: "2026-08-12",
          daysUntilPeak: 1,
          isPeakTonight: false,
          isPeakingThisWeek: true,
        },
      ],
    });
    const message = composeDigestMessage(brief, NOW);
    expect(message.subject).toBe("Sky Concierge — weekly sky highlights");
    expect(message.body).toContain("ISS (ZARYA)");
    expect(message.body).toContain("Perseids");
    expect(message.body).toContain("Aurora watch");
  });
});

describe("runDigestCheck", () => {
  it("sends a digest at most once per ISO week", async () => {
    const db = createSkyDb(":memory:");
    upsertSubscription(db, {
      email: "digest@example.com",
      lat: 40.71,
      lon: -74.01,
      events: "iss,aurora,showers",
    });

    const sender = { send: vi.fn(async () => undefined) };
    const now = new Date(2026, 7, 11, 20, 0, 0); // Tuesday

    const first = await runDigestCheck({
      db,
      sender,
      now,
      fetcher: offlineFetcher,
    });
    expect(first.checked).toBe(1);
    expect(first.sent).toBe(1);

    const second = await runDigestCheck({
      db,
      sender,
      now,
      fetcher: offlineFetcher,
    });
    expect(second.sent).toBe(0);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("skips unverified subscriptions", async () => {
    const db = createSkyDb(":memory:");
    upsertSubscription(db, {
      email: "pending@example.com",
      lat: 40.71,
      lon: -74.01,
      events: "iss",
      verified: false,
    });

    const sender = { send: vi.fn(async () => undefined) };
    const result = await runDigestCheck({
      db,
      sender,
      fetcher: offlineFetcher,
    });
    expect(result.checked).toBe(0);
    expect(sender.send).not.toHaveBeenCalled();
  });
});
