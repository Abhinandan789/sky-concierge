"use client";

import { Globe2, Loader2, Satellite } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatCoordinates } from "@/lib/utils";
import {
  computeGroundTrack,
  currentGroundPoint,
  type GroundTrackPoint,
} from "@/lib/satellite-map";
import type { LatLon } from "@/types";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
/** World-space height of a label pill (globe radius = 1). */
const LABEL_HEIGHT = 0.16;
const COLORS = ["#22d3ee", "#fbbf24", "#e879f9", "#34d399"];

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

/**
 * Glass-style "pill tag" label, cropped exactly to its own size so the text
 * renders crisp (no aspect distortion — the previous version stretched the
 * canvas, which is what made it look cheap). A colored dot ties the tag to
 * the satellite's track color, and a callout tail points down at the blip.
 */
function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const font = "600 30px ui-sans-serif, system-ui, sans-serif";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const textWidth = measure.measureText(text).width;

  const pillHeight = 54;
  const dotRadius = 6;
  const dotPadLeft = 22; // dot + spacing before the text
  const tailSize = 7;
  const pillWidth = Math.ceil(textWidth + dotPadLeft + 26);
  const canvas = document.createElement("canvas");
  canvas.width = pillWidth;
  canvas.height = pillHeight + tailSize;
  const ctx = canvas.getContext("2d")!;
  const radius = pillHeight / 2;

  // Soft drop shadow so the tag lifts off the starfield (like the app cards).
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;

  // Pill backdrop: subtle vertical gradient (dark navy → deeper).
  const gradient = ctx.createLinearGradient(0, 0, 0, pillHeight);
  gradient.addColorStop(0, "rgba(30, 38, 66, 0.97)");
  gradient.addColorStop(1, "rgba(9, 13, 30, 0.97)");
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(pillWidth - radius, 0);
  ctx.arcTo(pillWidth, 0, pillWidth, radius, radius);
  ctx.lineTo(pillWidth, pillHeight - radius);
  ctx.arcTo(pillWidth, pillHeight, pillWidth - radius, pillHeight, radius);
  ctx.lineTo(radius, pillHeight);
  ctx.arcTo(0, pillHeight, 0, pillHeight - radius, radius);
  ctx.lineTo(0, radius);
  ctx.arcTo(0, 0, radius, 0, radius);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowColor = "transparent";

  // Thin colored border.
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(radius, 1);
  ctx.lineTo(pillWidth - radius, 1);
  ctx.arcTo(pillWidth - 1, 1, pillWidth - 1, radius, radius - 1);
  ctx.lineTo(pillWidth - 1, pillHeight - radius);
  ctx.arcTo(
    pillWidth - 1,
    pillHeight - 1,
    pillWidth - radius,
    pillHeight - 1,
    radius - 1,
  );
  ctx.lineTo(radius, pillHeight - 1);
  ctx.arcTo(1, pillHeight - 1, 1, pillHeight - radius, radius - 1);
  ctx.lineTo(1, radius);
  ctx.arcTo(1, 1, radius, 1, radius - 1);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Colored dot matching the satellite's track color.
  ctx.beginPath();
  ctx.arc(
    dotPadLeft / 2 + dotRadius / 2,
    pillHeight / 2,
    dotRadius,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Label text with a subtle shadow for readability.
  ctx.font = font;
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#eef2ff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, dotPadLeft + dotRadius, pillHeight / 2 + 1);
  ctx.shadowBlur = 0;

  // Callout tail pointing down at the satellite.
  ctx.beginPath();
  ctx.moveTo(pillWidth / 2 - tailSize, pillHeight);
  ctx.lineTo(pillWidth / 2, pillHeight + tailSize);
  ctx.lineTo(pillWidth / 2 + tailSize, pillHeight);
  ctx.closePath();
  ctx.fillStyle = "rgba(9, 13, 30, 0.97)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pillWidth / 2 - tailSize, pillHeight - 0.5);
  ctx.lineTo(pillWidth / 2, pillHeight + tailSize - 1);
  ctx.lineTo(pillWidth / 2 + tailSize, pillHeight - 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    }),
  );
  // Anchor the sprite's bottom-center (the tail) at the satellite position.
  sprite.center.set(0.5, 0);
  sprite.scale.set(
    (canvas.width / canvas.height) * LABEL_HEIGHT,
    LABEL_HEIGHT,
    1,
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
  label: THREE.Sprite;
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
  const halo = makeGlowSprite(color);
  halo.scale.set(0.22, 0.22, 1);
  const label = makeLabelSprite(tle.name, color);

  return {
    tle,
    times,
    pastGeometry,
    futureGeometry,
    pastLine,
    futureLine,
    core,
    halo,
    label,
  };
}

