import { describe, expect, it } from "vitest";
import {
  cloudLevel,
  summarizeCloudCover,
  type CloudForecastHour,
} from "./clouds";

function hour(iso: string, cover: number | null): CloudForecastHour {
  return { time: iso, cloudCover: cover };
}

const NIGHT_START = new Date("2026-08-11T23:00:00Z");
const NIGHT_END = new Date("2026-08-12T05:00:00Z");

describe("summarizeCloudCover", () => {
  it("classifies a clear night", () => {
    const summary = summarizeCloudCover(
      [
        hour("2026-08-11T22:00", 5), // before the window — ignored
        hour("2026-08-11T23:00", 10),
        hour("2026-08-12T00:00", 15),
        hour("2026-08-12T01:00", 5),
        hour("2026-08-12T04:00", 10),
        hour("2026-08-12T05:00", 40), // at the end boundary — ignored
      ],
      NIGHT_START,
      NIGHT_END,
    );
    expect(summary.level).toBe("CLEAR");
    expect(summary.average).toBe(10);
    expect(summary.hours).toHaveLength(4);
    expect(summary.hours[0].time.toISOString()).toBe(
      "2026-08-11T23:00:00.000Z",
    );
  });

  it("classifies partly cloudy and cloudy nights", () => {
    expect(
      summarizeCloudCover(
        [hour("2026-08-11T23:00", 40), hour("2026-08-12T00:00", 50)],
        NIGHT_START,
        NIGHT_END,
      ).level,
    ).toBe("PARTLY_CLOUDY");

    expect(
      summarizeCloudCover(
        [hour("2026-08-11T23:00", 70), hour("2026-08-12T00:00", 90)],
        NIGHT_START,
        NIGHT_END,
      ).level,
    ).toBe("CLOUDY");
  });

  it("skips hours with no model output and ignores out-of-window hours", () => {
    const summary = summarizeCloudCover(
      [
        hour("2026-08-11T23:00", null),
        hour("2026-08-11T23:00", 20),
        hour("2026-08-13T00:00", 100),
      ],
      NIGHT_START,
      NIGHT_END,
    );
    expect(summary.hours).toHaveLength(1);
    expect(summary.average).toBe(20);
  });

  it("degrades to UNKNOWN when no usable hours fall inside the window", () => {
    const summary = summarizeCloudCover([], NIGHT_START, NIGHT_END);
    expect(summary.level).toBe("UNKNOWN");
    expect(summary.average).toBeNull();
    expect(summary.hours).toEqual([]);
  });
});

describe("cloudLevel", () => {
  it("maps averages to levels", () => {
    expect(cloudLevel(null)).toBe("UNKNOWN");
    expect(cloudLevel(0)).toBe("CLEAR");
    expect(cloudLevel(19)).toBe("CLEAR");
    expect(cloudLevel(20)).toBe("PARTLY_CLOUDY");
    expect(cloudLevel(59)).toBe("PARTLY_CLOUDY");
    expect(cloudLevel(60)).toBe("CLOUDY");
    expect(cloudLevel(100)).toBe("CLOUDY");
  });
});
