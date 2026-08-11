"use client";

import { Globe2, Loader2, Satellite } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatCoordinates } from "@/lib/utils";
import {
  computeGroundTrack,
  currentGroundPoint,
  currentSatelliteTelemetry,
  observerLookAngles,
  type GroundTrackPoint,
} from "@/lib/satellite-map";
import type { LatLon } from "@/types";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SatelliteGlobeHud } from "./satellite-globe-hud";

interface TleEntry {
  noradId: string;
  name: string;
  line1: string;
  line2: string;
}

interface SatelliteGlobeProps {
  location: LatLon;
  /** NORAD ids selected in the picker; empty = server-configured set. */
  selectedIds: string[];
}

/** Earth's rotation rate about its axis (sidereal day), radians/second. */
const SIDEREAL_RATE = (2 * Math.PI) / 86164.0905;
const EARTH_RADIUS_KM = 6371;
const TRACK_REFRESH_MS = 60_000;
/** Lift applied to ground tracks so they don't z-fight the surface. */
const TRACK_LIFT_KM = 10;
const COLORS = ["#22d3ee", "#fbbf24", "#e879f9", "#34d399"];
/** How often telemetry (altitude/velocity/elevation) reaches the HUD. */
const TELEMETRY_INTERVAL_MS = 500;
/** Pointer movement (px) under which a press counts as a click, not a drag. */
const CLICK_SLOP_PX = 6;

/** Live numbers for one satellite, pushed to the HUD panels. */
export interface GlobeSatelliteTelemetry {
  altitudeKm: number;
  speedKmS: number;
  elevationDeg: number;
  azimuthDeg: number;
  inView: boolean;
}

export interface GlobeTelemetry {
  /** Keyed by NORAD id. */
  sats: Record<string, GlobeSatelliteTelemetry>;
}

