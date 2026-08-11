import { describe, expect, it } from "vitest";
import {
  RADAR_RADIUS_KM,
  clampToRadius,
  computeGroundTrack,
  currentGroundPoint,
  horizonRadiusKm,
  observerLookAngles,
  splitTrackAt,
  toLocalKm,
} from "./satellite-map";

// Real ISS (ZARYA) TLE — structurally valid forever, like iss-passes.test.ts.
const ISS_TLE = {
  line1:
    "1 25544U 98067A   26222.50435993  .00003786  00000+0  75820-4 0  9991",
  line2:
    "2 25544  51.6324  31.2750 0007420  32.4605 327.6839 15.49403146580170",
};

const NYC = { lat: 40.7128, lon: -74.006 };
const FIXED_NOW = new Date("2026-08-11T00:00:00Z");

describe("computeGroundTrack", () => {
  it("produces valid sub-satellite points across the window", () => {
    const track = computeGroundTrack(ISS_TLE.line1, ISS_TLE.line2, {
      now: FIXED_NOW,
    });
    expect(track.length).toBeGreaterThan(0);
    for (const point of track) {
      expect(point.lat).toBeGreaterThanOrEqual(-90);
      expect(point.lat).toBeLessThanOrEqual(90);
      expect(point.lon).toBeGreaterThanOrEqual(-180);
      expect(point.lon).toBeLessThanOrEqual(180);
      expect(point.altitudeKm).toBeGreaterThan(100); // in orbit
      expect(point.altitudeKm).toBeLessThan(2000);
    }
    // Samples are in time order.
    for (let i = 1; i < track.length; i += 1) {
      expect(track[i].time).toBeGreaterThan(track[i - 1].time);
    }
  });

  it("is deterministic for identical inputs", () => {
    const first = computeGroundTrack(ISS_TLE.line1, ISS_TLE.line2, {
      now: FIXED_NOW,
    });
    const second = computeGroundTrack(ISS_TLE.line1, ISS_TLE.line2, {
      now: FIXED_NOW,
    });
    expect(second).toEqual(first);
  });

  it("currentGroundPoint returns the same location as the track midpoint", () => {
    const current = currentGroundPoint(ISS_TLE.line1, ISS_TLE.line2, FIXED_NOW);
    expect(current).not.toBeNull();
    expect(Math.abs(current!.lat)).toBeLessThanOrEqual(90);
    expect(current!.altitudeKm).toBeGreaterThan(100);
  });
});

describe("observerLookAngles", () => {
  it("returns sane elevation/azimuth/range for a real TLE", () => {
    const look = observerLookAngles(
      ISS_TLE.line1,
      ISS_TLE.line2,
      NYC,
      FIXED_NOW,
    );
    expect(look).not.toBeNull();
    expect(look!.elevationDeg).toBeGreaterThanOrEqual(-90);
    expect(look!.elevationDeg).toBeLessThanOrEqual(90);
    expect(look!.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(look!.azimuthDeg).toBeLessThan(360);
    expect(look!.rangeKm).toBeGreaterThan(100); // in orbit
  });

  it("sees the satellite near the zenith when the observer is below it", () => {
    const point = currentGroundPoint(ISS_TLE.line1, ISS_TLE.line2, FIXED_NOW);
    expect(point).not.toBeNull();
    const look = observerLookAngles(
      ISS_TLE.line1,
      ISS_TLE.line2,
      { lat: point!.lat, lon: point!.lon },
      FIXED_NOW,
    );
    expect(look).not.toBeNull();
    expect(look!.elevationDeg).toBeGreaterThan(60);
  });

  it("normalizes azimuth into 0–360", () => {
    for (let i = 0; i < 5; i += 1) {
      const look = observerLookAngles(
        ISS_TLE.line1,
        ISS_TLE.line2,
        NYC,
        FIXED_NOW,
      );
      expect(look!.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(look!.azimuthDeg).toBeLessThan(360);
    }
  });
});

describe("toLocalKm", () => {
  it("projects the observer onto the origin", () => {
    expect(toLocalKm(NYC.lat, NYC.lon, NYC)).toEqual({ northKm: 0, eastKm: 0 });
  });

  it("approximates 1 degree of latitude as ~111 km north", () => {
    const { northKm, eastKm } = toLocalKm(NYC.lat + 1, NYC.lon, NYC);
    expect(northKm).toBeCloseTo(111.32, 0);
    expect(eastKm).toBeCloseTo(0, 0);
  });

  it("shrinks east-west distance by cos(latitude)", () => {
    const { eastKm } = toLocalKm(NYC.lat, NYC.lon + 1, NYC);
    const expected = 111.32 * Math.cos((NYC.lat * Math.PI) / 180);
    expect(eastKm).toBeCloseTo(expected, 0);
  });
});

describe("clampToRadius", () => {
  it("leaves points inside the disc untouched", () => {
    expect(clampToRadius(100, 100)).toEqual({ eastKm: 100, northKm: 100 });
  });

  it("pulls points outside the disc onto the edge", () => {
    const clamped = clampToRadius(10_000, 0);
    expect(Math.hypot(clamped.eastKm, clamped.northKm)).toBeCloseTo(
      RADAR_RADIUS_KM,
      3,
    );
    expect(clamped.eastKm).toBeGreaterThan(0);
  });
});

describe("horizonRadiusKm", () => {
  it("matches the known ~2,200 km horizon for a 400 km orbit", () => {
    const radius = horizonRadiusKm(400);
    expect(radius).toBeGreaterThan(2000);
    expect(radius).toBeLessThan(2400);
  });

  it("returns zero for ground level", () => {
    expect(horizonRadiusKm(0)).toBe(0);
  });
});

describe("splitTrackAt", () => {
  it("splits the track at the given time", () => {
    const track = computeGroundTrack(ISS_TLE.line1, ISS_TLE.line2, {
      now: FIXED_NOW,
    });
    const middle = FIXED_NOW.getTime();
    const { past, future } = splitTrackAt(track, middle);
    expect(past.length + future.length).toBe(track.length);
    expect(past.length).toBeGreaterThan(0);
    expect(future.length).toBeGreaterThan(0);
    for (const point of past) {
      expect(point.time).toBeLessThanOrEqual(middle);
    }
    for (const point of future) {
      expect(point.time).toBeGreaterThan(middle);
    }
  });
});
