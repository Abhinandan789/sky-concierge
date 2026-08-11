"use client";

import { Clock3, MapPin, Satellite as SatelliteIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  findSatellitePasses,
  type PassFinderOptions,
} from "@/services/sky/iss-passes";
import { formatCompass, formatCoordinates, formatTime } from "@/lib/utils";
import type { LatLon } from "@/types";
import type { GlobeTelemetry } from "./satellite-globe";

interface TleEntry {
  noradId: string;
  name: string;
  line1: string;
  line2: string;
}

interface SatelliteGlobeHudProps {
  tles: TleEntry[];
  telemetry: GlobeTelemetry | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  location: LatLon;
  /** Per-satellite track colors, aligned with the tles order. */
  colors: string[];
}

const PANEL =
  "pointer-events-auto w-max min-w-[9.5rem] max-w-[12rem] rounded-xl border border-white/10 bg-slate-950/70 p-2.5 shadow-lg shadow-black/40 backdrop-blur-md";
const HEADER = "mb-2 text-[9px] font-bold uppercase tracking-[0.18em]";

/** Live UTC clock, ticking every second. */
function useUtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** "18:42" style time + how far away it is ("in 23 min"). */
function formatUpcoming(date: Date | null, now: Date): string | null {
  if (!date) {
    return null;
  }
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (minutes < 0) {
    return "now";
  }
  if (minutes < 1) {
    return "starting soon";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function SatelliteGlobeHud({
  tles,
  telemetry,
  selectedId,
  onSelect,
  location,
  colors,
}: SatelliteGlobeHudProps) {
  const now = useUtcClock();
  const { lat: observerLat, lon: observerLon } = location;
  const selectedTle = tles.find((tle) => tle.noradId === selectedId) ?? null;
  const selectedTelemetry = selectedId
    ? (telemetry?.sats[selectedId] ?? null)
    : null;

  // Next pass for the selected satellite, recomputed when it changes or the
  // TLEs refresh (~24 h scan, a few ms). The first run is deferred off the
  // effect body (react-hooks/set-state-in-effect).
  const [nextPass, setNextPass] = useState<Date | null>(null);
  useEffect(() => {
    let cancelled = false;
    const apply = (value: Date | null) => {
      if (!cancelled) {
        setNextPass(value);
      }
    };
    const compute = () => {
      if (!selectedTle) {
        apply(null);
        return;
      }
      const options: PassFinderOptions = {
        horizonDeg: 10,
        windowHours: 24,
        stepSeconds: 30,
      };
      const passes = findSatellitePasses(
        selectedTle.line1,
        selectedTle.line2,
        { lat: observerLat, lon: observerLon },
        options,
      );
      apply(passes[0]?.start ?? null);
    };
    const timer = setInterval(compute, 60_000);
    const initial = window.setTimeout(compute, 0);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.clearTimeout(initial);
    };
  }, [selectedTle, observerLat, observerLon]);

  const inViewCount = useMemo(
    () =>
      Object.values(telemetry?.sats ?? {}).filter((entry) => entry.inView)
        .length,
    [telemetry],
  );

  // Compass target: the selected satellite, else the first tracked one.
  const compassId = selectedId ?? tles[0]?.noradId ?? null;
  const compassAzimuth =
    (compassId ? telemetry?.sats[compassId]?.azimuthDeg : undefined) ?? 0;
  const compassName =
    tles.find((tle) => tle.noradId === compassId)?.name ?? null;

  const utcTime = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
  const utcDate = now.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="false">
      {/* SATELLITES — top-left, click to track */}
      <div className={`${PANEL} absolute top-2.5 left-2.5`}>
        <h4 className={`${HEADER} text-slate-300`}>Satellites</h4>
        <ul className="space-y-1.5">
          {tles.map((tle, index) => {
            const color = colors[index % colors.length];
            const entry = telemetry?.sats[tle.noradId];
            const active = tle.noradId === selectedId;
            return (
              <li key={tle.noradId}>
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : tle.noradId)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition ${
                    active
                      ? "bg-white/10 ring-1 ring-white/15"
                      : "hover:bg-white/5"
                  }`}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: color,
                      boxShadow: `0 0 8px ${color}`,
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] leading-tight font-medium text-slate-100">
                      {tle.name}
                    </span>
                    <span className="mono block text-[9px] leading-tight text-slate-500">
                      {entry ? `${Math.round(entry.altitudeKm)} km` : "…"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* DETAIL — top-right, follows the selected satellite live */}
      {selectedTle && (
        <div className={`${PANEL} absolute top-2.5 right-2.5`}>
          <h4
            className={`${HEADER} truncate`}
            style={{
              color:
                colors[
                  tles.findIndex((tle) => tle.noradId === selectedTle.noradId) %
                    colors.length
                ],
            }}
          >
            {selectedTle.name}
          </h4>
          <dl className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[9px] tracking-wider text-slate-500 uppercase">
                Altitude
              </dt>
              <dd className="mono text-[11px] text-slate-100">
                {selectedTelemetry
                  ? `${Math.round(selectedTelemetry.altitudeKm)} km`
                  : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[9px] tracking-wider text-slate-500 uppercase">
                Velocity
              </dt>
              <dd className="mono text-[11px] text-slate-100">
                {selectedTelemetry
                  ? `${selectedTelemetry.speedKmS.toFixed(2)} km/s`
                  : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[9px] tracking-wider text-slate-500 uppercase">
                Elevation
              </dt>
              <dd className="mono text-[11px] text-slate-100">
                {selectedTelemetry
                  ? `${Math.round(selectedTelemetry.elevationDeg)}° ${
                      selectedTelemetry.elevationDeg < 0 ? "below horizon" : ""
                    }`
                  : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[9px] tracking-wider text-slate-500 uppercase">
                Next pass
              </dt>
              <dd className="mono text-right text-[11px] text-slate-100">
                {nextPass ? (
                  <>
                    {formatTime(nextPass, "UTC")}
                    <span className="block text-[9px] text-slate-500">
                      UTC · {formatUpcoming(nextPass, now)}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* TRACKING — bottom-left */}
      <div className={`${PANEL} absolute bottom-2.5 left-2.5`}>
        <h4 className={`${HEADER} text-cyan-300`}>Tracking</h4>
        <dl className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Clock3 className="size-3 shrink-0 text-slate-500" />
            <dd className="mono text-[11px] text-slate-100">
              {utcTime}
              <span className="ml-1.5 text-[9px] text-slate-500">
                {utcDate}
              </span>
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="size-3 shrink-0 text-slate-500" />
            <dd className="text-[11px] text-slate-100">
              {formatCoordinates(observerLat, observerLon)}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <SatelliteIcon className="size-3 shrink-0 text-slate-500" />
            <dd className="mono text-[11px] text-slate-100">
              {inViewCount} {inViewCount === 1 ? "satellite" : "satellites"}
              <span className="ml-1.5 text-[9px] text-slate-500">in view</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* COMPASS — bottom-right, points at the tracked satellite */}
      <div className="pointer-events-none absolute right-2.5 bottom-2.5 flex flex-col items-center gap-1">
        <svg viewBox="0 0 80 80" className="size-16 drop-shadow-lg">
          <circle
            cx="40"
            cy="40"
            r="38"
            fill="rgba(2, 6, 23, 0.7)"
            stroke="rgba(255, 255, 255, 0.18)"
            strokeWidth="1"
          />
          <circle
            cx="40"
            cy="40"
            r="30"
            fill="none"
            stroke="rgba(255, 255, 255, 0.09)"
            strokeDasharray="2 4"
            strokeWidth="1"
          />
          <text
            x="40"
            y="13"
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="#cbd5e1"
          >
            N
          </text>
          <text x="70" y="44" textAnchor="middle" fontSize="9" fill="#64748b">
            E
          </text>
          <text x="40" y="76" textAnchor="middle" fontSize="9" fill="#64748b">
            S
          </text>
          <text x="10" y="44" textAnchor="middle" fontSize="9" fill="#64748b">
            W
          </text>
          <g transform={`rotate(${compassAzimuth} 40 40)`}>
            <path
              d="M40 14 L45.5 40 L40 66 L34.5 40 Z"
              fill="#22d3ee"
              opacity="0.9"
            />
          </g>
          <circle cx="40" cy="40" r="3.5" fill="#0e7490" />
          <circle cx="40" cy="40" r="1.5" fill="#a5f3fc" />
        </svg>
        <span className="mono text-[9px] text-slate-400">
          {Math.round(compassAzimuth)}° {formatCompass(compassAzimuth)}
          {compassName ? ` · ${compassName}` : ""}
        </span>
      </div>
    </div>
  );
}