/** Earth-fixed lat/lon (+ altitude) → position inside the globe group. */
function latLonAltToVector3(
  lat: number,
  lon: number,
  altitudeKm: number,
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const radius = 1 + altitudeKm / EARTH_RADIUS_KM;
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Radial-gradient glow sprite (a soft billboard dot). */
function makeGlowSprite(color: string): THREE.Sprite {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rgb = new THREE.Color(color);
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(
    0.3,
    `rgba(${Math.round(rgb.r * 255)}, ${Math.round(rgb.g * 255)}, ${Math.round(rgb.b * 255)}, 0.9)`,
  );
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  return sprite;
}

/** Everything the animation loop needs for one tracked satellite. */
interface GlobeSatellite {
  tle: TleEntry;
  /** Track sample times (ms), precomputed. */
  times: number[];
  /** Past line draws [0..k), future line draws [k..n) — separate geometries
   * so each keeps its own draw range and boundary vertex. */
  pastGeometry: THREE.BufferGeometry;
  futureGeometry: THREE.BufferGeometry;
  pastLine: THREE.Line;
  futureLine: THREE.Line;
  /** Live dot: hot white core + pulsing colored halo. */
  core: THREE.Sprite;
  halo: THREE.Sprite;
}

/** Build a satellite's scene objects from its TLE. */
function buildSatellite(tle: TleEntry, index: number): GlobeSatellite {
  const color = COLORS[index % COLORS.length];
  const track = computeGroundTrack(tle.line1, tle.line2);
  const times = track.map((point) => point.time);
  const makeGeometry = () => {
    const positions = new Float32Array(track.length * 3);
    track.forEach((point: GroundTrackPoint, i: number) => {
      const v = latLonAltToVector3(point.lat, point.lon, TRACK_LIFT_KM);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  };
  const pastGeometry = makeGeometry();
  const futureGeometry = makeGeometry();
  const pastLine = new THREE.Line(
    pastGeometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 }),
  );
  const futureLine = new THREE.Line(
    futureGeometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  );

  const core = makeGlowSprite(color);
  core.scale.set(0.075, 0.075, 1);
  core.userData = { noradId: tle.noradId };
  const halo = makeGlowSprite(color);
  halo.scale.set(0.22, 0.22, 1);

  return {
    tle,
    times,
    pastGeometry,
    futureGeometry,
    pastLine,
    futureLine,
    core,
    halo,
  };
}

/** Everything the React component needs to drive the scene. */
interface GlobeView {
  scene: THREE.Scene;
  earthGroup: THREE.Group;
  updateSatellites: (tles: TleEntry[]) => void;
  updateObserver: (lat: number, lon: number) => void;
  setSelected: (id: string | null) => void;
  dispose: () => void;
}

/** Build the whole three.js scene; returns a handle for driving + disposal. */
function createGlobeView(
  container: HTMLDivElement,
  callbacks: {
    onSelect: (id: string | null) => void;
    onTelemetry: (telemetry: GlobeTelemetry) => void;
  },
): GlobeView {
  const scene = new THREE.Scene();
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
  camera.position.set(0, 1.5, 4.4);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    // Keep the drawing buffer so the canvas can be captured/screenshot-verified.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.6;
  controls.maxDistance = 9;
  controls.rotateSpeed = 0.6;

  // Starfield (fixed — the earth spins beneath it, not the sky).
  const starCount = 700;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 42 + Math.random() * 18;
    starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = radius * Math.cos(phi);
    starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(starPositions, 3),
  );
  scene.add(
    new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0x94a3b8,
        size: 0.07,
        transparent: true,
        opacity: 0.7,
        sizeAttenuation: true,
      }),
    ),
  );

  // Earth + night-lights texture, plus a faint atmospheric halo.
  const earthGroup = new THREE.Group();
  const texture = new THREE.TextureLoader().load("/earth-night.jpg");
  texture.colorSpace = THREE.SRGBColorSpace;
  earthGroup.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.MeshBasicMaterial({ map: texture }),
    ),
  );
  earthGroup.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1.02, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide,
      }),
    ),
  );
  scene.add(earthGroup);

  // Shared mutable satellite state read by the animation loop.
  const sats = new Map<string, GlobeSatellite>();
  let observer: LatLon = { lat: 0, lon: 0 };
  let selectedId: string | null = null;
  let youGlow: THREE.Sprite | null = null;

  const updateSatellites = (tles: TleEntry[]) => {
    for (const sat of sats.values()) {
      earthGroup.remove(sat.pastLine, sat.futureLine, sat.core, sat.halo);
      sat.pastGeometry.dispose();
      sat.futureGeometry.dispose();
      (sat.pastLine.material as THREE.Material).dispose();
      (sat.futureLine.material as THREE.Material).dispose();
      (sat.core.material as THREE.SpriteMaterial).map?.dispose();
      (sat.core.material as THREE.Material).dispose();
      (sat.halo.material as THREE.SpriteMaterial).map?.dispose();
      (sat.halo.material as THREE.Material).dispose();
    }
    sats.clear();

    tles.forEach((tle, index) => {
      const sat = buildSatellite(tle, index);
      earthGroup.add(sat.pastLine, sat.futureLine, sat.core, sat.halo);
      sats.set(tle.noradId, sat);
    });
  };

  const updateObserver = (lat: number, lon: number) => {
    observer = { lat, lon };
    if (youGlow) {
      earthGroup.remove(youGlow);
      (youGlow.material as THREE.SpriteMaterial).map?.dispose();
      youGlow.material.dispose();
    }
    youGlow = makeGlowSprite("#67e8f9");
    youGlow.scale.set(0.055, 0.055, 1);
    youGlow.position.copy(latLonAltToVector3(lat, lon, 0));
    earthGroup.add(youGlow);
  };

  const setSelected = (id: string | null) => {
    selectedId = id;
  };

  // Click-to-select: a press that doesn't move much is a tap on a satellite.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pressX = 0;
  let pressY = 0;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    pressX = event.clientX;
    pressY = event.clientY;
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (
      Math.hypot(event.clientX - pressX, event.clientY - pressY) > CLICK_SLOP_PX
    ) {
      return; // it was a drag, not a click
    }
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      [...sats.values()].map((sat) => sat.core),
      false,
    );
    callbacks.onSelect(
      hits.length > 0 ? (hits[0].object.userData.noradId as string) : null,
    );
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      [...sats.values()].map((sat) => sat.core),
      false,
    );
    renderer.domElement.style.cursor = hits.length > 0 ? "pointer" : "grab";
  });

  const clock = new THREE.Clock();
  let frame = 0;
  let lastTelemetryAt = 0;
  const animate = () => {
    frame = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    // The globe rotates at Earth's real sidereal rate — satellites orbit in
    // inertial space, so the planet genuinely revolves beneath them.
    earthGroup.rotation.y += SIDEREAL_RATE * delta;

    const nowMs = Date.now();
    const now = new Date(nowMs);

    for (const sat of sats.values()) {
      const point = currentGroundPoint(sat.tle.line1, sat.tle.line2, now);
      if (!point) {
        continue;
      }
      // Live dot — at the satellite's real altitude, directly above its
      // ground point.
      const blipPos = latLonAltToVector3(
        point.lat,
        point.lon,
        point.altitudeKm,
      );
      sat.core.position.copy(blipPos);
      sat.halo.position.copy(blipPos);

      // Pulse the halo so the satellite reads as a live beacon; the selected
      // satellite breathes bigger so it stands out from the rest.
      const pulse = 0.5 + 0.5 * Math.sin(nowMs / 280);
      const base = sat.tle.noradId === selectedId ? 0.3 : 0.2;
      const haloScale = base + 0.08 * pulse;
      sat.halo.scale.set(haloScale, haloScale, 1);
      (sat.halo.material as THREE.SpriteMaterial).opacity = 0.3 + 0.5 * pulse;

      // Re-anchor the ground track to the live position every frame: the
      // split index moves forward in time and the boundary vertices are
      // overwritten with the live point, so both line tips always meet the
      // dot exactly (no more drift between refreshes).
      const split = sat.times.findIndex((time) => time > nowMs);
      const k = split === -1 ? sat.times.length : split;
      const surface = latLonAltToVector3(point.lat, point.lon, TRACK_LIFT_KM);
      const pastPositions = sat.pastGeometry.attributes.position
        .array as Float32Array;
      const futurePositions = sat.futureGeometry.attributes.position
        .array as Float32Array;
      if (k < sat.times.length) {
        pastPositions[k * 3] = surface.x;
        pastPositions[k * 3 + 1] = surface.y;
        pastPositions[k * 3 + 2] = surface.z;
        futurePositions[k * 3] = surface.x;
        futurePositions[k * 3 + 1] = surface.y;
        futurePositions[k * 3 + 2] = surface.z;
      }
      if (k > 0) {
        pastPositions[(k - 1) * 3] = surface.x;
        pastPositions[(k - 1) * 3 + 1] = surface.y;
        pastPositions[(k - 1) * 3 + 2] = surface.z;
        futurePositions[(k - 1) * 3] = surface.x;
        futurePositions[(k - 1) * 3 + 1] = surface.y;
        futurePositions[(k - 1) * 3 + 2] = surface.z;
      }
      sat.pastGeometry.attributes.position.needsUpdate = true;
      sat.futureGeometry.attributes.position.needsUpdate = true;
      sat.pastGeometry.setDrawRange(0, k);
      sat.futureGeometry.setDrawRange(k, sat.times.length - k);
    }

    // Push live numbers to the HUD at a throttled rate (React state at 60fps
    // would be wasteful — the canvas already animates at full speed).
    if (nowMs - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
      lastTelemetryAt = nowMs;
      const update: GlobeTelemetry = { sats: {} };
      for (const sat of sats.values()) {
        const telemetryPoint = currentSatelliteTelemetry(
          sat.tle.line1,
          sat.tle.line2,
          now,
        );
        const look = observerLookAngles(
          sat.tle.line1,
          sat.tle.line2,
          observer,
          now,
        );
        update.sats[sat.tle.noradId] = {
          altitudeKm: telemetryPoint?.altitudeKm ?? 0,
          speedKmS: telemetryPoint?.speedKmS ?? 0,
          elevationDeg: look?.elevationDeg ?? 0,
          azimuthDeg: look?.azimuthDeg ?? 0,
          inView: (look?.elevationDeg ?? -90) > 0,
        };
      }
      callbacks.onTelemetry(update);
    }

    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  const resizeObserver = new ResizeObserver(() => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(container);

  const dispose = () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    controls.dispose();
    scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Points ||
        object instanceof THREE.Sprite
      ) {
        object.geometry?.dispose();
        const material = object.material as
          THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose());
        } else {
          material?.dispose();
        }
      }
    });
    renderer.dispose();
    renderer.domElement.remove();
  };

  return {
    scene,
    earthGroup,
    updateSatellites,
    updateObserver,
    setSelected,
    dispose,
  };
}

