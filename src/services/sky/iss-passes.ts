import * as satellite from "satellite.js";
import type { IssPass, LatLon } from "@/types";

const DEFAULT_HORIZON_DEG = 10;
const DEFAULT_WINDOW_HOURS = 48;
const DEFAULT_STEP_SECONDS = 30;

export interface PassFinderOptions {
  /** Minimum elevation (deg) for a pass to count. */
  horizonDeg?: number;
  /** How far ahead to search, in hours. */
  windowHours?: number;
  /** Propagation step, in seconds. */
  stepSeconds?: number;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

function toRadians(deg: number) {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number) {
  return (rad * 180) / Math.PI;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

interface ElevationSample {
  t: number;
  elevationDeg: number;
  azimuthDeg: number;
}

function finalizePass(run: ElevationSample[], horizonDeg: number): IssPass {
  let maxSample = run[0];
  for (const sample of run) {
    if (sample.elevationDeg > maxSample.elevationDeg) {
      maxSample = sample;
    }
  }

  const start = new Date(run[0].t);
  const end = new Date(run[run.length - 1].t);

  return {
    start,
    max: new Date(maxSample.t),
    end,
    maxElevationDeg: Math.max(horizonDeg, round1(maxSample.elevationDeg)),
    maxAzimuthDeg: round1(((maxSample.azimuthDeg % 360) + 360) % 360),
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
  };
}

/**
 * Predict all passes of a satellite (given its TLE) above `horizonDeg` for an
 * observer over the next `windowHours`. Uses SGP4 propagation via satellite.js
 * with a fixed time step; pass boundaries are accurate to within one step.
 */
export function findSatellitePasses(
  line1: string,
  line2: string,
  observer: LatLon,
  options: PassFinderOptions = {},
): IssPass[] {
  const horizonDeg = options.horizonDeg ?? DEFAULT_HORIZON_DEG;
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const stepSeconds = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
  const now = options.now ?? new Date();

  if (windowHours <= 0 || stepSeconds <= 0) {
    return [];
  }

  const satrec = satellite.twoline2satrec(line1, line2);

  const observerGeodetic = {
    longitude: toRadians(observer.lon),
    latitude: toRadians(observer.lat),
    height: 0.1, // km — ~100 m above sea level
  };

  const totalSteps = Math.ceil((windowHours * 3600) / stepSeconds);
  const samples: ElevationSample[] = [];

  for (let i = 0; i <= totalSteps; i += 1) {
    const date = new Date(now.getTime() + i * stepSeconds * 1000);
    const pv = satellite.propagate(satrec, date);
    if (typeof pv.position === "boolean") {
      continue;
    }

    // propagate() returns ECI (TEME); look angles need ECF.
    const positionEcf = satellite.eciToEcf(pv.position, satellite.gstime(date));
    const look = satellite.ecfToLookAngles(observerGeodetic, positionEcf);
    samples.push({
      t: date.getTime(),
      elevationDeg: toDegrees(look.elevation),
      azimuthDeg: toDegrees(look.azimuth),
    });
  }

  // Group contiguous samples above the horizon into individual passes.
  const passes: IssPass[] = [];
  let run: ElevationSample[] = [];

  const flush = () => {
    if (run.length === 0) {
      return;
    }
    passes.push(finalizePass(run, horizonDeg));
    run = [];
  };

  for (const sample of samples) {
    if (sample.elevationDeg >= horizonDeg) {
      run.push(sample);
    } else {
      flush();
    }
  }
  flush();

  return passes;
}
