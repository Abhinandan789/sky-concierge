import { describe, expect, it } from "vitest";
import {
  KNOWN_SATELLITES,
  parseSatelliteIds,
  satelliteLabel,
} from "./satellites";

describe("parseSatelliteIds", () => {
  it("accepts comma-separated NORAD ids", () => {
    expect(parseSatelliteIds("25544,48274")).toEqual({
      valid: true,
      ids: ["25544", "48274"],
    });
  });

  it("treats missing or empty input as the default set", () => {
    expect(parseSatelliteIds(undefined)).toEqual({ valid: true, ids: [] });
    expect(parseSatelliteIds("")).toEqual({ valid: true, ids: [] });
    expect(parseSatelliteIds("  , ")).toEqual({ valid: true, ids: [] });
  });

  it("dedupes ids", () => {
    expect(parseSatelliteIds("25544,25544,48274")).toEqual({
      valid: true,
      ids: ["25544", "48274"],
    });
  });

  it("rejects non-numeric ids", () => {
    expect(parseSatelliteIds("25544,abc").valid).toBe(false);
    expect(parseSatelliteIds("25544,-1").valid).toBe(false);
  });

  it("rejects more than the tracked-satellite cap", () => {
    expect(parseSatelliteIds("1,2,3,4,5").valid).toBe(false);
  });

  it("labels known and unknown satellites", () => {
    expect(satelliteLabel("25544")).toBe("ISS");
    expect(satelliteLabel("99999")).toBe("NORAD 99999");
  });
});

describe("KNOWN_SATELLITES", () => {
  it("has unique, well-formed entries", () => {
    const ids = new Set(KNOWN_SATELLITES.map((satellite) => satellite.noradId));
    expect(ids.size).toBe(KNOWN_SATELLITES.length);
    for (const satellite of KNOWN_SATELLITES) {
      expect(satellite.noradId).toMatch(/^\d{1,8}$/);
      expect(satellite.name.length).toBeGreaterThan(0);
    }
  });
});
