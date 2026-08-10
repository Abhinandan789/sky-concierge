import * as SunCalc from "suncalc";
import type { LatLon, MoonInfo, ViewingWindow } from "@/types";

const PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
] as const;

/** Map a SunCalc phase (0 = new, 0.5 = full, 1 = new again) to a name. */
export function phaseName(phase: number): string {
  const index = Math.round(phase * 8) % 8;
  return PHASE_NAMES[index];
}

const DARK_SAMPLE_MINUTES = 30;
const MIN_DARK_WINDOW_MINUTES = 30;

interface DarkWindow {
  start: Date;
  end: Date;
}

/**
 * Sample the moon's altitude every 30 minutes across the night and group
 * contiguous below-horizon periods into dark windows. Accurate to one step
 * and immune to the rise/set edge cases that plague calendar math.
 */
function findDarkWindows(
  location: LatLon,
  nightStart: Date,
  nightEnd: Date,
): DarkWindow[] {
  const windows: DarkWindow[] = [];
  let current: Date | null = null;

  for (
    let t = nightStart.getTime();
    t < nightEnd.getTime();
    t += DARK_SAMPLE_MINUTES * 60_000
  ) {
    const date = new Date(t);
    const altitude = SunCalc.getMoonPosition(
      date,
      location.lat,
      location.lon,
    ).altitude;
    const belowHorizon = altitude < 0;

    if (belowHorizon && current === null) {
      current = date;
    } else if (!belowHorizon && current !== null) {
      windows.push({ start: current, end: date });
      current = null;
    }
  }

  if (current !== null) {
    windows.push({ start: current, end: nightEnd });
  }

  return windows;
}

/**
 * Find the astronomical-darkness window for "tonight" — the night we are
 * currently inside, or the one approaching next.
 *
 * SunCalc's `getTimes(now)` can't be trusted for this: it anchors the
 * calendar day to the *server's* timezone, and mid-night it pairs the
 * upcoming `night` with the already-passed `nightEnd`, producing a backwards
 * window. Instead we anchor on the observer's **solar noon** — a property of
 * the coordinates, so it is timezone-agnostic:
 *   1. take the server-local day containing `now`;
 *   2. if `now` precedes that day's solar noon, step back one day
 *      (via calendar arithmetic, so DST-transition days stay correct);
 *   3. tonight = [thatDay.night, nextDay.nightEnd].
 */
function getTonightBounds(
  location: LatLon,
  now: Date,
): { start: Date; end: Date } | null {
  const startOfLocalDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

  let day = startOfLocalDay(now);
  let dayTimes = SunCalc.getTimes(day, location.lat, location.lon);
  const solarNoon = dayTimes.solarNoon;
  if (!solarNoon) return null;

  if (now.getTime() < solarNoon.getTime()) {
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
    dayTimes = SunCalc.getTimes(day, location.lat, location.lon);
  }

  const nextDay = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + 1,
  );
  const nextDayTimes = SunCalc.getTimes(nextDay, location.lat, location.lon);

  const start = dayTimes.night;
  const end = nextDayTimes.nightEnd;

  // Polar day/night can leave these undefined; degrade gracefully.
  if (!start || !end) return null;
  return { start, end };
}

export function computeMoonInfo(location: LatLon, now: Date): MoonInfo {
  const bounds = getTonightBounds(location, now);
  const moonTimes = SunCalc.getMoonTimes(now, location.lat, location.lon);
  const illumination = SunCalc.getMoonIllumination(now);

  const moonrise = moonTimes.rise ?? null;
  const moonset = moonTimes.set ?? null;

  if (!bounds) {
    return {
      illumination: Math.round(illumination.fraction * 100) / 100,
      phaseName: phaseName(illumination.phase),
      moonrise,
      moonset,
      bestViewingWindow: null,
      moonDownAllNight: false,
      darkHours: 0,
    };
  }

  const { start: nightStart, end: nightEnd } = bounds;

  // All below-horizon time counts toward darkHours; the minimum-duration
  // filter applies only when picking a *recommended* window, so a night with
  // brief moon-free bursts is still reported as dark.
  const darkWindows = findDarkWindows(location, nightStart, nightEnd);
  const darkMinutes = darkWindows.reduce(
    (sum, window) =>
      sum + (window.end.getTime() - window.start.getTime()) / 60_000,
    0,
  );

  let bestViewingWindow: ViewingWindow | null = null;
  for (const window of darkWindows) {
    const duration = window.end.getTime() - window.start.getTime();
    if (
      duration < MIN_DARK_WINDOW_MINUTES * 60_000 ||
      (bestViewingWindow !== null &&
        duration <=
          bestViewingWindow.end.getTime() -
            bestViewingWindow.start.getTime())
    ) {
      continue;
    }
    bestViewingWindow = window;
  }

  const nightMinutes = (nightEnd.getTime() - nightStart.getTime()) / 60_000;

  return {
    illumination: Math.round(illumination.fraction * 100) / 100,
    phaseName: phaseName(illumination.phase),
    moonrise,
    moonset,
    bestViewingWindow,
    moonDownAllNight: nightMinutes > 0 && darkMinutes >= nightMinutes * 0.9,
    darkHours: Math.round((darkMinutes / 60) * 10) / 10,
  };
}
