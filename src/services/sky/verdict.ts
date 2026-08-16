import { satelliteLabel } from "@/config/satellites";
import { formatTime } from "@/lib/utils";
import type { IssPass, SkyBrief } from "@/types";

export type VerdictTone = "emerald" | "amber" | "rose";

export interface SkyVerdict {
  score: number;
  headline: string;
  sentence: string;
  tone: VerdictTone;
}

/**
 * Synthesize the whole brief into one "is tonight worth it?" verdict — the
 * single answer a stargazer actually wants, assembled from data the brief
 * already computes. Score starts at 7 and moves for clouds, moon wash-out
 * and the best upcoming pass; the sentence names the headline reasons.
 * Shared by the page (Tonight's Brief) and the share card, so the two never
 * disagree about what kind of night it is.
 */
export function buildVerdict(brief: SkyBrief, tz: string): SkyVerdict {
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

  const tone: VerdictTone = score >= 7 ? "emerald" : score >= 5 ? "amber" : "rose";

  return { score, headline, sentence, tone };
}
