import * as Astronomy from "astronomy-engine";
import * as satellite from "satellite.js";
import type { IssPass, LatLon } from "@/types";

const DEFAULT_HORIZON_DEG = 10;
const DEFAULT_WINDOW_HOURS = 48;
const DEFAULT_STEP_SECONDS = 30;
/** Fallback intrinsic brightness when the caller doesn't know the satellite. */
const DEFAULT_REFERENCE_MAGNITUDE = 3.0;
const EARTH_RADIUS_KM = 6371;

export interface PassFinderOptions {
  /** Minimum elevation (deg) for a pass to count. */
  horizonDeg?: number;
  /** How far ahead to search, in hours. */
  windowHours?: number;
  /** Propagation step, in seconds. */
  stepSeconds?: number;
  /** Injectable clock for deterministic tests. */
  now?: Date;
  /** Intrinsic magnitude at 1000 km range, phase angle 0 (smaller = brighter). */
  referenceMagnitude?: number;
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
  /** Satellite position in Earth-fixed km (z north), for range + lighting. */
  ecf: [number, number, number];
  /** Slant range to the observer, km. */
  rangeKm: number;
}

/** Observer position in the same Earth-fixed frame satellite.js uses. */
function observerEcfKm(
  lat: number,
  lon: number,
  heightKm: number,
): [number, number, number] {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const r = EARTH_RADIUS_KM + heightKm;
  return [
    r * Math.cos(phi) * Math.cos(lambda),
    r * Math.cos(phi) * Math.sin(lambda),
    r * Math.sin(phi),
  ];
}

/** Unit vector from Earth's center toward the Sun, Earth-fixed (z north).
 * astronomy-engine's RA is sidereal hours; subtracting GMST rotates the
 * equinox-anchored frame into the rotating Earth-fixed one. */
function sunEcfDirection(date: Date): [number, number, number] {
  const eq = Astronomy.Equator(
    Astronomy.Body.Sun,
    date,
    new Astronomy.Observer(0, 0, 0),
    true,
    true,
  );
  const gstHours = Astronomy.SiderealTime(date);
  const lambdaDeg = eq.ra * 15 - gstHours * 15; // east longitude of sub-solar point
  const dec = (eq.dec * Math.PI) / 180;
  const lambda = (lambdaDeg * Math.PI) / 180;
  return [
    Math.cos(dec) * Math.cos(lambda),
    Math.cos(dec) * Math.sin(lambda),
    Math.sin(dec),
  ];
}

/**
 * Apparent magnitude of a satellite at a given range and solar phase angle,
 * using a Lambert-sphere phase model (the standard tracker approximation).
 * `referenceMagnitude` is the intrinsic brightness at 1000 km, phase 0.
 */
export function satelliteApparentMagnitude(
  rangeKm: number,
  phaseAngleDeg: number,
  referenceMagnitude: number,
): number {
  const phi = (phaseAngleDeg * Math.PI) / 180;
  // Lambertian sphere phase integral: 2/3 at phase 0, -> 0 near phase 180°.
  const phaseIntegral =
    (2 / (3 * Math.PI)) * ((Math.PI - phi) * Math.cos(phi) + Math.sin(phi));
  const phaseCorrection = -2.5 * Math.log10(Math.max(phaseIntegral, 1e-4));
  return referenceMagnitude + 5 * Math.log10(rangeKm / 1000) + phaseCorrection;
}

/**
 * Is the satellite in Earth's shadow (geometric umbra boundary, point sun)?
 * The satellite is dark once the Sun drops more than 90° past its local
 * vertical, beyond the Earth's angular radius as seen from its altitude.
 */
export function isSatelliteShadowed(
  satEcfKm: [number, number, number],
  sunEcfDir: [number, number, number],
): boolean {
  const r = Math.hypot(satEcfKm[0], satEcfKm[1], satEcfKm[2]);
  const dot =
    (satEcfKm[0] * sunEcfDir[0] +
      satEcfKm[1] * sunEcfDir[1] +
      satEcfKm[2] * sunEcfDir[2]) /
    r;
  const angularRadius = Math.asin(EARTH_RADIUS_KM / r);
  return dot < -Math.sin(angularRadius);
}

function finalizePass(
  run: ElevationSample[],
  horizonDeg: number,
  observer: LatLon,
  referenceMagnitude: number,
): IssPass {
  let maxSample = run[0];
  for (const sample of run) {
    if (sample.elevationDeg > maxSample.elevationDeg) {
      maxSample = sample;
    }
  }

  const start = new Date(run[0].t);
  const end = new Date(run[run.length - 1].t);

  // How bright the pass will be at its peak: range + solar phase angle, and
  // whether the satellite is even lit (an above-horizon pass can still be in
  // Earth's shadow — those are invisible regardless of elevation).
  const sunDir = sunEcfDirection(new Date(maxSample.t));
  const shadowed = isSatelliteShadowed(maxSample.ecf, sunDir);
  const obs = observerEcfKm(observer.lat, observer.lon, 0.1);
  const toObs = [
    obs[0] - maxSample.ecf[0],
    obs[1] - maxSample.ecf[1],
    obs[2] - maxSample.ecf[2],
  ];
  const toObsLen = Math.hypot(toObs[0], toObs[1], toObs[2]);
  const cosPhase = Math.max(
    -1,
    Math.min(
      1,
      (toObs[0] * sunDir[0] +
        toObs[1] * sunDir[1] +
        toObs[2] * sunDir[2]) /
        toObsLen,
    ),
  );
  const phaseDeg = (Math.acos(cosPhase) * 180) / Math.PI;
  const magnitude = shadowed
    ? undefined
    : round1(
        satelliteApparentMagnitude(maxSample.rangeKm, phaseDeg, referenceMagnitude),
      );

  return {
    start,
    max: new Date(maxSample.t),
    end,
    maxElevationDeg: Math.max(horizonDeg, round1(maxSample.elevationDeg)),
    maxAzimuthDeg: round1(((maxSample.azimuthDeg % 360) + 360) % 360),
    // Azimuth where the pass first clears the horizon — the "look there"
    // direction the observer needs before the satellite is even visible.
    riseAzimuthDeg: round1(((run[0].azimuthDeg % 360) + 360) % 360),
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
    magnitude,
    shadowed,
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
  const referenceMagnitude = options.referenceMagnitude ?? DEFAULT_REFERENCE_MAGNITUDE;

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
      ecf: [positionEcf.x, positionEcf.y, positionEcf.z],
      rangeKm: look.rangeSat,
    });
  }

  // Group contiguous samples above the horizon into individual passes.
  const passes: IssPass[] = [];
  let run: ElevationSample[] = [];

  const flush = () => {
    if (run.length === 0) {
      return;
    }
    passes.push(finalizePass(run, horizonDeg, observer, referenceMagnitude));
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
