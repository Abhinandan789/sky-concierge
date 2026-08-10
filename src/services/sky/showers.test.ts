import { describe, expect, it } from "vitest";
import { computeShowerStatus, MAJOR_SHOWERS } from "./showers";

describe("computeShowerStatus", () => {
  it("marks the Perseids as peaking tonight on August 12", () => {
    const status = computeShowerStatus(new Date(2026, 7, 12));
    const perseids = status.find((shower) => shower.name === "Perseids");

    expect(perseids?.isPeakTonight).toBe(true);
    expect(perseids?.daysUntilPeak).toBe(0);
    expect(perseids?.peakDate).toBe("2026-08-12");
  });

  it("marks the Geminids as peaking tonight on December 14", () => {
    const status = computeShowerStatus(new Date(2026, 11, 14));
    expect(status.find((shower) => shower.name === "Geminids")?.isPeakTonight).toBe(
      true,
    );
  });

  it("reports upcoming peaks with positive day counts", () => {
    const status = computeShowerStatus(new Date(2026, 7, 5));
    const perseids = status.find((shower) => shower.name === "Perseids");

    expect(perseids?.daysUntilPeak).toBe(7);
    expect(perseids?.isPeakingThisWeek).toBe(true);
  });

  it("covers all major showers with positive rates and ISO peak dates", () => {
    expect(MAJOR_SHOWERS.length).toBeGreaterThanOrEqual(8);
    for (const shower of MAJOR_SHOWERS) {
      expect(shower.zhr).toBeGreaterThan(0);
    }

    for (const shower of computeShowerStatus(new Date(2026, 0, 1))) {
      expect(shower.peakDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
