import * as Astronomy from "astronomy-engine";

/**
 * The Moon's sub-point (where it is directly overhead) and its ground track —
 * what the globe and radar overlay. All local math via astronomy-engine; the
 * Earth's rotation dominates the motion (~15°/hour westward), so an hourly
 * refresh is plenty.
 */

export interface MoonTrackPoint {
  /** Epoch ms. */
  time: number;
  /** Degrees. */
  lat: number;
  /** Degrees. */
  lon: number;
}

export interface MoonTrack {
  now: MoonTrackPoint;
  /** Past 60 min → future 180 min at 10-minute steps. */
  track: MoonTrackPoint[];
}

const PAST_MINUTES = 60;
const FUTURE_MINUTES = 180;
const STEP_MINUTES = 10;

/**
 * Geocentric Moon vector (EQJ) → Earth-fixed sub-point. Rotating to the
 * equator of date and subtracting Greenwich sidereal time gives the
 * geodetic longitude; the declination is the latitude.
 */
function moonSubPoint(date: Date): { lat: number; lon: number } {
  const vector = Astronomy.GeoMoon(date);
  const ofDate = Astronomy.RotateVector(
    Astronomy.Rotation_EQJ_EQD(date),
    vector,
  );
  const raRad = Math.atan2(ofDate.y, ofDate.x);
  const decRad = Math.asin(ofDate.z / ofDate.Length());
  const gmstHours = Astronomy.SiderealTime(date);
  let lon = (raRad * 180) / Math.PI - gmstHours * 15;
  // Normalize to [-180, 180).
  lon = (((lon % 360) + 540) % 360) - 180;
  return { lat: (decRad * 180) / Math.PI, lon };
}

export function computeMoonTrack(now: Date = new Date()): MoonTrack {
  const nowMs = now.getTime();
  const current = moonSubPoint(now);

  const track: MoonTrackPoint[] = [];
  const start = nowMs - PAST_MINUTES * 60_000;
  const end = nowMs + FUTURE_MINUTES * 60_000;
  for (let t = start; t <= end; t += STEP_MINUTES * 60_000) {
    const point = moonSubPoint(new Date(t));
    track.push({ time: t, lat: point.lat, lon: point.lon });
  }

  return { now: { time: nowMs, ...current }, track };
}
