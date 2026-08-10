import { describe, expect, it } from "vitest";
import { computeMoonInfo, phaseName } from "./moon";

const NYC = { lat: 40.7128, lon: -74.006 };
const FIXED_NOW = new Date("2026-08-11T20:00:00Z");

describe("phaseName", () => {
  it("maps the eight phase buckets to names", () => {
    expect(phaseName(0)).toBe("New Moon");
    expect(phaseName(0.25)).toBe("First Quarter");
    expect(phaseName(0.5)).toBe("Full Moon");
    expect(phaseName(0.75)).toBe("Last Quarter");
    expect(phaseName(0.99)).toBe("New Moon");
  });
});

describe("computeMoonInfo", () => {
  it("returns a well-formed moon report", () => {
    const info = computeMoonInfo(NYC, FIXED_NOW);

    expect(info.illumination).toBeGreaterThanOrEqual(0);
    expect(info.illumination).toBeLessThanOrEqual(1);
    expect([
      "New Moon",
      "Waxing Crescent",
      "First Quarter",
      "Waxing Gibbous",
      "Full Moon",
      "Waning Gibbous",
      "Last Quarter",
      "Waning Crescent",
    ]).toContain(info.phaseName);
    expect(info.darkHours).toBeGreaterThanOrEqual(0);
    expect(info.darkHours).toBeLessThanOrEqual(14);
    expect(info.moonrise === null || info.moonrise instanceof Date).toBe(true);
    expect(info.moonset === null || info.moonset instanceof Date).toBe(true);
  });

  it("produces a viewing window whose start precedes its end", () => {
    const info = computeMoonInfo(NYC, FIXED_NOW);

    if (info.bestViewingWindow !== null) {
      expect(info.bestViewingWindow.start.getTime()).toBeLessThan(
        info.bestViewingWindow.end.getTime(),
      );
    }
  });

  it("is deterministic for identical inputs", () => {
    expect(computeMoonInfo(NYC, FIXED_NOW)).toEqual(
      computeMoonInfo(NYC, FIXED_NOW),
    );
  });
});
