import { describe, expect, it } from "vitest";
import { computeMoonTrack } from "./moon-track";

const FIXED_NOW = new Date("2026-08-11T00:00:00Z");

describe("computeMoonTrack", () => {
  it("is deterministic for identical inputs", () => {
    expect(computeMoonTrack(FIXED_NOW)).toEqual(computeMoonTrack(FIXED_NOW));
  });

  it("returns sane coordinates for the current sub-point", () => {
    const track = computeMoonTrack(FIXED_NOW);
    expect(track.now.lat).toBeGreaterThanOrEqual(-90);
    expect(track.now.lat).toBeLessThanOrEqual(90);
    expect(track.now.lon).toBeGreaterThanOrEqual(-180);
    expect(track.now.lon).toBeLessThan(180);
    expect(track.now.time).toBe(FIXED_NOW.getTime());
  });

  it("samples the ground track across past 60 / future 180 minutes", () => {
    const track = computeMoonTrack(FIXED_NOW);
    expect(track.track.length).toBe(25); // 240 minutes at 10-minute steps + 1
    for (let i = 1; i < track.track.length; i += 1) {
      expect(track.track[i].time).toBeGreaterThan(track.track[i - 1].time);
    }
    // The current moment is inside the sampled window.
    const times = track.track.map((point) => point.time);
    expect(times[0]).toBeLessThanOrEqual(FIXED_NOW.getTime());
    expect(times[times.length - 1]).toBeGreaterThan(FIXED_NOW.getTime());
  });

  it("drifts westward with Earth's rotation (~15°/hour)", () => {
    const track = computeMoonTrack(FIXED_NOW);
    const hourLater = track.track.find(
      (point) => point.time === FIXED_NOW.getTime() + 60 * 60_000,
    );
    expect(hourLater).toBeDefined();
    const dLon = ((hourLater!.lon - track.now.lon + 540) % 360) - 180; // signed diff
    // Earth rotation: −15°/h. The Moon's own orbital motion adds ~+0.5°/h.
    expect(dLon).toBeLessThan(-13);
    expect(dLon).toBeGreaterThan(-16);
  });

  it("keeps latitude roughly stable over an hour", () => {
    const track = computeMoonTrack(FIXED_NOW);
    const hourLater = track.track.find(
      (point) => point.time === FIXED_NOW.getTime() + 60 * 60_000,
    );
    expect(hourLater).toBeDefined();
    expect(Math.abs(hourLater!.lat - track.now.lat)).toBeLessThan(1);
  });
});
