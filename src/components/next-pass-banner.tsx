"use client";

import { Satellite } from "lucide-react";
import { useEffect, useState } from "react";
import { satelliteLabel } from "@/config/satellites";
import { formatCompass } from "@/lib/utils";
import type { IssPass } from "@/types";

/** Only show the banner once a pass is this close — a calm countdown, not a
 * permanent fixture. */
const IMMINENT_MS = 15 * 60_000;

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Live countdown to the next satellite pass — a fixed banner that appears
 * only when a pass is imminent (≤ 15 min away) or already overhead, flips to
 * "starts now — look WSW" in the final minute, and keeps ticking through the
 * pass. Shadowed passes are skipped: an above-horizon pass in Earth's shadow
 * is invisible, so it can't be "the next good pass". Server-passed data, so
 * it always agrees with the TRACK panel.
 */
export function NextPassBanner({ passes }: { passes: IssPass[] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const next = passes
    .filter((pass) => !pass.shadowed && pass.end.getTime() > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  if (!next) {
    return null;
  }

  const untilStart = next.start.getTime() - now;
  const untilEnd = next.end.getTime() - now;
  const active = untilStart <= 0;
  if (!active && untilStart > IMMINENT_MS) {
    return null;
  }

  const name = next.noradId
    ? satelliteLabel(next.noradId)
    : (next.satelliteName ?? "a satellite");
  const direction = formatCompass(next.riseAzimuthDeg ?? next.maxAzimuthDeg);
  const secondsLeft = Math.round(Math.max(0, untilStart) / 1000);

  return (
    <div className="pointer-events-none fixed top-3 left-1/2 z-50 -translate-x-1/2">
      <div
        className={`glass flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full px-4 py-2 text-xs font-medium shadow-lg ${
          active
            ? "border-cyan-400/50 text-cyan-100"
            : secondsLeft <= 60
              ? "animate-pulse border-lime-400/60 text-lime-200"
              : "border-white/15 text-slate-200"
        }`}
      >
        <Satellite
          className={`size-3.5 shrink-0 ${
            active ? "text-cyan-300" : "text-lime-300"
          }`}
        />
        {active ? (
          <>
            <span className="font-semibold whitespace-nowrap">
              {name} overhead now
            </span>
            <span className="whitespace-nowrap text-slate-400">
              look {direction}
            </span>
            <span className="mono whitespace-nowrap">
              · ends in {formatCountdown(untilEnd)}
            </span>
          </>
        ) : secondsLeft <= 60 ? (
          <>
            <span className="font-semibold whitespace-nowrap">
              {name} starts now
            </span>
            <span className="whitespace-nowrap text-slate-400">
              look {direction}
            </span>
            <span className="mono whitespace-nowrap">
              · in {formatCountdown(untilStart)}
            </span>
          </>
        ) : (
          <>
            <span className="whitespace-nowrap">
              {name} rises in{" "}
              <span className="mono font-semibold">
                {formatCountdown(untilStart)}
              </span>
            </span>
            <span className="whitespace-nowrap text-slate-400">
              look {direction}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
