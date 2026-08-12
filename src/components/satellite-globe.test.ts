import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { latLonAltToVector3, sampleTrackArc } from "./satellite-globe";

/**
 * The direction-of-travel comet places its head + trail embers by walking
 * the ground-track polyline and sampling it at target arc distances. These
 * tests pin that sampler to the polyline the track line is drawn from.
 */
describe("sampleTrackArc", () => {
  // A straight polyline along +x at unit-ish radius, 4 vertices, 0.02 apart.
  const makeLine = () => {
    const pts = new Float32Array(4 * 3);
    for (let i = 0; i < 4; i += 1) {
      pts[i * 3] = 1 + i * 0.02;
      pts[i * 3 + 1] = 0;
      pts[i * 3 + 2] = 0;
    }
    return pts;
  };
  const scratchPrev = new THREE.Vector3();
  const scratchCur = new THREE.Vector3();

  it("places a target at the right arc distance along the line", () => {
    const targets = [0.05]; // 2.5 segments in — exactly vertex 2.5
    const out = [new THREE.Vector3()];
    sampleTrackArc(makeLine(), 0, 4, targets, out, scratchPrev, scratchCur);
    expect(out[0].x).toBeCloseTo(1.05, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    expect(out[0].z).toBeCloseTo(0, 6);
  });

  it("places a head + tail pair so the head is strictly ahead", () => {
    const targets = [0.01, 0.05]; // tail, head (ascending)
    const out = [new THREE.Vector3(), new THREE.Vector3()];
    sampleTrackArc(makeLine(), 0, 4, targets, out, scratchPrev, scratchCur);
    expect(out[1].x).toBeGreaterThan(out[0].x);
    expect(out[0].x).toBeCloseTo(1.01, 6);
    expect(out[1].x).toBeCloseTo(1.05, 6);
  });

  it("pins targets beyond the polyline end to the last vertex", () => {
    const targets = [0.03, 0.5];
    const out = [new THREE.Vector3(), new THREE.Vector3()];
    const total = sampleTrackArc(
      makeLine(),
      0,
      4,
      targets,
      out,
      scratchPrev,
      scratchCur,
    );
    expect(out[0].x).toBeCloseTo(1.03, 6);
    expect(out[1].x).toBeCloseTo(1.06, 6); // last vertex
    expect(total).toBeCloseTo(0.06, 6);
  });

  it("samples relative to a non-zero start index (the live split)", () => {
    const pts = makeLine();
    const targets = [0.01, 0.03];
    const out = [new THREE.Vector3(), new THREE.Vector3()];
    sampleTrackArc(pts, 1, 4, targets, out, scratchPrev, scratchCur);
    expect(out[0].x).toBeCloseTo(1.03, 6); // 1.02 + 0.01
    expect(out[1].x).toBeCloseTo(1.05, 6); // 1.02 + 0.03
  });
});

/**
 * The globe's earth-night texture is a standard equirectangular map: −180° at
 * the image's left edge, 0° at the center. three.js maps the texture's left
 * edge (u=0) onto the sphere's −x axis, so 0° longitude must sit on +x.
 * Regression test for the bug where every marker was placed 180° off.
 */
describe("latLonAltToVector3", () => {
  it("places Greenwich (0°, 0°) on the +x axis", () => {
    const v = latLonAltToVector3(0, 0, 0);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("places 90°E on the −z axis (the texture's 0.75u column)", () => {
    const v = latLonAltToVector3(0, 90, 0);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-1, 6);
  });

  it("places 90°W on the +z axis (the texture's 0.25u column)", () => {
    const v = latLonAltToVector3(0, -90, 0);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(1, 6);
  });

  it("places the date line (180°) on the −x axis (the texture seam)", () => {
    const v = latLonAltToVector3(0, 180, 0);
    expect(v.x).toBeCloseTo(-1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("places the north pole on +y", () => {
    const v = latLonAltToVector3(90, 0, 0);
    expect(v.y).toBeCloseTo(1, 6);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0, 6);
  });

  it("lifts the point above the surface by the altitude", () => {
    const v = latLonAltToVector3(0, 0, 6371); // one earth radius up
    expect(v.length()).toBeCloseTo(2, 6);
    expect(v.x).toBeGreaterThan(1);
  });
});
