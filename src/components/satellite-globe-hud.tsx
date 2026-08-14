"use client";

import {
  ChevronDown,
  ChevronUp,
  Clock3,
  MapPin,
  Satellite as SatelliteIcon,
} from "lucide-react";
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
  /** The globe canvas — rendered centered, panels float at the edges. */
  children: React.ReactNode;
  /** Swing the camera to the observer's location ("You" legend row). */
  onCenterOnYou?: () => void;
  /** Simulated-clock offset (ms) from the time scrubber; 0 = live. The
   * clock display and next-pass countdown follow it. */
  simOffsetMs?: number;
}

const PANEL =
  "pointer-events-auto rounded-xl border border-white/10 bg-slate-950/80 shadow-lg shadow-black/50 backdrop-blur-sm";
const HEADER = "mb-2 text-[9px] font-bold uppercase tracking-[0.18em]";

/** Live UTC clock, ticking every second — plus an optional sim offset from
 * the globe's time scrubber, so the HUD shows the previewed time. */
function useUtcClock(offsetMs = 0) {
  const [now, setNow] = useState(() => new Date(Date.now() + offsetMs));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(new Date(Date.now() + offsetMs)),
      1000,
    );
    return () => clearInterval(timer);
  }, [offsetMs]);
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

/* ── Panel bodies (shared by the floating desktop layout and the stacked
      mobile layout — one source of truth for the HUD content) ──────── */

