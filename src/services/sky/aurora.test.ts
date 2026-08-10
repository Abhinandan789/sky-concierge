import { describe, expect, it } from "vitest";
import {
  auroraLevelForKp,
  computeTonightAurora,
  parseKpForecast,
  viewingLatitudeHint,
} from "./aurora";

describe("parseKpForecast", () => {
  it("parses the NOAA object format", () => {
    const rows = parseKpForecast([
      {
        time_tag: "2026-08-11T00:00:00",
        kp: 2.67,
        observed: "observed",
        noaa_scale: null,
      },
      {
        time_tag: "2026-08-11T03:00:00",
        kp: 5.33,
        observed: "forecast",
        noaa_scale: null,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      time: "2026-08-11T03:00:00",
      predictedKp: 5.33,
    });
  });

  it("parses the legacy array format and skips invalid rows", () => {
    const rows = parseKpForecast([
      ["time_tag", "predicted_kp", "range"],
      ["2026-08-11 00:00:00", "4.33", "4-5"],
      ["2026-08-11 03:00:00", "not-a-number", "4-5"],
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].predictedKp).toBe(4.33);
  });

  it("returns an empty array for non-array input", () => {
    expect(parseKpForecast(null)).toEqual([]);
    expect(parseKpForecast({})).toEqual([]);
  });
});

describe("auroraLevelForKp", () => {
  it("maps Kp values to levels", () => {
    expect(auroraLevelForKp(3.9)).toBe("LOW");
    expect(auroraLevelForKp(4)).toBe("MODERATE");
    expect(auroraLevelForKp(5)).toBe("HIGH");
    expect(auroraLevelForKp(7)).toBe("STORM");
  });
});

describe("computeTonightAurora", () => {
  const now = new Date("2026-08-11T18:00:00Z");

  it("returns the maximum Kp within the next 12 hours", () => {
    const info = computeTonightAurora(
      [
        { time: "2026-08-11T06:00:00", predictedKp: 4.0 }, // before now
        { time: "2026-08-11T21:00:00", predictedKp: 5.3 },
        { time: "2026-08-12T03:00:00", predictedKp: 4.7 },
        { time: "2026-08-12T12:00:00", predictedKp: 6.0 }, // outside window
      ],
      now,
    );

    expect(info?.maxKpTonight).toBe(5.3);
    expect(info?.level).toBe("HIGH");
  });

  it("returns null when nothing is forecast within the window", () => {
    const info = computeTonightAurora(
      [{ time: "2026-08-11T03:00:00", predictedKp: 3.0 }],
      now,
    );
    expect(info).toBeNull();
  });

  it("returns a LOW level for a genuinely quiet night", () => {
    const info = computeTonightAurora(
      [{ time: "2026-08-11T21:00:00", predictedKp: 0 }],
      now,
    );
    expect(info?.level).toBe("LOW");
    expect(info?.maxKpTonight).toBe(0);
  });

  it("provides a southern latitude hint for strong storms", () => {
    expect(viewingLatitudeHint(8)).toContain("45°");
  });
});
