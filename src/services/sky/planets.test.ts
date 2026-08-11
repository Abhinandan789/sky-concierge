import { describe, expect, it } from "vitest";
import { getTonightBounds } from "./moon";
import { computeMoonConjunctions, computePlanetEvents } from "./planets";

// New York, mid-August 2026 — a normal (non-polar) night window.
const LOCATION = { lat: 40.7128, lon: -74.006 };
const NOW = new Date("2026-08-11T20:00:00Z");

function tonight() {
  const bounds = getTonightBounds(LOCATION, NOW);
  if (!bounds) {
    throw new Error("Test fixture needs a defined night window");
  }
  return bounds;
}

const COMPASS_DIRECTIONS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

describe("computePlanetEvents", () => {
  it("returns the four bright planets with sensible values", () => {
    const { start, end } = tonight();
    const planets = computePlanetEvents(LOCATION, start, end);

    expect(planets.map((p) => p.name)).toEqual([
      "Venus",
      "Jupiter",
      "Saturn",
      "Mars",
    ]);

    for (const planet of planets) {
      expect(typeof planet.visible).toBe("boolean");
      expect(planet.maxAltitudeDeg).toBeGreaterThanOrEqual(0);
      expect(planet.maxAltitudeDeg).toBeLessThanOrEqual(90);
      if (planet.visible) {
        expect(planet.bestTime).not.toBeNull();
        expect(planet.bestTime!.getTime()).toBeGreaterThanOrEqual(
          start.getTime(),
        );
        expect(planet.bestTime!.getTime()).toBeLessThanOrEqual(end.getTime());
        expect(COMPASS_DIRECTIONS).toContain(planet.direction);
        expect(planet.magnitude).not.toBeNull();
        // Bright naked-eye planets — magnitude well within naked-eye range.
        expect(planet.magnitude!).toBeGreaterThan(-6);
        expect(planet.magnitude!).toBeLessThan(6);
      }
    }
  });

  it("reports sane magnitudes for the brightest planets", () => {
    const { start, end } = tonight();
    const planets = computePlanetEvents(LOCATION, start, end);
    const byName = Object.fromEntries(
      planets.map((planet) => [planet.name, planet]),
    );

    // Venus is almost always the brightest evening object (magnitude < -3).
    if (byName.Venus.visible) {
      expect(byName.Venus.magnitude!).toBeLessThan(-3);
    }
    // Jupiter is typically the second-brightest planet.
    if (byName.Jupiter.visible) {
      expect(byName.Jupiter.magnitude!).toBeLessThan(-1.5);
    }
    // Saturn is dimmer — around 0.5.
    if (byName.Saturn.visible) {
      expect(byName.Saturn.magnitude!).toBeLessThan(1.5);
      expect(byName.Saturn.magnitude!).toBeGreaterThan(-1);
    }
  });

  it("keeps rise/set times inside the sampled range when present", () => {
    const { start, end } = tonight();
    const planets = computePlanetEvents(LOCATION, start, end);

    for (const planet of planets) {
      if (planet.riseTime) {
        expect(planet.riseTime.getTime()).toBeGreaterThanOrEqual(
          start.getTime() - 6 * 3600_000,
        );
      }
      if (planet.setTime) {
        expect(planet.setTime.getTime()).toBeLessThanOrEqual(
          end.getTime() + 6 * 3600_000,
        );
      }
    }
  });
});

describe("computeMoonConjunctions", () => {
  it("returns well-formed events only when the moon gets within 8 degrees", () => {
    const { start, end } = tonight();
    const conjunctions = computeMoonConjunctions(LOCATION, start, end);

    for (const conjunction of conjunctions) {
      expect(["Venus", "Jupiter", "Saturn", "Mars"]).toContain(
        conjunction.planet,
      );
      expect(conjunction.separationDeg).toBeLessThan(8);
      expect(conjunction.separationDeg).toBeGreaterThan(0);
      expect(conjunction.time.getTime()).toBeGreaterThanOrEqual(
        start.getTime(),
      );
      expect(conjunction.time.getTime()).toBeLessThanOrEqual(end.getTime());
    }
  });
});
