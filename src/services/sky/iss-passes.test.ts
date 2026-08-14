import { describe, expect, it } from "vitest";
import {
  findSatellitePasses,
  isSatelliteShadowed,
  satelliteApparentMagnitude,
} from "./iss-passes";

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

describe("satelliteApparentMagnitude", () => {
  it("matches the reference magnitude at 1000 km and phase 0", () => {
    // Phase 0 adds +0.44 (the Lambert integral at opposition is 2/3).
    expect(satelliteApparentMagnitude(1000, 0, -1.8)).toBeCloseTo(-1.36, 1);
  });

  it("is brighter when closer", () => {
    expect(satelliteApparentMagnitude(400, 0, -1.8)).toBeLessThan(
      satelliteApparentMagnitude(1000, 0, -1.8),
    );
  });

  it("is dimmer at larger phase angles (side-lit)", () => {
    expect(satelliteApparentMagnitude(1000, 90, -1.8)).toBeGreaterThan(
      satelliteApparentMagnitude(1000, 0, -1.8),
    );
  });

  it("keeps the ISS in the bright range on a typical good pass", () => {
    // ~420 km range, ~70° phase — a classic overhead pass.
    expect(satelliteApparentMagnitude(420, 70, -1.8)).toBeLessThan(-2);
  });
});

describe("isSatelliteShadowed", () => {
  const SUN = [1, 0, 0] as [number, number, number];
  const ORBIT_R = 6870; // ~400 km altitude

  it("is lit on the sun-facing side", () => {
    expect(isSatelliteShadowed([ORBIT_R, 0, 0], SUN)).toBe(false);
  });

  it("is dark on the far side of Earth", () => {
    expect(isSatelliteShadowed([-ORBIT_R, 0, 0], SUN)).toBe(true);
  });

  it("is lit just past the terminator (before the umbra edge)", () => {
    // dot ≈ −0.8 → still outside the umbra boundary (−0.927).
    const y = Math.sqrt(1 - 0.8 * 0.8) * ORBIT_R;
    expect(isSatelliteShadowed([-0.8 * ORBIT_R, y, 0], SUN)).toBe(false);
  });

  it("is dark once the Earth fully blocks the sun", () => {
    // dot ≈ −0.95 → past the umbra boundary (−0.927).
    const y = Math.sqrt(1 - 0.95 * 0.95) * ORBIT_R;
    expect(isSatelliteShadowed([-0.95 * ORBIT_R, y, 0], SUN)).toBe(true);
  });
});
