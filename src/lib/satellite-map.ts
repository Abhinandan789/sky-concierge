import * as satellite from "satellite.js";
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
