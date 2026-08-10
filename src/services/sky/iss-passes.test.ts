import { describe, expect, it } from "vitest";
import { findSatellitePasses } from "./iss-passes";

// Real ISS (ZARYA) TLE fetched from CelesTrak. Stays syntactically valid
// indefinitely — the tests only assert structural properties, not accuracy.
const ISS_TLE = {
  line1: "1 25544U 98067A   26222.50435993  .00003786  00000+0  75820-4 0  9991",
  line2: "2 25544  51.6324  31.2750 0007420  32.4605 327.6839 15.49403146580170",
};

const NYC = { lat: 40.7128, lon: -74.006 };
const FIXED_NOW = new Date("2026-08-11T00:00:00Z");

describe("findSatellitePasses", () => {
  it("finds at least one pass within 48 hours for a mid-latitude observer", () => {
    const passes = findSatellitePasses(
      ISS_TLE.line1,
      ISS_TLE.line2,
      NYC,
      { now: FIXED_NOW },
    );
    expect(passes.length).toBeGreaterThan(0);
  });

  it("returns well-formed passes above the horizon, sorted by start", () => {
    const passes = findSatellitePasses(
      ISS_TLE.line1,
      ISS_TLE.line2,
      NYC,
      { now: FIXED_NOW },
    );

    for (const pass of passes) {
      expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(10);
      expect(pass.start.getTime()).toBeLessThanOrEqual(pass.max.getTime());
      expect(pass.max.getTime()).toBeLessThanOrEqual(pass.end.getTime());
      expect(pass.durationMinutes).toBeGreaterThan(0);
    }

    for (let i = 1; i < passes.length; i += 1) {
      expect(passes[i].start.getTime()).toBeGreaterThanOrEqual(
        passes[i - 1].start.getTime(),
      );
    }
  });

  it("is deterministic for identical inputs", () => {
    const first = findSatellitePasses(ISS_TLE.line1, ISS_TLE.line2, NYC, {
      now: FIXED_NOW,
    });
    const second = findSatellitePasses(ISS_TLE.line1, ISS_TLE.line2, NYC, {
      now: FIXED_NOW,
    });
    expect(second).toEqual(first);
  });

  it("respects an extreme horizon threshold", () => {
    const passes = findSatellitePasses(
      ISS_TLE.line1,
      ISS_TLE.line2,
      NYC,
      { now: FIXED_NOW, horizonDeg: 89 },
    );
    for (const pass of passes) {
      expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(89);
    }
  });
});