function SatellitesPanel({
  tles,
  colors,
  telemetry,
  selectedId,
  onSelect,
  listOpen,
  onToggleList,
}: {
  tles: TleEntry[];
  colors: string[];
  telemetry: GlobeTelemetry | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  listOpen: boolean;
  onToggleList: () => void;
}) {
  return (
    <div className={`${PANEL} p-2.5`}>
      <button
        type="button"
        onClick={onToggleList}
        className="flex w-full items-center gap-1.5"
        aria-expanded={listOpen}
      >
        <h4 className={`${HEADER} mb-0 text-slate-300`}>Satellites</h4>
        <span className="ml-auto text-slate-500">
          {listOpen ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </span>
      </button>
      {listOpen && (
        <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
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
      )}
      {!listOpen && (
        <p className="mt-1 truncate text-[10px] text-slate-400">
          {tles.length} tracked · tap to expand
        </p>
      )}
    </div>
  );
}

function TrackingPanel({
  utcTime,
  utcDate,
  observerLat,
  observerLon,
  inViewCount,
}: {
  utcTime: string;
  utcDate: string;
  observerLat: number;
  observerLon: number;
  inViewCount: number;
}) {
  return (
    <div className={`${PANEL} p-2.5`}>
      <h4 className={`${HEADER} text-cyan-300`}>Tracking</h4>
      <dl className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Clock3 className="size-3 shrink-0 text-slate-500" />
          <dd className="mono text-[11px] text-slate-100">
            {utcTime}
            <span className="ml-1.5 text-[9px] text-slate-500">{utcDate}</span>
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
      {inViewCount === 0 && (
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
          All tracked objects are below your horizon right now — the next pass
          comes into view within the next orbit (~90 min).
        </p>
      )}
    </div>
  );
}

/** Legend — what the lights on the globe mean; "You" recenters the view. */
function LegendPanel({ onCenterOnYou }: { onCenterOnYou?: () => void }) {
  return (
    <div className={`${PANEL} p-2.5`}>
      <h4 className={`${HEADER} text-slate-300`}>On the globe</h4>
      <ul className="space-y-1.5">
        <li>
          <button
            type="button"
            onClick={onCenterOnYou}
            title="Rotate the view to your location"
            className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-white/5"
          >
            <span className="size-2 shrink-0 rounded-full bg-[#67e8f9] shadow-[0_0_8px_#67e8f9]" />
            <span className="text-[11px] text-slate-200">You</span>
            <span className="ml-auto text-[9px] text-slate-500">
              center view
            </span>
          </button>
        </li>
        <li className="flex items-center gap-2 px-1">
          <span className="inline-block h-0.5 w-4 shrink-0 rounded-full bg-gradient-to-r from-cyan-400/30 to-cyan-300" />
          <span className="text-[11px] text-slate-200">Ground track</span>
          <span className="ml-auto text-[9px] text-slate-500">
            dim past · bright ahead
          </span>
        </li>
        <li className="flex items-center gap-2 px-1">
          <span className="inline-block h-0.5 w-4 shrink-0 rounded-full bg-lime-400/80" />
          <span className="text-[11px] text-slate-200">Visible pass</span>
          <span className="ml-auto text-[9px] text-slate-500">
            elevation + dark
          </span>
        </li>
        <li className="flex items-center gap-2 px-1">
          <span className="inline-block size-2.5 shrink-0 rounded-full border-2 border-[#f1f5f9]" />
          <span className="text-[11px] text-slate-200">Moon</span>
          <span className="ml-auto text-[9px] text-slate-500">
            sub-point · its path
          </span>
        </li>
      </ul>
    </div>
  );
}

function TelemetryPanel({
  tles,
  colors,
  selectedTle,
  selectedTelemetry,
  nextPass,
  now,
}: {
  tles: TleEntry[];
  colors: string[];
  selectedTle: TleEntry;
  selectedTelemetry: GlobeTelemetry["sats"][string] | null;
  nextPass: Date | null;
  now: Date;
}) {
  return (
    <div className={`${PANEL} w-full p-2.5`}>
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
            Next pass
          </dt>
          <dd className="mono text-right text-[11px] font-semibold text-slate-100">
            {nextPass ? (
              <>
                {formatTime(nextPass, "UTC")}
                <span className="block text-[9px] font-normal text-slate-500">
                  UTC · {formatUpcoming(nextPass, now)}
                </span>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
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
            Sub-point
          </dt>
          <dd className="mono text-right text-[11px] text-slate-100">
            {selectedTelemetry
              ? formatCoordinates(selectedTelemetry.lat, selectedTelemetry.lon)
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Compass — points at the tracked satellite. */
function CompassPanel({
  azimuth,
  name,
}: {
  azimuth: number;
  name: string | null;
}) {
  return (
    <div className={`${PANEL} flex flex-col items-center gap-1 p-2`}>
      <svg viewBox="0 0 80 80" className="size-14 drop-shadow-lg">
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
        <g transform={`rotate(${azimuth} 40 40)`}>
          <path
            d="M40 14 L45.5 40 L40 66 L34.5 40 Z"
            fill="#22d3ee"
            opacity="0.9"
          />
        </g>
        <circle cx="40" cy="40" r="3.5" fill="#0e7490" />
        <circle cx="40" cy="40" r="1.5" fill="#a5f3fc" />
      </svg>
      <span className="mono max-w-full truncate text-[9px] text-slate-400">
        {Math.round(azimuth)}° {formatCompass(azimuth)}
        {name ? ` · ${name}` : ""}
      </span>
    </div>
  );
}

export function SatelliteGlobeHud({
  tles,
  telemetry,
  selectedId,
  onSelect,
  location,
  colors,
  children,
  onCenterOnYou,
  simOffsetMs = 0,
}: SatelliteGlobeHudProps) {
  const now = useUtcClock(simOffsetMs);
  const { lat: observerLat, lon: observerLon } = location;
  const selectedTle = tles.find((tle) => tle.noradId === selectedId) ?? null;
  const selectedTelemetry = selectedId
    ? (telemetry?.sats[selectedId] ?? null)
    : null;

  // Compass target: the selected satellite, else the first tracked one.
  const compassId = selectedId ?? tles[0]?.noradId ?? null;
  const compassTle =
    tles.find((tle) => tle.noradId === compassId) ?? null;
  const compassAzimuth =
    (compassId ? telemetry?.sats[compassId]?.azimuthDeg : undefined) ?? 0;
  const compassName = compassTle?.name ?? null;

  // Next pass for the compass target (the selected satellite, else the
  // first tracked one), recomputed when it changes or the TLEs refresh
  // (~24 h scan, a few ms). The first run is deferred off the effect body
  // (react-hooks/set-state-in-effect).
  const [nextPass, setNextPass] = useState<Date | null>(null);
  useEffect(() => {
    let cancelled = false;
    const apply = (value: Date | null) => {
      if (!cancelled) {
        setNextPass(value);
      }
    };
    const compute = () => {
      if (!compassTle) {
        apply(null);
        return;
      }
      const options: PassFinderOptions = {
        horizonDeg: 10,
        windowHours: 24,
        stepSeconds: 30,
        // Search from the previewed time, not the wall clock.
        now: new Date(Date.now() + simOffsetMs),
      };
      const passes = findSatellitePasses(
        compassTle.line1,
        compassTle.line2,
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
  }, [compassTle, observerLat, observerLon, simOffsetMs]);

  // "Visible soon" — a transient nudge next to the compass when the next
  // pass starts within the next 10 minutes (reuses the same computed pass).
  const minutesToNextPass =
    nextPass === null ? null : (nextPass.getTime() - now.getTime()) / 60_000;
  const passImminent =
    minutesToNextPass !== null && minutesToNextPass > 0 && minutesToNextPass <= 10;
  const passBanner = passImminent ? (
    <div className={`${PANEL} px-3 py-2 text-center`}>
      <p className="text-[11px] leading-tight font-semibold text-lime-300">
        {compassName} visible in {Math.round(minutesToNextPass as number)} min
      </p>
      <p className="mt-0.5 text-[10px] text-slate-400">
        look {formatCompass(compassAzimuth)} · {Math.round(compassAzimuth)}°
      </p>
    </div>
  ) : null;

  const inViewCount = useMemo(
    () =>
      Object.values(telemetry?.sats ?? {}).filter((entry) => entry.inView)
        .length,
    [telemetry],
  );

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

  // The satellites list can get long — collapse it to a compact summary so
  // it never covers the globe on short screens.
  const [listOpen, setListOpen] = useState(false);
  const toggleList = () => setListOpen((open) => !open);

  // Tracking + legend also collapse behind a "View details" toggle on mobile,
  // so the globe isn't pushed down by a wall of readouts.
  const [detailsOpen, setDetailsOpen] = useState(false);

  const trackingPanel = (
    <TrackingPanel
      utcTime={utcTime}
      utcDate={utcDate}
      observerLat={observerLat}
      observerLon={observerLon}
      inViewCount={inViewCount}
    />
  );
  const legendPanel = <LegendPanel onCenterOnYou={onCenterOnYou} />;
  const compassPanel = (
    <CompassPanel azimuth={compassAzimuth} name={compassName} />
  );
  const telemetryPanel = selectedTle ? (
    <TelemetryPanel
      tles={tles}
      colors={colors}
      selectedTle={selectedTle}
      selectedTelemetry={selectedTelemetry}
      nextPass={nextPass}
      now={now}
    />
  ) : null;

  return (
    <div className="relative">
      {/* The globe itself — full width, centered, never covered. */}
      <div className="relative mx-auto w-full max-w-4xl">{children}</div>

      {/* Mobile / tablet — the panels step out of the way and stack below the
          globe in one tidy column (same rhythm as the radar card), so nothing
          covers the canvas. Telemetry jumps to the top when a satellite is
          selected; tracking and the legend share a row. */}
      <div className="mt-3 w-full space-y-2.5 md:hidden">
        {telemetryPanel && <div>{telemetryPanel}</div>}
        <div>
          <SatellitesPanel
            tles={tles}
            colors={colors}
            telemetry={telemetry}
            selectedId={selectedId}
            onSelect={onSelect}
            listOpen={listOpen}
            onToggleList={toggleList}
          />
        </div>
        {/* Tracking + legend collapse behind a toggle on mobile */}
        <div className={`${PANEL} p-2.5`}>
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className="flex w-full items-center gap-1.5"
          >
            <h4 className={`${HEADER} mb-0 text-slate-300`}>View details</h4>
            <span className="ml-auto text-slate-500">
              {detailsOpen ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </span>
          </button>
          {detailsOpen && (
            <div className="mt-2 grid grid-cols-2 items-stretch gap-2.5">
              {trackingPanel}
              {legendPanel}
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-2">
          {passBanner}
          {compassPanel}
        </div>
      </div>

      {/* Left edge — satellites + tracking + legend (desktop, unchanged) */}
      <div className="pointer-events-none absolute top-0 left-0 z-10 hidden max-h-full w-44 max-w-[38%] flex-col gap-2.5 md:flex">
        <SatellitesPanel
          tles={tles}
          colors={colors}
          telemetry={telemetry}
          selectedId={selectedId}
          onSelect={onSelect}
          listOpen={listOpen}
          onToggleList={toggleList}
        />
        {trackingPanel}
        {legendPanel}
      </div>

      {/* Right edge — detail + compass (desktop, unchanged) */}
      <div className="pointer-events-none absolute top-0 right-0 z-10 hidden max-h-full w-44 max-w-[38%] flex-col items-end gap-2.5 md:flex">
        {telemetryPanel}
        {passBanner}
        {compassPanel}
      </div>
    </div>
  );
}
