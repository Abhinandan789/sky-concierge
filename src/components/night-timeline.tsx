import { MoonStar, Satellite, Sparkles } from "lucide-react";
import { formatTime, timeZoneFor } from "@/lib/utils";
import { findDarkWindows, getTonightBounds } from "@/services/sky/moon";
import type { IssPass, LatLon, MoonInfo, ShowerInfo } from "@/types";

interface NightTimelineProps {
  location: LatLon;
  now: Date;
  moon: MoonInfo;
  passes: IssPass[];
  showers: ShowerInfo[];
}

/**
 * A horizontal night timeline: astronomical night from sunset to sunrise,
 * with the moon's up/down periods, satellite pass markers, moonrise/set
 * ticks and a "now" cursor. Times are rendered in the location's timezone.
 */
export function NightTimeline({
  location,
  now,
  moon,
  passes,
  showers,
}: NightTimelineProps) {
  const bounds = getTonightBounds(location, now);
  const tz = timeZoneFor(location.lat, location.lon);

  if (!bounds) {
    return null; // polar day/night — nothing to draw
  }

  const nightMs = bounds.end.getTime() - bounds.start.getTime();
  if (nightMs <= 0) {
    return null;
  }

  const pct = (date: Date) =>
    Math.max(
      0,
      Math.min(100, ((date.getTime() - bounds.start.getTime()) / nightMs) * 100),
    );

  // Moon-up segments are the complement of the dark windows inside the night.
  const darkWindows = findDarkWindows(location, bounds.start, bounds.end);
  const moonUpSegments: { left: number; width: number }[] = [];
  let cursor = bounds.start.getTime();
  for (const window of darkWindows) {
    if (window.start.getTime() > cursor) {
      moonUpSegments.push({
        left: pct(new Date(cursor)),
        width: pct(window.start) - pct(new Date(cursor)),
      });
    }
    cursor = window.end.getTime();
  }
  if (cursor < bounds.end.getTime()) {
    moonUpSegments.push({
      left: pct(new Date(cursor)),
      width: 100 - pct(new Date(cursor)),
    });
  }

  const tonightPasses = passes.filter(
    (pass) =>
      pass.end.getTime() > bounds.start.getTime() &&
      pass.start.getTime() < bounds.end.getTime(),
  );
  const nowPct = pct(now);
  const peakTonight = showers.find((shower) => shower.isPeakTonight);

  const moonriseInNight =
    moon.moonrise &&
    moon.moonrise.getTime() > bounds.start.getTime() &&
    moon.moonrise.getTime() < bounds.end.getTime()
      ? moon.moonrise
      : null;
  const moonsetInNight =
    moon.moonset &&
    moon.moonset.getTime() > bounds.start.getTime() &&
    moon.moonset.getTime() < bounds.end.getTime()
      ? moon.moonset
      : null;

  const passLabels = tonightPasses.slice(0, 3).map((pass) => ({
    left: pct(pass.start),
    label: `${pass.satelliteName ?? "Satellite"} · ${formatTime(pass.start, tz)}`,
  }));

  return (
    <div className="glass glass-hover rounded-2xl p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-cyan-300">
          <Sparkles className="size-4.5" />
        </span>
        <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">
          Tonight at a glance
        </h3>
      </div>

      {/* Timeline bar */}
      <div className="relative h-16 overflow-hidden rounded-xl border border-white/10 bg-[#04040c]">
        {/* Dark night base */}
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-950/90 via-slate-900 to-indigo-950/90" />
        {/* Moon-up periods */}
        {moonUpSegments.map((segment, index) => (
          <div
            key={index}
            className="absolute inset-y-0 bg-indigo-400/25"
            style={{
              left: `${segment.left}%`,
              width: `${Math.max(segment.width, 0.4)}%`,
            }}
          />
        ))}
        {/* Moonrise / moonset ticks */}
        {moonriseInNight && (
          <div
            className="absolute inset-y-0 w-0.5 bg-indigo-200/90"
            style={{ left: `${pct(moonriseInNight)}%` }}
            title={`Moonrise ${formatTime(moonriseInNight, tz)}`}
          />
        )}
        {moonsetInNight && (
          <div
            className="absolute inset-y-0 w-0.5 bg-indigo-200/60"
            style={{ left: `${pct(moonsetInNight)}%` }}
            title={`Moonset ${formatTime(moonsetInNight, tz)}`}
          />
        )}
        {/* Shower peak tonight */}
        {peakTonight && (
          <div
            className="absolute inset-y-0 w-0.5 bg-fuchsia-400/90"
            style={{ left: "50%" }}
            title={`${peakTonight.name} peaks tonight`}
          />
        )}
        {/* Satellite pass markers */}
        {tonightPasses.slice(0, 6).map((pass, index) => (
          <div
            key={index}
            className="absolute inset-y-0 w-px bg-cyan-400/90"
            style={{ left: `${pct(pass.start)}%` }}
            title={`${pass.satelliteName ?? "Pass"} rises ${formatTime(pass.start, tz)}`}
          />
        ))}
        {/* Now cursor */}
        <div className="absolute inset-y-0 w-px bg-cyan-300" style={{ left: `${nowPct}%` }} />
        <span className="absolute top-1.5 left-1/2 -translate-x-1/2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-cyan-200 uppercase">
          now
        </span>
      </div>

      {/* End labels */}
      <div className="mono mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>dusk {formatTime(bounds.start, tz)}</span>
        <span className="text-cyan-300/70">{formatTime(now, tz)}</span>
        <span>dawn {formatTime(bounds.end, tz)}</span>
      </div>

      {/* Pass labels */}
      {passLabels.length > 0 && (
        <div className="relative mt-1 h-4">
          {passLabels.map((pass, index) => (
            <span
              key={index}
              className="absolute -translate-x-1/2 text-[10px] whitespace-nowrap text-cyan-300/80"
              style={{
                left: `${Math.min(96, Math.max(4, pass.left))}%`,
              }}
            >
              {pass.label}
            </span>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-indigo-400/60" />
          Moon up
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-px bg-cyan-400" />
          <Satellite className="size-3" />
          Pass
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-px bg-indigo-200/80" />
          <MoonStar className="size-3" />
          Moonrise / set
        </span>
        {peakTonight && (
          <span className="inline-flex items-center gap-1.5 text-fuchsia-300/80">
            <span className="inline-block h-2.5 w-px bg-fuchsia-400" />
            {peakTonight.name} peak
          </span>
        )}
      </div>
    </div>
  );
}
