"use client";

import { Cloud, Loader2, Radar, Satellite } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatCoordinates } from "@/lib/utils";
import {
  RADAR_RADIUS_KM,
  clampToRadius,
  computeGroundTrack,
  currentGroundPoint,
  horizonRadiusKm,
  splitTrackAt,
  toLocalKm,
  type GroundTrackPoint,
} from "@/lib/satellite-map";
import type { LatLon } from "@/types";
import type { MoonTrack, MoonTrackPoint } from "@/services/sky/moon-track";

interface TleEntry {
  noradId: string;
  name: string;
  line1: string;
  line2: string;
}

interface SatelliteMapProps {
  location: LatLon;
  /** NORAD ids selected in the picker; empty = server-configured set. */
  selectedIds: string[];
}

const COLORS = ["#22d3ee", "#fbbf24", "#e879f9", "#34d399"];
/** Moon overlay color — neutral white, distinct from the satellite dots. */
const MOON_COLOR = "#f1f5f9";
const LOGICAL_SIZE = 480;
const PAD = 36;
const TRACK_REFRESH_MS = 60_000;

function drawRadar(
  canvas: HTMLCanvasElement,
  options: {
    location: LatLon;
    tles: TleEntry[];
    tracks: Map<string, GroundTrackPoint[]>;
    moon: MoonTrack | null;
    now: Date;
    /** Average cloud cover tonight (0-100), used to haze the disc. */
    cloudAverage: number | null;
  },
) {
  const { location, tles, tracks, moon, now, cloudAverage } = options;
  const dpr = window.devicePixelRatio || 1;
  const size = LOGICAL_SIZE;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const center = size / 2;
  const inner = size / 2 - PAD;
  const kmPerPx = RADAR_RADIUS_KM / inner;

  const toCanvas = (eastKm: number, northKm: number) => {
    const clamped = clampToRadius(eastKm, northKm);
    return {
      x: center + clamped.eastKm / kmPerPx,
      y: center - clamped.northKm / kmPerPx,
    };
  };

  // Radar disc
  ctx.beginPath();
  ctx.arc(center, center, inner, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(2, 6, 23, 0.65)";
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Range rings (1000 / 2000 / 3000 km)
  for (const km of [1000, 2000, RADAR_RADIUS_KM]) {
    ctx.beginPath();
    ctx.arc(center, center, (km / RADAR_RADIUS_KM) * inner, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
    ctx.stroke();
  }

  // Horizon circle for a ~400 km orbit (dashed)
  const horizonPx = Math.min(
    (horizonRadiusKm(400) / RADAR_RADIUS_KM) * inner,
    inner,
  );
  ctx.beginPath();
  ctx.arc(center, center, horizonPx, 0, Math.PI * 2);
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.stroke();
  ctx.setLineDash([]);

  // Crosshair
  ctx.beginPath();
  ctx.moveTo(center - inner, center);
  ctx.lineTo(center + inner, center);
  ctx.moveTo(center, center - inner);
  ctx.lineTo(center, center + inner);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
  ctx.stroke();

  // Cardinal labels
  ctx.fillStyle = "rgba(148, 163, 184, 0.85)";
  ctx.font = "600 11px ui-monospace, 'SF Mono', Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", center, center - inner - 13);
  ctx.fillText("S", center, center + inner + 15);
  ctx.fillText("E", center + inner + 15, center);
  ctx.fillText("W", center - inner - 15, center);

  const nowMs = now.getTime();

  // Moon sub-point + ground track (drawn under the satellites so the sat
  // blips stay prominent). The Moon is at 384,000 km — what matters here is
  // where it is directly overhead and which way that point is sweeping.
  if (moon) {
    const drawMoonTrack = (points: MoonTrackPoint[], alpha: number) => {
      if (points.length === 0) {
        return;
      }
      ctx.beginPath();
      let started = false;
      for (const point of points) {
        const { eastKm, northKm } = toLocalKm(point.lat, point.lon, location);
        const { x, y } = toCanvas(eastKm, northKm);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = MOON_COLOR;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const moonPast = moon.track.filter((point) => point.time <= nowMs);
    const moonFuture = moon.track.filter((point) => point.time > nowMs);
    // Pin both line ends to the live sub-point so they meet the marker.
    const current = { ...moon.now, time: nowMs };
    drawMoonTrack([...moonPast, current], 0.2);
    drawMoonTrack([current, ...moonFuture], 0.55);

    const { eastKm, northKm } = toLocalKm(moon.now.lat, moon.now.lon, location);
    const { x, y } = toCanvas(eastKm, northKm);
    // Ring marker — a hollow circle so it reads as "the Moon", not a satellite.
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = MOON_COLOR;
    ctx.lineWidth = 2;
    ctx.shadowColor = MOON_COLOR;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = MOON_COLOR;
    ctx.fill();
    ctx.fillStyle = MOON_COLOR;
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Moon", x + 11, y - 4);
  }

  // Satellite tracks + blips
  tles.forEach((tle, index) => {
    const color = COLORS[index % COLORS.length];
    const track = tracks.get(tle.noradId) ?? [];
    const { past, future } = splitTrackAt(track, nowMs);

    const drawTrack = (points: GroundTrackPoint[], alpha: number) => {
      if (points.length === 0) {
        return;
      }
      ctx.beginPath();
      let started = false;
      for (const point of points) {
        const { eastKm, northKm } = toLocalKm(point.lat, point.lon, location);
        const { x, y } = toCanvas(eastKm, northKm);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    drawTrack(past, 0.3);
    drawTrack(future, 0.9);

    const current = currentGroundPoint(tle.line1, tle.line2, now);
    if (!current) {
      return;
    }
    const { eastKm, northKm } = toLocalKm(current.lat, current.lon, location);
    const { x, y } = toCanvas(eastKm, northKm);

    // Blip with glow + halo
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Name label
    ctx.fillStyle = color;
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(tle.name, x + 11, y - 4);
  });

  // Observer at the center
  ctx.beginPath();
  ctx.arc(center, center, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#67e8f9";
  ctx.shadowColor = "#67e8f9";
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(103, 232, 249, 0.6)";
  ctx.stroke();
  ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("You", center + 9, center - 4);

  // Cloud haze over the whole disc when the night is overcast — a subtle
  // milky tint whose density tracks the average cloud cover.
  if (cloudAverage !== null && cloudAverage > 10) {
    ctx.beginPath();
    ctx.arc(center, center, inner, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(
      center,
      center,
      inner * 0.25,
      center,
      center,
      inner,
    );
    const alpha = Math.min(0.35, (cloudAverage / 100) * 0.4);
    gradient.addColorStop(0, `rgba(226, 232, 240, ${alpha * 0.6})`);
    gradient.addColorStop(1, `rgba(226, 232, 240, ${alpha})`);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

/**
 * Live satellite radar: a custom canvas map centered on the observer showing
 * each tracked satellite's ground track (past 30 min dim, next 90 min bright)
 * and its live position. TLEs come from the same server-side cache as the
 * brief and are propagated client-side, so the map animates without any
 * network traffic.
 */
export function SatelliteMap({ location, selectedIds }: SatelliteMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tlesRef = useRef<TleEntry[]>([]);
  const tracksRef = useRef<Map<string, GroundTrackPoint[]>>(new Map());
  const [tles, setTles] = useState<TleEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [cloudLevel, setCloudLevel] = useState<string | null>(null);
  const [cloudAverage, setCloudAverage] = useState<number | null>(null);
  const cloudAverageRef = useRef<number | null>(null);
  const [moon, setMoon] = useState<MoonTrack | null>(null);
  const moonRef = useRef<MoonTrack | null>(null);
  const idsKey = selectedIds.join(",");
  const { lat, lon } = location;

  // Load TLEs and precompute tracks; refresh every minute (server TTL-caches).
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
        tracksRef.current = new Map(
          loaded.map((tle) => [
            tle.noradId,
            computeGroundTrack(tle.line1, tle.line2),
          ]),
        );
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

  // Cloud-cover summary for the haze + badge (server-side TTL cached).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/sky/clouds?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
        );
        const body = await response.json();
        if (cancelled || !body?.data) {
          return;
        }
        cloudAverageRef.current = body.data.average ?? null;
        setCloudLevel(body.data.level ?? null);
        setCloudAverage(body.data.average ?? null);
      } catch {
        // Clouds are decorative — fail silently.
      }
    };
    load();
    const timer = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lat, lon]);

  // Moon sub-point + track; refresh every minute (it moves only ~15°/hour).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/sky/moon");
        const body = await response.json();
        if (cancelled || !body?.data) {
          return;
        }
        moonRef.current = body.data as MoonTrack;
        setMoon(body.data as MoonTrack);
      } catch {
        // The moon overlay is decorative — fail silently.
      }
    };
    load();
    const timer = setInterval(load, TRACK_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Animate at 60fps using the latest data (refs avoid re-running the loop).
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        drawRadar(canvas, {
          location: { lat, lon },
          tles: tlesRef.current,
          tracks: tracksRef.current,
          moon: moonRef.current,
          now: new Date(),
          cloudAverage: cloudAverageRef.current,
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [lat, lon]);

  return (
    <div className="glass glass-hover rounded-2xl p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-cyan-300">
          <Radar className="size-4.5" />
        </span>
        <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">
          Live sky radar
        </h3>
        <span className="ml-auto inline-flex items-center gap-2.5">
          {cloudLevel && cloudLevel !== "UNKNOWN" && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                cloudLevel === "CLEAR"
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : cloudLevel === "PARTLY_CLOUDY"
                    ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
                    : "border-slate-400/40 bg-slate-400/10 text-slate-300"
              }`}
              title={`${cloudAverage ?? "?"}% average cloud cover tonight`}
            >
              <Cloud className="size-3" />
              {cloudLevel === "CLEAR"
                ? "Clear"
                : cloudLevel === "PARTLY_CLOUDY"
                  ? "Partly cloudy"
                  : "Cloudy"}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300/90">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            live
          </span>
        </span>
      </div>

      <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start">
        <div className="relative w-full max-w-[480px] shrink-0">
          <canvas
            ref={canvasRef}
            className="aspect-square w-full"
            aria-label="Satellite ground-track radar centered on your location"
          />
          {status !== "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl">
              {status === "loading" ? (
                <>
                  <Loader2 className="size-6 animate-spin text-slate-500" />
                  <p className="text-xs text-slate-500">Plotting satellites…</p>
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
            Ground tracks around{" "}
            <span className="text-slate-300">
              {formatCoordinates(location.lat, location.lon)}
            </span>{" "}
            — past 30 min (dim) and the next 90 min (bright). Positions update
            live; the dashed ring is the horizon for a ~400 km orbit.
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
            {moon && (
              <li className="flex items-center gap-2.5">
                <span className="inline-block size-2.5 rounded-full border-2 border-slate-200" />
                <span className="text-sm text-slate-200">Moon</span>
                <span className="mono ml-auto text-[10px] text-slate-500">
                  sub-point
                </span>
              </li>
            )}
          </ul>
          <p className="pt-1 text-[11px] text-slate-600">
            TLEs from CelesTrak · refreshed every minute
          </p>
        </div>
      </div>
    </div>
  );
}
