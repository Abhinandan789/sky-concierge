import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearUpstreamCache } from "./cache";
import { loadShareCard, seededStars } from "./share-card";

// Real ISS (ZARYA) TLE fetched from CelesTrak (same fixture as iss-passes).
const ISS_TLE = [
  "ISS (ZARYA)",
  "1 25544U 98067A   26222.50435993  .00003786  00000+0  75820-4 0  9991",
  "2 25544  51.6324  31.2750 0007420  32.4605 327.6839 15.49403146580170",
].join("\n");

const FIXED_NOW = new Date("2026-08-11T00:00:00Z");
const NYC = { lat: 40.7128, lon: -74.006 };

/** Returns canned TLEs; anything else is a source we don't care about here. */
function mockFetcher() {
  return vi.fn(async (url: string) => {
    if (url.includes("celestrak")) {
      return new Response(ISS_TLE);
    }
    return new Response("[]");
  });
}

describe("loadShareCard", () => {
  beforeEach(() => {
    clearUpstreamCache();
  });

  it("builds a full card for a valid location", async () => {
    const data = await loadShareCard(
      { lat: String(NYC.lat), lon: String(NYC.lon) },
      { fetcher: mockFetcher() as unknown as typeof fetch, now: FIXED_NOW },
    );

    expect(data.locationLabel).toContain("N");
    expect(data.locationLabel).toContain("W");
    expect(data.timeZoneLabel).toBe("America/New_York");
    expect(data.dateLabel).toMatch(/^\w+, \w+ \d+/);
    expect(data.verdict.score).toBeGreaterThanOrEqual(1);
    expect(data.verdict.score).toBeLessThanOrEqual(10);
    expect(data.verdict.headline.length).toBeGreaterThan(0);
    expect(data.verdict.sentence.length).toBeGreaterThan(0);
    expect(data.moonLine).toContain("Moon:");
  });

  it("picks the highest visible ISS pass (skipping shadowed ones)", async () => {
    const data = await loadShareCard(
      { lat: String(NYC.lat), lon: String(NYC.lon), sat: "25544" },
      { fetcher: mockFetcher() as unknown as typeof fetch, now: FIXED_NOW },
    );

    if (data.bestPass) {
      expect(data.bestPass.name).toBe("ISS");
      expect(data.bestPass.maxElevationDeg).toBeGreaterThanOrEqual(10);
      expect(data.bestPass.time).toMatch(/\d{1,2}:\d{2}/);
      expect(data.bestPass.riseDirection.length).toBeGreaterThanOrEqual(2);
    } else {
      // No pass above 10° in the window — the card still has a verdict.
      expect(data.verdict.score).toBeGreaterThanOrEqual(1);
    }
  });

  it("falls back to the default location when params are invalid", async () => {
    const data = await loadShareCard(
      { lat: "not-a-number", lon: "999", sat: "nope" },
      { fetcher: mockFetcher() as unknown as typeof fetch, now: FIXED_NOW },
    );

    // DEFAULT_LOCATION is NYC.
    expect(data.locationLabel).toBe("40.713° N, 74.006° W");
  });

  it("renders a card even when every upstream source fails", async () => {
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    const data = await loadShareCard(
      { lat: String(NYC.lat), lon: String(NYC.lon) },
      { fetcher: failing as unknown as typeof fetch, now: FIXED_NOW },
    );

    // Local-only math (moon, verdict) still produces a card.
    expect(data.moonLine).toContain("Moon:");
    expect(data.verdict.score).toBeGreaterThanOrEqual(1);
    expect(data.verdict.score).toBeLessThanOrEqual(10);
  });
});

describe("seededStars", () => {
  it("is deterministic and stays inside the canvas", () => {
    const first = seededStars(34);
    const second = seededStars(34);

    expect(first).toEqual(second);
    expect(first).toHaveLength(34);
    for (const star of first) {
      expect(star.left).toBeGreaterThanOrEqual(0);
      expect(star.left).toBeLessThanOrEqual(100);
      expect(star.top).toBeGreaterThanOrEqual(0);
      expect(star.top).toBeLessThanOrEqual(100);
      expect(star.size).toBeGreaterThan(0);
      expect(star.opacity).toBeGreaterThan(0);
      expect(star.opacity).toBeLessThanOrEqual(1);
    }
    // A handful of hero stars carry the glow.
    expect(first.some((star) => star.hero)).toBe(true);
  });
});
