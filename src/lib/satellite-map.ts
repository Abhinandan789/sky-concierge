import * as satellite from "satellite.js";
import * as SunCalc from "suncalc";
import type { LatLon } from "@/types";

/**
 * Pure math for the live satellite radar. All functions are deterministic and
 * unit-testable; the canvas component just draws the results.
 */

export interface GroundTrackPoint {
  /** Epoch ms. */
  time: number;
  /** Degrees. */
  lat: number;
  /** Degrees. */
  lon: number;
  /** Height above the ellipsoid, km. */
  altitudeKm: number;
}

export interface GroundTrackOptions {
  pastMinutes?: number;
  futureMinutes?: number;
  stepSeconds?: number;
  now?: Date;
}

/** Kilometers per degree of latitude (WGS84 mean). */
export const KM_PER_DEG_LAT = 111.32;

/** Radar display radius in km — tracks beyond this clamp to the edge. */
export const RADAR_RADIUS_KM = 3000;

/** Minimum elevation (deg) for a pass to count as visible from an observer. */
export const WATCHABLE_HORIZON_DEG = 10;
/** Sun altitude (deg) below which the observer's sky counts as dark. */
export const WATCHABLE_SUN_DARK_DEG = 0;

/**
 * Is a satellite watchable from `observer` at `date`? Two conditions: it
 * clears the observer's horizon (elevation ≥ WATCHABLE_HORIZON_DEG) AND the
 * observer's sky is dark enough to see it (sun below the horizon — suncalc
 * 2.x returns altitude in degrees).
 */
export function isWatchableAt(
  line1: string,
  line2: string,
  observer: LatLon,
  date: Date,
): boolean {
  const look = observerLookAngles(line1, line2, observer, date);
  if (!look || look.elevationDeg < WATCHABLE_HORIZON_DEG) {
    return false;
  }
  const sun = SunCalc.getPosition(date, observer.lat, observer.lon);
  return sun.altitude < WATCHABLE_SUN_DARK_DEG;
}

/** Per-vertex watchability flags for a ground track (index-aligned). */
export function watchableTrack(
  line1: string,
  line2: string,
  observer: LatLon,
  track: GroundTrackPoint[],
): boolean[] {
  return track.map((point) =>
    isWatchableAt(line1, line2, observer, new Date(point.time)),
  );
}

/** Ground-track window drawn on the radar. */
export const TRACK_PAST_MINUTES = 30;
export const TRACK_FUTURE_MINUTES = 90;

/**
 * Propagate a TLE into a series of ground-track points (sub-satellite
 * lat/lon + altitude) around the given time.
 */
export function computeGroundTrack(
  line1: string,
  line2: string,
  options: GroundTrackOptions = {},
): GroundTrackPoint[] {
  const pastMinutes = options.pastMinutes ?? TRACK_PAST_MINUTES;
  const futureMinutes = options.futureMinutes ?? TRACK_FUTURE_MINUTES;
  const stepSeconds = options.stepSeconds ?? 30;
  const now = options.now ?? new Date();

  const satrec = satellite.twoline2satrec(line1, line2);
  const points: GroundTrackPoint[] = [];
  const start = now.getTime() - pastMinutes * 60_000;
  const end = now.getTime() + futureMinutes * 60_000;

  for (let t = start; t <= end; t += stepSeconds * 1000) {
    const date = new Date(t);
    const pv = satellite.propagate(satrec, date);
    if (typeof pv.position === "boolean") {
      continue; // propagation failed (rare) — skip this sample
    }
    const gmst = satellite.gstime(date);
    const geodetic = satellite.eciToGeodetic(pv.position, gmst);
    points.push({
      time: t,
      lat: satellite.degreesLat(geodetic.latitude),
      lon: satellite.degreesLong(geodetic.longitude),
      altitudeKm: geodetic.height,
    });
  }
  return points;
}

/** Current sub-satellite point for a TLE at a given time. */
export function currentGroundPoint(
  line1: string,
  line2: string,
  now: Date = new Date(),
): GroundTrackPoint | null {
  const satrec = satellite.twoline2satrec(line1, line2);
  const pv = satellite.propagate(satrec, now);
  if (typeof pv.position === "boolean") {
    return null;
  }
  const gmst = satellite.gstime(now);
  const geodetic = satellite.eciToGeodetic(pv.position, gmst);
  return {
    time: now.getTime(),
    lat: satellite.degreesLat(geodetic.latitude),
    lon: satellite.degreesLong(geodetic.longitude),
    altitudeKm: geodetic.height,
  };
}