/** Everything the React component needs to drive the scene. */
interface GlobeView {
  scene: THREE.Scene;
  earthGroup: THREE.Group;
  updateSatellites: (tles: TleEntry[]) => void;
  updateObserver: (lat: number, lon: number) => void;
  dispose: () => void;
}

/** Build the whole three.js scene; returns a handle for driving + disposal. */
function createGlobeView(container: HTMLDivElement): GlobeView {
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
  let youGlow: THREE.Sprite | null = null;
  let youLabel: THREE.Sprite | null = null;

  const updateSatellites = (tles: TleEntry[]) => {
    for (const sat of sats.values()) {
      earthGroup.remove(
        sat.pastLine,
        sat.futureLine,
        sat.core,
        sat.halo,
        sat.label,
      );
      sat.pastGeometry.dispose();
      sat.futureGeometry.dispose();
      (sat.pastLine.material as THREE.Material).dispose();
      (sat.futureLine.material as THREE.Material).dispose();
      (sat.core.material as THREE.SpriteMaterial).map?.dispose();
      (sat.core.material as THREE.Material).dispose();
      (sat.halo.material as THREE.SpriteMaterial).map?.dispose();
      (sat.halo.material as THREE.Material).dispose();
      (sat.label.material as THREE.SpriteMaterial).map?.dispose();
      (sat.label.material as THREE.Material).dispose();
    }
    sats.clear();

    tles.forEach((tle, index) => {
      const sat = buildSatellite(tle, index);
      earthGroup.add(
        sat.pastLine,
        sat.futureLine,
        sat.core,
        sat.halo,
        sat.label,
      );
      sats.set(tle.noradId, sat);
    });
  };

  const updateObserver = (lat: number, lon: number) => {
    if (youGlow) {
      earthGroup.remove(youGlow);
      (youGlow.material as THREE.SpriteMaterial).map?.dispose();
      youGlow.material.dispose();
    }
    if (youLabel) {
      earthGroup.remove(youLabel);
      (youLabel.material as THREE.SpriteMaterial).map?.dispose();
      youLabel.material.dispose();
    }
    youGlow = makeGlowSprite("#67e8f9");
    youGlow.scale.set(0.055, 0.055, 1);
    youGlow.position.copy(latLonAltToVector3(lat, lon, 0));
    earthGroup.add(youGlow);
    youLabel = makeLabelSprite("You", "#67e8f9");
    youLabel.position.copy(latLonAltToVector3(lat, lon, 0));
    earthGroup.add(youLabel);
  };

  const clock = new THREE.Clock();
  let frame = 0;
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
      sat.label.position.copy(blipPos);

      // Pulse the halo so the satellite reads as a live beacon.
      const pulse = 0.5 + 0.5 * Math.sin(nowMs / 280);
      const haloScale = 0.22 + 0.07 * pulse;
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

  return { scene, earthGroup, updateSatellites, updateObserver, dispose };
}

export function SatelliteGlobe({ location, selectedIds }: SatelliteGlobeProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<GlobeView | null>(null);
  const tlesRef = useRef<TleEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [tles, setTles] = useState<TleEntry[]>([]);
  const idsKey = selectedIds.join(",");
  const { lat, lon } = location;

  // Create the scene once (client-only; the component is lazy-loaded).
  useEffect(() => {
    if (!mountRef.current || viewRef.current) {
      return;
    }
    viewRef.current = createGlobeView(mountRef.current);
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
        tlesRef.current = loaded;
        setTles(loaded);
        setStatus(loaded.length > 0 ? "ready" : "error");
        setError(null);
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
            dot is the satellite&apos;s live position; ground tracks around{" "}
            <span className="text-slate-300">
              {formatCoordinates(lat, lon)}
            </span>
            : past 30 min (dim), next 90 min (bright).
          </p>
          <ul className="space-y-2">
            {tles.map((tle, index) => (
              <li key={tle.noradId} className="flex items-center gap-2.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{
                    backgroundColor: COLORS[index % COLORS.length],
                    boxShadow: `0 0 8px ${COLORS[index % COLORS.length]}`,
                  }}
                />
                <span className="text-sm text-slate-200">{tle.name}</span>
                <span className="mono ml-auto text-[10px] text-slate-500">
                  NORAD {tle.noradId}
                </span>
              </li>
            ))}
          </ul>
          <p className="pt-1 text-[11px] leading-relaxed text-slate-600">
            Drag to orbit · scroll to zoom · TLEs from CelesTrak, refreshed
            every minute
          </p>
        </div>
      </div>
    </div>
  );
}