export function SatelliteGlobe({ location, selectedIds }: SatelliteGlobeProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<GlobeView | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [tles, setTles] = useState<TleEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<GlobeTelemetry | null>(null);
  const idsKey = selectedIds.join(",");
  const { lat, lon } = location;

  // Create the scene once (client-only; the component is lazy-loaded). The
  // useState setters are stable across renders, so they can be captured
  // directly by the once-created scene.
  useEffect(() => {
    if (!mountRef.current || viewRef.current) {
      return;
    }
    viewRef.current = createGlobeView(mountRef.current, {
      onSelect: setSelectedId,
      onTelemetry: setTelemetry,
    });
    return () => {
      viewRef.current?.dispose();
      viewRef.current = null;
    };
  }, []);

  // Load TLEs; refresh every minute (server TTL-caches the upstream fetch).
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const params = new URLSearchParams();
      if (idsKey.length > 0) {
        params.set("norad", idsKey);
      }
      try {
        const response = await fetch(`/api/sky/tles?${params.toString()}`);
        const body = await response.json();
        if (!response.ok || !body?.data?.tles) {
          throw new Error(body?.error?.message ?? "Couldn't load satellites.");
        }
        const loaded: TleEntry[] = body.data.tles;
        if (cancelled) {
          return;
        }
        setTles(loaded);
        setStatus(loaded.length > 0 ? "ready" : "error");
        setError(null);
        // Drop a selection that no longer exists in the new set.
        setSelectedId((prev) =>
          prev !== null && loaded.some((tle) => tle.noradId === prev)
            ? prev
            : null,
        );
      } catch (err) {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    };

    load();
    const timer = setInterval(load, TRACK_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [idsKey]);

  // Push TLE + observer updates into the scene whenever they change.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.updateObserver(lat, lon);
    if (tles.length > 0) {
      view.updateSatellites(tles);
    }
  }, [tles, lat, lon]);

  useEffect(() => {
    viewRef.current?.setSelected(selectedId);
  }, [selectedId]);

  return (
    <div className="glass glass-hover rounded-2xl p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-cyan-300">
          <Globe2 className="size-4.5" />
        </span>
        <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">
          Live sky globe
        </h3>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300/90">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          live
        </span>
      </div>

      <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start">
        <div className="relative w-full max-w-[480px] shrink-0">
          <div
            ref={mountRef}
            className="aspect-square w-full rounded-2xl"
            aria-label="3D globe showing live satellite positions and ground tracks"
          />
          {status === "ready" && (
            <SatelliteGlobeHud
              tles={tles}
              telemetry={telemetry}
              selectedId={selectedId}
              onSelect={setSelectedId}
              location={{ lat, lon }}
              colors={COLORS}
            />
          )}
          {status !== "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl">
              {status === "loading" ? (
                <>
                  <Loader2 className="size-6 animate-spin text-slate-500" />
                  <p className="text-xs text-slate-500">
                    Spinning up the globe…
                  </p>
                </>
              ) : (
                <>
                  <Satellite className="size-6 text-slate-500" />
                  <p className="max-w-60 text-center text-xs text-slate-500">
                    Couldn&apos;t load satellite positions
                    {error ? ` — ${error}` : ""}.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="w-full max-w-xs space-y-3 lg:pt-1">
          <p className="text-xs leading-relaxed text-slate-500">
            The globe spins at Earth&apos;s real rate — satellites orbit in
            fixed space, so you see the planet revolve beneath them. The pulsing
            dots are the satellites&apos; live positions around{" "}
            <span className="text-slate-300">
              {formatCoordinates(lat, lon)}
            </span>
            : past 30 min (dim), next 90 min (bright).
          </p>
          <p className="pt-1 text-[11px] leading-relaxed text-slate-600">
            Click a satellite (or its name in the list) to track it live · drag
            to orbit · scroll to zoom · TLEs from CelesTrak, refreshed every
            minute
          </p>
        </div>
      </div>
    </div>
  );
}