export interface SatelliteTelemetry {
  lat: number;
  lon: number;
  /** Height above the ellipsoid, km. */
  altitudeKm: number;
  /** Orbital speed, km/s. */
  speedKmS: number;
}

/**
 * Live position + speed for a TLE — used by the globe's hover tooltip and
 * the radar's readout. LEO satellites travel ~7.7 km/s.
 */
export function currentSatelliteTelemetry(
  line1: string,
  line2: string,
  now: Date = new Date(),
): SatelliteTelemetry | null {
  const satrec = satellite.twoline2satrec(line1, line2);
  const pv = satellite.propagate(satrec, now);
  if (typeof pv.position === "boolean" || typeof pv.velocity === "boolean") {
    return null;
  }
  const gmst = satellite.gstime(now);
  const geodetic = satellite.eciToGeodetic(pv.position, gmst);
  return {
    lat: satellite.degreesLat(geodetic.latitude),
    lon: satellite.degreesLong(geodetic.longitude),
    altitudeKm: geodetic.height,
    speedKmS: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z),
  };
}

export interface ObserverLookAngles {
  /** Degrees above the observer's horizon (negative = below). */
  elevationDeg: number;
  /** Degrees clockwise from north, 0–360. */
  azimuthDeg: number;
  /** Straight-line distance, km. */
  rangeKm: number;
}

/**
 * Elevation, azimuth and range of a satellite as seen from an observer — the
 * numbers the globe's detail panel and compass show. Elevation > 0 means the
 * satellite is above the observer's horizon.
 */
export function observerLookAngles(
  line1: string,
  line2: string,
  observer: LatLon,
  now: Date = new Date(),
): ObserverLookAngles | null {
  const satrec = satellite.twoline2satrec(line1, line2);
  const pv = satellite.propagate(satrec, now);
  if (typeof pv.position === "boolean") {
    return null;
  }
  const positionEcf = satellite.eciToEcf(pv.position, satellite.gstime(now));
  const look = satellite.ecfToLookAngles(
    {
      longitude: (observer.lon * Math.PI) / 180,
      latitude: (observer.lat * Math.PI) / 180,
      height: 0.1, // km
    },
    positionEcf,
  );
  return {
    elevationDeg: (look.elevation * 180) / Math.PI,
    azimuthDeg: ((look.azimuth * 180) / Math.PI + 360) % 360,
    rangeKm: look.rangeSat,
  };
}

/**
 * Project a lat/lon to a flat local map centered on the observer: north/east
 * offsets in km (equirectangular approximation — accurate enough for a few
 * thousand km radius).
 */
export function toLocalKm(
  lat: number,
  lon: number,
  observer: LatLon,
): { northKm: number; eastKm: number } {
  const dLat = lat - observer.lat;
  const dLon = lon - observer.lon;
  return {
    northKm: dLat * KM_PER_DEG_LAT,
    eastKm: dLon * KM_PER_DEG_LAT * Math.cos((observer.lat * Math.PI) / 180),
  };
}

/** Clamp an east/north offset so it stays inside the radar disc. */
export function clampToRadius(
  eastKm: number,
  northKm: number,
  radiusKm: number = RADAR_RADIUS_KM,
): { eastKm: number; northKm: number } {
  const distance = Math.hypot(eastKm, northKm);
  if (distance <= radiusKm || distance === 0) {
    return { eastKm, northKm };
  }
  const scale = radiusKm / distance;
  return { eastKm: eastKm * scale, northKm: northKm * scale };
}

/**
 * Distance from the observer to the horizon for a satellite at the given
 * altitude: a satellite at ~400 km is visible within a ~2,200 km circle.
 */
export function horizonRadiusKm(altitudeKm: number): number {
  const earthRadius = 6371;
  if (altitudeKm <= 0) {
    return 0;
  }
  const angle = Math.acos(earthRadius / (earthRadius + altitudeKm));
  return angle * earthRadius;
}

/** Split a track into the part already passed and the part still ahead. */
export function splitTrackAt(
  track: GroundTrackPoint[],
  nowMs: number,
): { past: GroundTrackPoint[]; future: GroundTrackPoint[] } {
  const past: GroundTrackPoint[] = [];
  const future: GroundTrackPoint[] = [];
  for (const point of track) {
    if (point.time <= nowMs) {
      past.push(point);
    } else {
      future.push(point);
    }
  }
  return { past, future };
}
