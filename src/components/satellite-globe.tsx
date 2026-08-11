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
  sprite.scale.set(0.09, 0.09, 1);
  return sprite;
}

/**
 * Compact "pill tag" label: a rounded dark backdrop with a colored border,
 * drawn on an oversized canvas so long satellite names never truncate. The
 * sprite is small relative to the globe (~1/6 of its radius) — the previous
 * version rendered as oversized floating text.
 */
function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const font = "600 30px ui-sans-serif, system-ui, sans-serif";
  const canvas = document.createElement("canvas");
  // Oversized so measured text always fits; transparent margins are cropped
  // visually by keeping the sprite box proportional to the drawn pill.
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  const padX = 24;
  const pillWidth = Math.min(500, textWidth + padX * 2);
  const pillHeight = 60;
  const x = (canvas.width - pillWidth) / 2;
  const y = (canvas.height - pillHeight) / 2;

  // Rounded pill backdrop (dark navy, matches the app's cards).
  const radius = pillHeight / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + pillWidth - radius, y);
  ctx.arcTo(x + pillWidth, y, x + pillWidth, y + radius, radius);
  ctx.lineTo(x + pillWidth, y + pillHeight - radius);
  ctx.arcTo(
    x + pillWidth,
    y + pillHeight,
    x + pillWidth - radius,
    y + pillHeight,
    radius,
  );
  ctx.lineTo(x + radius, y + pillHeight);
  ctx.arcTo(x, y + pillHeight, x, y + pillHeight - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fillStyle = "rgba(6, 10, 24, 0.82)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();

  // Label text (white on the dark pill).
  ctx.font = font;
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    }),
  );
  // World-space size: ~0.15 of the globe radius tall, width proportional to
  // the text so tags stay tidy next to the blips.
  const height = 0.15;
  sprite.scale.set((pillWidth / pillHeight) * height, height, 1);
  return sprite;
}

/** A polyline on the globe surface (slightly lifted to avoid z-fighting). */
function buildTrackLine(
  points: GroundTrackPoint[],
  color: string,
  opacity: number,
): THREE.Line {
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    const v = latLonAltToVector3(point.lat, point.lon, 10);
    positions[index * 3] = v.x;
    positions[index * 3 + 1] = v.y;
    positions[index * 3 + 2] = v.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

/** Everything the animation loop + the React component need to drive. */
interface GlobeView {
  scene: THREE.Scene;
  earthGroup: THREE.Group;
  /** Replace the satellite set: tracks, blips and labels. */
  updateSatellites: (tles: TleEntry[]) => void;
  /** Move (or create) the observer marker at a lat/lon. */
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
  const blips = new Map<string, THREE.Sprite>();
  const labels = new Map<string, THREE.Sprite>();
  const tlesByNorad = new Map<string, TleEntry>();
  let youGlow: THREE.Sprite | null = null;
  let youLabel: THREE.Sprite | null = null;

  const updateSatellites = (tles: TleEntry[]) => {
    const removeSprite = (sprite: THREE.Sprite) => {
      sprite.parent?.remove(sprite);
      (sprite.material as THREE.SpriteMaterial).map?.dispose();
      sprite.material.dispose();
    };
    for (const blip of blips.values()) {
      removeSprite(blip);
    }
    for (const label of labels.values()) {
      removeSprite(label);
    }
    blips.clear();
    labels.clear();
    tlesByNorad.clear();

    tles.forEach((tle, index) => {
      tlesByNorad.set(tle.noradId, tle);
      const color = COLORS[index % COLORS.length];
      const track = computeGroundTrack(tle.line1, tle.line2);
      const nowMs = Date.now();
      earthGroup.add(
        buildTrackLine(
          track.filter((point) => point.time <= nowMs),
          color,
          0.3,
        ),
      );
      earthGroup.add(
        buildTrackLine(
          track.filter((point) => point.time > nowMs),
          color,
          0.85,
        ),
      );
      const blip = makeGlowSprite(color);
      earthGroup.add(blip);
      blips.set(tle.noradId, blip);
      const label = makeLabelSprite(tle.name, color);
      earthGroup.add(label);
      labels.set(tle.noradId, label);
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
    youGlow.scale.set(0.05, 0.05, 1);
    youGlow.position.copy(latLonAltToVector3(lat, lon, 0));
    earthGroup.add(youGlow);
    youLabel = makeLabelSprite("You", "#67e8f9");
    youLabel.position.copy(latLonAltToVector3(lat, lon, 0));
    youLabel.position.y += 0.11;
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

    const now = new Date();
    for (const [noradId, blip] of blips) {
      const tle = tlesByNorad.get(noradId);
      const label = labels.get(noradId);
      if (!tle) {
        continue;
      }
      const point = currentGroundPoint(tle.line1, tle.line2, now);
      if (point) {
        blip.position.copy(
          latLonAltToVector3(point.lat, point.lon, point.altitudeKm),
        );
        if (label) {
          label.position.copy(blip.position);
          label.position.y += 0.12;
        }
      }
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
            fixed space, so you see the planet revolve beneath them. Ground
            tracks around{" "}
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
