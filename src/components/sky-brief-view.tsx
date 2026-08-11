import {
  MoonStar,
  Satellite,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import {
  formatCoordinates,
  formatDuration,
  formatTime,
  timeZoneFor,
} from "@/lib/utils";
import { buildTonightBrief } from "@/services/sky/brief";
import type { LatLon } from "@/types";
import { NightTimeline } from "./night-timeline";

const AURORA_BADGES: Record<string, { label: string; className: string }> = {
  LOW: {
    label: "Low",
    className: "border-slate-600/50 bg-slate-500/10 text-slate-400",
  },
  MODERATE: {
    label: "Moderate",
    className: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  },
  HIGH: {
    label: "High",
    className: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  },
  STORM: {
    label: "Storm",
    className: "aurora-glow border-rose-400/40 bg-rose-400/10 text-rose-300",
  },
};

function CardShell({
  icon,
  title,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass glass-hover flex flex-col rounded-2xl p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span
          className={`flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 ${accent}`}
        >
          {icon}
        </span>
        <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">
          {title}
        </h3>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export async function SkyBriefSection({
  location,
  noradIds,
}: {
  location: LatLon;
  /** NORAD ids to track; defaults to the server-configured set. */
  noradIds?: string[];
}) {
  const brief = await buildTonightBrief(location, { noradIds });
  const nextPasses = brief.issPasses.slice(0, 3);
  const moon = brief.moon;
  // All times are rendered in the *location's* timezone, not the server's —
  // a stargazer in Tokyo sees Tokyo time for when to look up.
  const tz = timeZoneFor(location.lat, location.lon);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {/* Satellite passes */}
        <CardShell
          icon={<Satellite className="size-4.5" />}
          title="Satellite Passes"
          accent="text-cyan-300"
        >
          {nextPasses.length === 0 ? (
            <p className="text-sm leading-relaxed text-slate-400">
              No passes above 10° in the next two nights from this spot.
            </p>
          ) : (
            <ul className="space-y-3">
              {nextPasses.map((pass, index) => (
                <li
                  key={index}
                  className="border-b border-white/5 pb-3 last:border-0 last:pb-0"
                >
                  {pass.satelliteName && (
                    <span className="mb-1 block text-[10px] tracking-wide text-slate-500 uppercase">
                      {pass.satelliteName}
                    </span>
                  )}
                  <div className="flex items-baseline gap-2">
                    <span className="mono text-sm font-semibold text-cyan-200">
                      {formatTime(pass.start, tz)}
                    </span>
                    <span className="text-xs text-slate-500">→</span>
                    <span className="mono text-xs text-slate-400">
                      {formatTime(pass.end, tz)}
                    </span>
                    <span className="mono ml-auto shrink-0 text-xs text-slate-500">
                      max {pass.maxElevationDeg}° ·{" "}
                      {formatDuration(pass.durationMinutes)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Look up — the station moves fast and crosses the sky in a few
            minutes. No telescope needed.
          </p>
        </CardShell>

        {/* Aurora */}
        <CardShell
          icon={<Zap className="size-4.5" />}
          title="Aurora"
          accent="text-amber-300"
        >
          {brief.aurora === null ? (
            <p className="text-sm leading-relaxed text-slate-400">
              No aurora forecast available for tonight.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Peak Kp tonight</span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${AURORA_BADGES[brief.aurora.level].className}`}
                >
                  {AURORA_BADGES[brief.aurora.level].label}
                </span>
              </div>

              {/* Kp meter 0-9 */}
              <div>
                <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-500"
                    style={{
                      width: `${Math.min(100, (brief.aurora.maxKpTonight / 9) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mono mt-1.5 flex justify-between text-[10px] text-slate-500">
                  <span>0</span>
                  <span className="text-amber-300/80">
                    Kp {brief.aurora.maxKpTonight.toFixed(1)}
                  </span>
                  <span>9</span>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-slate-400">
                {brief.aurora.viewingLatitudeHint}. Head to a dark spot with a
                clear northern view after midnight.
              </p>
            </div>
          )}
        </CardShell>

        {/* Meteor showers */}
        <CardShell
          icon={<MoonStar className="size-4.5" />}
          title="Meteor Showers"
          accent="text-fuchsia-300"
        >
          {brief.showers.length === 0 ? (
            <p className="text-sm leading-relaxed text-slate-400">
              No major shower activity within the next three weeks.
            </p>
          ) : (
            <ul className="space-y-3">
              {brief.showers.slice(0, 4).map((shower) => (
                <li
                  key={shower.name}
                  className="flex items-center gap-2 border-b border-white/5 pb-3 last:border-0 last:pb-0"
                >
                  <span className="text-sm font-medium text-slate-200">
                    {shower.name}
                  </span>
                  <span className="ml-auto shrink-0 text-right">
                    <span
                      className={`text-xs font-medium ${
                        shower.isPeakTonight
                          ? "text-fuchsia-300"
                          : shower.daysUntilPeak > 0
                            ? "text-slate-400"
                            : "text-slate-500"
                      }`}
                    >
                      {shower.isPeakTonight
                        ? "Peaks tonight ✨"
                        : shower.daysUntilPeak > 0
                          ? `in ${shower.daysUntilPeak} day${shower.daysUntilPeak === 1 ? "" : "s"}`
                          : `passed ${Math.abs(shower.daysUntilPeak)}d ago`}
                    </span>
                    <span className="mono block text-[10px] text-slate-500">
                      ~{shower.zhr}/hr
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Rates are zenithal — real counts depend on moonlight and sky
            quality. Best after midnight.
          </p>
        </CardShell>
      </div>

      {/* Moon & best viewing window */}
      <div className="glass glass-hover rounded-2xl p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-indigo-300">
            <MoonStar className="size-4.5" />
          </span>
          <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">
            Moon &amp; Best Viewing Window
          </h3>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Phase */}
          <div className="flex items-center gap-4">
            <div className="relative size-16 shrink-0">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-slate-100 via-slate-400 to-slate-700 shadow-[0_0_36px_-6px_rgba(226,232,255,0.45)]" />
              <div
                className="absolute inset-0 rounded-full bg-[#0a0a1c]"
                style={{
                  clipPath: moonClip(moon.illumination),
                }}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-100">
                {moon.phaseName}
              </p>
              <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-slate-300 to-indigo-300"
                  style={{ width: `${Math.round(moon.illumination * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {Math.round(moon.illumination * 100)}% illuminated
              </p>
            </div>
          </div>

          {/* Rise / set / dark hours */}
          <div className="grid grid-cols-3 gap-3 self-center text-center">
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] tracking-wide text-slate-500 uppercase">
                Moonrise
              </p>
              <p className="mono mt-1 text-sm text-slate-200">
                {moon.moonrise ? formatTime(moon.moonrise, tz) : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] tracking-wide text-slate-500 uppercase">
                Moonset
              </p>
              <p className="mono mt-1 text-sm text-slate-200">
                {moon.moonset ? formatTime(moon.moonset, tz) : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <p className="text-[10px] tracking-wide text-slate-500 uppercase">
                Dark sky
              </p>
              <p className="mono mt-1 text-sm text-indigo-200">
                ~{moon.darkHours} h
              </p>
            </div>
          </div>

          {/* Best window */}
          <div className="flex flex-col justify-center rounded-xl border border-indigo-400/20 bg-indigo-400/5 p-4">
            <p className="text-[10px] tracking-wide text-indigo-300/80 uppercase">
              Best viewing window
            </p>
            {moon.moonDownAllNight ? (
              <p className="mt-1 text-sm font-medium text-slate-100">
                Moonless night ✨ — dark skies all night
              </p>
            ) : moon.bestViewingWindow ? (
              <p className="mono mt-1 text-lg font-semibold text-indigo-200">
                {formatTime(moon.bestViewingWindow.start, tz)}
                <span className="mx-1 text-xs text-slate-500">→</span>
                {formatTime(moon.bestViewingWindow.end, tz)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-300">
                Moon up all night — go for the brightest events
              </p>
            )}
            {moon.bestViewingWindow && (
              <p className="mt-1 text-xs text-slate-500">
                {formatDuration(
                  (moon.bestViewingWindow.end.getTime() -
                    moon.bestViewingWindow.start.getTime()) /
                    60_000,
                )}{" "}
                of moon-free sky — the dark window between moonset and moonrise.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Night timeline */}
      <NightTimeline
        location={location}
        now={brief.generatedAt}
        moon={moon}
        passes={brief.issPasses}
        showers={brief.showers}
      />

      {/* Section footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span className="mono">
          {formatCoordinates(location.lat, location.lon)} · updated{" "}
          {brief.generatedAt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: tz,
          })}
        </span>
        {brief.errors.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-amber-300/80">
            <TriangleAlert className="size-3.5" />
            {brief.errors.map((error) => error.section).join(", ")} data
            temporarily unavailable
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          Refresh the page to recompute
        </span>
      </div>
    </div>
  );
}

/**
 * Clip-path for the moon disc: the unlit portion as an offset circle.
 * illumination 0 = fully dark disc, 1 = fully lit disc.
 */
function moonClip(illumination: number) {
  if (illumination >= 0.995) {
    return "inset(0 0 0 0)"; // full moon — no overlay
  }
  const offset = 62 - illumination * 52; // px shift of the shadow circle
  return `circle(50% at calc(50% + ${offset.toFixed(1)}px) 50%)`;
}
