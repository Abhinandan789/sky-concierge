import { CloudSun,
  MoonStar,
  Orbit,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { satelliteLabel } from "@/config/satellites";
import {
  formatCoordinates,
  formatDuration,
  formatTime,
  timeZoneFor,
} from "@/lib/utils";
import { buildTonightBrief } from "@/services/sky/brief";
import type { IssPass, LatLon, SkyBrief } from "@/types";
import { NextPassBanner } from "./next-pass-banner";
import { NightTimeline } from "./night-timeline";

/**
 * Synthesize the whole brief into one "is tonight worth it?" verdict — the
 * single answer a stargazer actually wants, assembled from data the brief
 * already computes. Score starts at 7 and moves for clouds, moon wash-out
 * and the best upcoming pass; the sentence names the headline reasons.
 */
function buildVerdict(
  brief: SkyBrief,
  tz: string,
): { score: number; headline: string; sentence: string; tone: "emerald" | "amber" | "rose" } {
  let score = 7;
  const parts: string[] = [];

  const clouds = brief.clouds;
  if (clouds.level === "CLEAR") {
    parts.push("clear skies");
  } else if (clouds.level === "PARTLY_CLOUDY") {
    parts.push("partly cloudy");
    score -= 1;
  } else if (clouds.level === "CLOUDY") {
    parts.push("cloud cover expected");
    score -= 4;
  } else {
    parts.push("sky cover unknown");
    score -= 1;
  }

  const moon = brief.moon;
  if (moon.moonDownAllNight) {
    parts.push("moonless all night");
  } else if (moon.bestViewingWindow) {
    parts.push(`moon down by ${formatTime(moon.bestViewingWindow.start, tz)}`);
    if (moon.illumination > 0.6) {
      score -= 1;
    }
  } else {
    parts.push("moon up most of the night");
    score -= 2;
  }

  let bestPass: IssPass | null = null;
  for (const pass of brief.issPasses) {
    if (!bestPass || pass.maxElevationDeg > bestPass.maxElevationDeg) {
      bestPass = pass;
    }
  }
  if (bestPass) {
    // Friendly pill name when the pass knows its NORAD id (e.g. "Tiangong"),
    // else the TLE name stripped of its parenthetical ("CSS (TIANHE)" → "CSS").
    const name = bestPass.noradId
      ? satelliteLabel(bestPass.noradId)
      : bestPass.satelliteName?.replace(/\s*\(.*\)/, "") ?? "a satellite";
    parts.push(
      `${name} at ${formatTime(bestPass.start, tz)} (${bestPass.maxElevationDeg}°)`,
    );
    if (bestPass.maxElevationDeg >= 60) {
      score += 1;
    } else if (bestPass.maxElevationDeg < 30) {
      score -= 1;
    }
  } else {
    parts.push("no good passes tonight");
    score -= 1;
  }

  score = Math.max(1, Math.min(10, score));

  const headline =
    score >= 8
      ? "A great night to look up"
      : score >= 6
        ? "A good night to look up"
        : score >= 4
          ? "A fair night — pick the brightest events"
          : "A tough night — keep expectations low";

  let sentence = parts.join(" · ");
  if (clouds.level === "CLOUDY") {
    sentence += " — gaps may open for the brightest events";
  }

  const tone =
    score >= 7 ? "emerald" : score >= 5 ? "amber" : "rose";

  return { score, headline, sentence, tone };
}

const VERDICT_TONE_STYLES = {
  emerald: "border-emerald-400/25 bg-emerald-400/10",
  amber: "border-amber-400/25 bg-amber-400/10",
  rose: "border-rose-400/25 bg-rose-400/10",
} as const;

const VERDICT_SCORE_STYLES = {
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  rose: "text-rose-300",
} as const;

const CLOUD_BADGES: Record<string, { label: string; className: string }> = {
  CLEAR: {
    label: "Clear",
    className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  },
  PARTLY_CLOUDY: {
    label: "Partly cloudy",
    className: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  },
  CLOUDY: {
    label: "Cloudy",
    className: "border-slate-400/40 bg-slate-400/10 text-slate-300",
  },
  UNKNOWN: {
    label: "Unknown",
    className: "border-slate-600/50 bg-slate-500/10 text-slate-400",
  },
};

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
  children,
  picker,
}: {
  location: LatLon;
  /** NORAD ids to track; defaults to the server-configured set. */
  noradIds?: string[];
  /** Slot rendered right after the at-a-glance summary (the live tracker). */
  children?: React.ReactNode;
  /** The satellite TRACK picker — rendered after the verdict, so the answer
   * comes before the tools. */
  picker?: React.ReactNode;
}) {
  const brief = await buildTonightBrief(location, { noradIds });
  const moon = brief.moon;
  // All times are rendered in the *location's* timezone, not the server's —
  // a stargazer in Tokyo sees Tokyo time for when to look up.
  const tz = timeZoneFor(location.lat, location.lon);

  const verdict = buildVerdict(brief, tz);

  return (
    <div className="space-y-4">
      {/* Live countdown to the next pass — appears only when imminent. */}
      <NextPassBanner passes={brief.issPasses} />

      {/* Tonight's verdict — the one-line answer before any detail. */}
      <div
        className={`flex items-center gap-4 rounded-2xl border p-4 ${VERDICT_TONE_STYLES[verdict.tone]}`}
      >
        <div className="flex shrink-0 flex-col items-center leading-none">
          <span
            className={`mono text-3xl font-bold ${VERDICT_SCORE_STYLES[verdict.tone]}`}
          >
            {verdict.score}
          </span>
          <span className="mt-1 text-[9px] tracking-wider text-slate-400 uppercase">
            /10 night
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100">
            {verdict.headline}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            {verdict.sentence}
          </p>
        </div>
      </div>

      {/* The TRACK picker follows the verdict — configuring satellites is a
          tool, not the first thing a visitor should meet. */}
      {picker}

      {/* The at-a-glance summary comes first — one strip that tells the
          whole night, then the live tracker, then the detailed cards. */}
      <NightTimeline
        location={location}
        now={brief.generatedAt}
        moon={moon}
        passes={brief.issPasses}
        showers={brief.showers}
        clouds={brief.clouds}
      />

      {children}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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

        {/* Sky conditions (cloud cover tonight) */}
        <CardShell
          icon={<CloudSun className="size-4.5" />}
          title="Sky Conditions"
          accent="text-sky-300"
        >
          {brief.clouds.level === "UNKNOWN" ? (
            <p className="text-sm leading-relaxed text-slate-400">
              No cloud forecast available for tonight.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Tonight</span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CLOUD_BADGES[brief.clouds.level].className}`}
                >
                  {CLOUD_BADGES[brief.clouds.level].label}
                </span>
              </div>

              {/* Cloud-cover meter 0-100% */}
              <div>
                <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-slate-300"
                    style={{
                      width: `${Math.min(100, brief.clouds.average ?? 0)}%`,
                    }}
                  />
                </div>
                <div className="mono mt-1.5 flex justify-between text-[10px] text-slate-500">
                  <span>clear</span>
                  <span className="text-sky-300/80">
                    {brief.clouds.average}% cover
                  </span>
                  <span>solid</span>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-slate-400">
                {brief.clouds.level === "CLEAR"
                  ? "Great transparency — a good night to be outside."
                  : brief.clouds.level === "CLOUDY"
                    ? "Thick cloud cover expected — passes and meteors may be hidden."
                    : "Partly cloudy — keep an eye on gaps for the brightest events."}
              </p>
            </div>
          )}
        </CardShell>

        {/* Aurora — kept last: low-value on most nights, so it stops
            crowding the first screen. */}
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
              <p className="text-[11px] leading-relaxed text-slate-500">
                Kp measures geomagnetic activity; 4+ means aurora may be
                visible at lower latitudes.
              </p>
            </div>
          )}
        </CardShell>
      </div>

      {/* Planets tonight */}
      <div className="glass glass-hover rounded-2xl p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-amber-300">
            <Orbit className="size-4.5" />
          </span>
          <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">
            Planets Tonight
          </h3>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {brief.planets.map((planet) => (
            <div
              key={planet.name}
              className="rounded-xl border border-white/5 bg-white/[0.03] p-4"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-slate-100">
                  {planet.name}
                </span>
                {planet.visible && planet.magnitude !== null && (
                  <span className="mono text-xs text-amber-200/90">
                    mag {planet.magnitude.toFixed(1)}
                  </span>
                )}
              </div>
              {planet.visible ? (
                <div className="mt-3 space-y-1 text-xs text-slate-400">
                  <p>
                    <span className="text-slate-200">
                      Peaks {planet.maxAltitudeDeg}°
                    </span>{" "}
                    in the {planet.direction}
                    {planet.bestTime
                      ? ` at ${formatTime(planet.bestTime, tz)}`
                      : ""}
                  </p>
                  <p className="text-slate-500">
                    {planet.riseTime
                      ? `Rises ${formatTime(planet.riseTime, tz)}`
                      : "Already up when dusk falls"}
                    {planet.setTime
                      ? ` · sets ${formatTime(planet.setTime, tz)}`
                      : " · up past dawn"}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  Not visible tonight from this spot.
                </p>
              )}
            </div>
          ))}
        </div>

        {brief.conjunctions.length > 0 && (
          <div className="mt-4 rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/5 p-4">
            <p className="text-[10px] tracking-wide text-fuchsia-300/80 uppercase">
              Moon meets planet
            </p>
            <ul className="mt-2 space-y-1">
              {brief.conjunctions.map((conjunction) => (
                <li key={conjunction.planet} className="text-sm text-slate-300">
                  The Moon passes{" "}
                  <span className="font-medium text-slate-100">
                    {conjunction.planet}
                  </span>{" "}
                  at {formatTime(conjunction.time, tz)} — only{" "}
                  <span className="mono font-medium text-fuchsia-300">
                    {conjunction.separationDeg}°
                  </span>{" "}
                  apart. Unmissable.
                </li>
              ))}
            </ul>
          </div>
        )}
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

      {/* Section footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span className="mono">
          {formatCoordinates(location.lat, location.lon)} · updated{" "}
          {formatTime(brief.generatedAt, tz)}
          <span className="ml-1 text-slate-600">
            · all times are local to this location
          </span>
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
