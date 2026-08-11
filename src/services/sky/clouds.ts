import type { CloudHour, CloudLevel, CloudSummary } from "@/types";

/**
 * Cloud-cover forecast from Open-Meteo (free, no API key). The hourly series
 * is fetched for the next two days; summarizeCloudCover() narrows it to
 * tonight's dark window for the brief's "sky conditions" card and timeline.
 */

export interface CloudForecastHour {
  /** ISO hour boundary, e.g. "2026-08-11T23:00". */
  time: string;
  /** Cloud cover, 0-100%, or null when the model didn't produce a value. */
  cloudCover: number | null;
}

/** Fetch the next 48 hours of cloud cover for a location. */
export async function fetchCloudForecast(
  lat: number,
  lon: number,
  fetcher: typeof fetch = fetch,
): Promise<CloudForecastHour[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=cloud_cover&timezone=UTC&forecast_days=2`;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo responded with ${response.status}`);
  }
  const body = (await response.json()) as {
    hourly?: { time?: string[]; cloud_cover?: (number | null)[] };
  };
  const times = body.hourly?.time ?? [];
  const covers = body.hourly?.cloud_cover ?? [];
  if (times.length === 0 || times.length !== covers.length) {
    throw new Error("Malformed Open-Meteo response");
  }
  return times.map((time, index) => ({
    time,
    cloudCover: covers[index] ?? null,
  }));
}

/** Average cloud cover, 0-100, or null when there are no usable hours. */
export function averageCloudCover(hours: CloudHour[]): number | null {
  if (hours.length === 0) {
    return null;
  }
  const total = hours.reduce((sum, hour) => sum + hour.cloudCover, 0);
  return Math.round(total / hours.length);
}

/** Classify an average into a coarse level for the UI badge. */
export function cloudLevel(average: number | null): CloudLevel {
  if (average === null) {
    return "UNKNOWN";
  }
  if (average < 20) {
    return "CLEAR";
  }
  if (average < 60) {
    return "PARTLY_CLOUDY";
  }
  return "CLOUDY";
}

/**
 * Narrow an hourly forecast to tonight's dark window and summarize it.
 * Hours with no model output are skipped; an empty window degrades to
 * UNKNOWN so the brief still renders.
 */
/** Parse an Open-Meteo hour string ("YYYY-MM-DDTHH:MM", UTC) as a Date. */
export function parseCloudHour(time: string): Date {
  // The fetcher requests timezone=UTC, so a bare hour string is UTC.
  if (/[zZ]$/.test(time) || /[+-]\d\d:\d\d$/.test(time)) {
    return new Date(time);
  }
  return new Date(`${time}Z`);
}

export function summarizeCloudCover(
  forecast: CloudForecastHour[],
  nightStart: Date,
  nightEnd: Date,
): CloudSummary {
  const hours: CloudHour[] = [];
  for (const hour of forecast) {
    const time = parseCloudHour(hour.time);
    if (hour.cloudCover === null) {
      continue;
    }
    if (
      time.getTime() >= nightStart.getTime() &&
      time.getTime() < nightEnd.getTime()
    ) {
      hours.push({ time, cloudCover: hour.cloudCover });
    }
  }
  const average = averageCloudCover(hours);
  return { level: cloudLevel(average), average, hours };
}
