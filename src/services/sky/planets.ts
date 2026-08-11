import * as Astronomy from "astronomy-engine";
import { formatCompass } from "@/lib/utils";
import type { ConjunctionEvent, LatLon, PlanetEvent } from "@/types";

/**
 * Bright naked-eye planets for "what can I see tonight". All math is local
 * (astronomy-engine, no network), so this section never degrades due to an
 * upstream outage.
 */

const PLANETS = [
  { name: "Venus", body: Astronomy.Body.Venus },
  { name: "Jupiter", body: Astronomy.Body.Jupiter },
  { name: "Saturn", body: Astronomy.Body.Saturn },
  { name: "Mars", body: Astronomy.Body.Mars },
] as const;

const ALTITUDE_SAMPLE_MINUTES = 15;
const CONJUNCTION_SAMPLE_MINUTES = 30;
/** Report a moon-planet "conjunction" when they come within this many degrees. */
const CONJUNCTION_THRESHOLD_DEG = 8;
/** Look this far beyond the night window when finding rise/set transitions. */
const EXTEND_WINDOW_HOURS = 6;

interface PlanetSample {
  time: Date;
  altitudeDeg: number;
  azimuthDeg: number;
}

/** Sample a planet's altitude/azimuth at 15-minute steps. */
function samplePlanet(
  body: Astronomy.Body,
  observer: Astronomy.Observer,
  start: Date,
  end: Date,
): PlanetSample[] {
  const samples: PlanetSample[] = [];
  for (
    let t = start.getTime();
    t <= end.getTime();
    t += ALTITUDE_SAMPLE_MINUTES * 60_000
  ) {
    const date = new Date(t);
    const eq = Astronomy.Equator(body, date, observer, true, true);
    const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec);
    samples.push({
      time: date,
      // astronomy-engine returns altitude/azimuth in degrees here.
      altitudeDeg: hor.altitude,
      azimuthDeg: hor.azimuth,
    });
  }
  return samples;
}

/**
 * Rise/set for each bright planet across tonight's dark window. Times are
 * accurate to the sample step (±15 min), plenty for a "when to look" app.
 * A planet already up when dusk falls reports riseTime = null; one that
 * stays up past dawn reports setTime = null.
 */
export function computePlanetEvents(
  location: LatLon,
  nightStart: Date,
  nightEnd: Date,
): PlanetEvent[] {
  const observer = new Astronomy.Observer(location.lat, location.lon, 0);
  const extendedStart = new Date(
    nightStart.getTime() - EXTEND_WINDOW_HOURS * 3600_000,
  );
  const extendedEnd = new Date(
    nightEnd.getTime() + EXTEND_WINDOW_HOURS * 3600_000,
  );

  return PLANETS.map(({ name, body }) => {
    const samples = samplePlanet(body, observer, extendedStart, extendedEnd);

    // Closest above-horizon sample to the night window = best viewing.
    let best: PlanetSample | null = null;
    for (const sample of samples) {
      if (
        sample.altitudeDeg > 0 &&
        sample.time.getTime() >= nightStart.getTime() &&
        sample.time.getTime() <= nightEnd.getTime() &&
        (best === null || sample.altitudeDeg > best.altitudeDeg)
      ) {
        best = sample;
      }
    }

    // First up/down transitions, clipped to the night window.
    let riseTime: Date | null = null;
    let setTime: Date | null = null;
    let wasUp = false;
    for (const sample of samples) {
      const up = sample.altitudeDeg > 0;
      const inNight =
        sample.time.getTime() >= nightStart.getTime() &&
        sample.time.getTime() <= nightEnd.getTime();
      if (up && !wasUp) {
        // An up-transition inside the night = "rises tonight".
        if (
          sample.time.getTime() >= nightStart.getTime() &&
          riseTime === null
        ) {
          riseTime = sample.time;
        }
      }
      if (!up && wasUp && inNight && setTime === null) {
        setTime = sample.time;
      }
      wasUp = up;
    }

    const visible = best !== null;
    return {
      name,
      magnitude: best ? Astronomy.Illumination(body, best.time).mag : null,
      maxAltitudeDeg: best ? Math.round(best.altitudeDeg) : 0,
      riseTime,
      setTime,
      bestTime: best ? best.time : null,
      direction: best ? formatCompass(best.azimuthDeg) : "",
      visible,
    };
  });
}

/**
 * Moon-planet conjunctions tonight: the closest approach of the Moon to each
 * bright planet within the dark window, reported when it gets within 8°.
 * Computed from geocentric ECI vectors (AngleBetween returns radians).
 */
export function computeMoonConjunctions(
  location: LatLon,
  nightStart: Date,
  nightEnd: Date,
): ConjunctionEvent[] {
  const conjunctions: ConjunctionEvent[] = [];

  for (const { name, body } of PLANETS) {
    let minSeparationDeg = Infinity;
    let minTime = nightStart;
    for (
      let t = nightStart.getTime();
      t <= nightEnd.getTime();
      t += CONJUNCTION_SAMPLE_MINUTES * 60_000
    ) {
      const date = new Date(t);
      const separationRad = Astronomy.AngleBetween(
        Astronomy.GeoMoon(date),
        Astronomy.GeoVector(body, date, false),
      );
      const separationDeg = (separationRad * 180) / Math.PI;
      if (separationDeg < minSeparationDeg) {
        minSeparationDeg = separationDeg;
        minTime = date;
      }
    }
    if (minSeparationDeg < CONJUNCTION_THRESHOLD_DEG) {
      conjunctions.push({
        planet: name,
        time: minTime,
        separationDeg: Math.round(minSeparationDeg * 10) / 10,
      });
    }
  }

  return conjunctions;
}
