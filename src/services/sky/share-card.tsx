import { ImageResponse } from "next/og";
import { satelliteLabel } from "@/config/satellites";
import { DEFAULT_LOCATION } from "@/config/site";
import { parseSatelliteIds } from "@/config/satellites";
import {
  formatCoordinates,
  formatTime,
  parseNumber,
  timeZoneFor,
  validateLatLon,
} from "@/lib/utils";
import type { SkyBrief } from "@/types";
import { buildTonightBrief } from "./brief";
import { buildVerdict, type VerdictTone } from "./verdict";

/**
 * "Tonight's sky" share card — the one image a stargazer sends to friends.
 * Rendered server-side with next/og (satori) at the standard social size
 * 1200×630, and reused as the page's Open Graph image, so a shared link's
 * preview and the downloaded card are always the same picture.
 */

export interface ShareCardParams {
  lat?: string | null;
  lon?: string | null;
  sat?: string | null;
}

export interface ShareCardPass {
  name: string;
  time: string;
  maxElevationDeg: number;
  riseDirection: string;
  magnitude: number | undefined;
}

export interface ShareCardData {
  locationLabel: string;
  dateLabel: string;
  timeZoneLabel: string;
  verdict: ReturnType<typeof buildVerdict>;
  bestPass: ShareCardPass | null;
  moonLine: string;
}

const TONE_COLORS: Record<VerdictTone, string> = {
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
};

const TONE_SOFT: Record<VerdictTone, string> = {
  emerald: "rgba(52, 211, 153, 0.14)",
  amber: "rgba(251, 191, 36, 0.14)",
  rose: "rgba(251, 113, 133, 0.14)",
};

/** Deterministic star field — same card on every render (test-friendly). */
interface Star {
  left: number;
  top: number;
  size: number;
  opacity: number;
  hero: boolean;
}

export function seededStars(count: number): Star[] {
  let seed = 20240817;
  const rand = () => {
    // xorshift32 — tiny, deterministic, no Math.random
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    left: Math.round(rand() * 1000) / 10,
    top: Math.round(rand() * 1000) / 10,
    size: Math.round((1 + rand() * 2.4) * 10) / 10,
    opacity: Math.round((0.3 + rand() * 0.6) * 100) / 100,
    hero: rand() > 0.85,
  }));
}

const STARS = seededStars(34);

/** Date like "Friday, Aug 16" in the location's timezone. */
function dateLabel(now: Date, tz: string): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });
}

/**
 * Compute everything the card needs. Never throws: upstream failures degrade
 * to the local-only parts of the brief (moon, planets) so the card always
 * renders. Passes the same data + verdict logic the page uses.
 */
export async function loadShareCard(
  params: ShareCardParams,
  options: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<ShareCardData> {
  const lat = params.lat ? parseNumber(params.lat) : null;
  const lon = params.lon ? parseNumber(params.lon) : null;
  const hasLocation =
    lat !== null && lon !== null && validateLatLon(lat, lon) === null;
  const location = hasLocation
    ? { lat: lat as number, lon: lon as number }
    : DEFAULT_LOCATION;

  const satelliteIds = parseSatelliteIds(params.sat);
  const noradIds =
    satelliteIds.valid && satelliteIds.ids.length > 0
      ? satelliteIds.ids
      : undefined;

  let brief: SkyBrief;
  try {
    brief = await buildTonightBrief(location, {
      noradIds,
      fetcher: options.fetcher,
      now: options.now,
    });
  } catch {
    // Everything networked failed — the local math (moon, verdict) still works.
    brief = await buildTonightBrief(location, {
      noradIds: [],
      fetcher: options.fetcher,
      now: options.now,
    });
  }

  const tz = timeZoneFor(location.lat, location.lon);
  const verdict = buildVerdict(brief, tz);
  const moon = brief.moon;

  // The best pass a person can actually see — skip shadowed ones.
  const visiblePasses = brief.issPasses.filter((pass) => !pass.shadowed);
  const best =
    visiblePasses.length > 0
      ? visiblePasses.reduce((current, pass) =>
          pass.maxElevationDeg > current.maxElevationDeg ? pass : current,
        visiblePasses[0])
      : null;

  return {
    locationLabel: formatCoordinates(location.lat, location.lon),
    dateLabel: dateLabel(brief.generatedAt, tz),
    timeZoneLabel: tz,
    verdict,
    bestPass: best
      ? {
          name: best.noradId
            ? satelliteLabel(best.noradId)
            : best.satelliteName?.replace(/\s*\(.*\)/, "") ?? "a satellite",
          time: formatTime(best.start, tz),
          maxElevationDeg: best.maxElevationDeg,
          riseDirection: formatCompassDeg(
            best.riseAzimuthDeg ?? best.maxAzimuthDeg,
          ),
          magnitude: best.magnitude,
        }
      : null,
    moonLine: moon.moonDownAllNight
      ? `Moon: ${moon.phaseName} — moonless all night`
      : moon.bestViewingWindow
        ? `Moon: ${moon.phaseName}, ${Math.round(moon.illumination * 100)}% lit · dark from ${formatTime(moon.bestViewingWindow.start, tz)}`
        : `Moon: ${moon.phaseName}, ${Math.round(moon.illumination * 100)}% lit · up most of the night`,
  };
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

function formatCompassDeg(azimuthDeg: number): string {
  const index = Math.round(azimuthDeg / 22.5) % 16;
  return COMPASS_POINTS[index];
}

/** The presentational card — pure JSX, no side effects, easy to snapshot. */
export function ShareCardImage({ data }: { data: ShareCardData }) {
  const { verdict } = data;
  const accent = TONE_COLORS[verdict.tone];

  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        overflow: "hidden",
        padding: "52px 64px",
        background:
          "linear-gradient(178deg, #05060f 0%, #0a0f26 52%, #060818 100%)",
        color: "#e2e8f0",
        fontFamily: "sans-serif",
      }}
    >
      {/* Aurora glows */}
      <div
        style={{
          position: "absolute",
          top: -190,
          left: -130,
          width: 640,
          height: 430,
          background:
            "radial-gradient(circle, rgba(103,232,249,0.30) 0%, rgba(103,232,249,0) 62%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -150,
          right: -110,
          width: 580,
          height: 420,
          background:
            "radial-gradient(circle, rgba(167,139,250,0.24) 0%, rgba(167,139,250,0) 60%)",
        }}
      />

      {/* Stars */}
      {STARS.map((star, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            borderRadius: 999,
            backgroundColor: "#e2e8ff",
            opacity: star.opacity,
            ...(star.hero
              ? { boxShadow: "0 0 14px 2px rgba(226,232,255,0.5)" }
              : {}),
          }}
        />
      ))}

      {/* One faint shooting star */}
      <div
        style={{
          position: "absolute",
          top: "16%",
          left: "72%",
          width: 150,
          height: 2,
          borderRadius: 999,
          background:
            "linear-gradient(90deg, rgba(226,232,255,0.75) 0%, rgba(226,232,255,0) 100%)",
          transform: "rotate(-28deg)",
          opacity: 0.55,
        }}
      />

      {/* ── Top bar ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(103,232,249,0.16)",
              border: "1px solid rgba(103,232,249,0.45)",
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                backgroundColor: "#67e8f9",
                boxShadow: "0 0 10px 1px rgba(103,232,249,0.8)",
              }}
            />
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              color: "#f1f5f9",
            }}
          >
            Sky Concierge
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#cbd5e1",
            }}
          >
            {data.dateLabel}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#64748b",
            }}
          >
            {data.locationLabel}
          </div>
        </div>
      </div>

      {/* ── Verdict panel ───────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 40,
          position: "relative",
          marginTop: 8,
        }}
      >
        {/* Score */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 188,
            height: 188,
            flexShrink: 0,
            borderRadius: 28,
            border: `2px solid ${TONE_COLORS[verdict.tone]}55`,
            backgroundColor: TONE_SOFT[verdict.tone],
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1,
              color: accent,
            }}
          >
            {String(verdict.score)}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#94a3b8",
            }}
          >
            /10 night
          </div>
        </div>

        {/* Headline + sentence */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.12 }}>
            {verdict.headline}
          </div>
          <div
            style={{
              fontSize: 21,
              lineHeight: 1.45,
              color: "#94a3b8",
              maxWidth: 780,
            }}
          >
            {verdict.sentence}
          </div>
        </div>
      </div>

      {/* ── Bottom row ──────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          {data.bestPass ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 20px",
                borderRadius: 14,
                border: "1px solid rgba(103,232,249,0.35)",
                backgroundColor: "rgba(103,232,249,0.08)",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "#67e8f9",
                }}
              >
                Best pass
              </div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  color: "#f1f5f9",
                }}
              >
                {data.bestPass.name}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 15,
                  color: "#94a3b8",
                }}
              >
                {`${data.bestPass.time} · max ${data.bestPass.maxElevationDeg}° · rises ${data.bestPass.riseDirection}${data.bestPass.magnitude !== undefined ? ` · mag ${data.bestPass.magnitude}` : ""}`}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 20px",
                borderRadius: 14,
                border: "1px solid rgba(148,163,184,0.25)",
                backgroundColor: "rgba(148,163,184,0.07)",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "#94a3b8",
                }}
              >
                Best pass
              </div>
              <div
                style={{
                  fontSize: 17,
                  color: "#64748b",
                }}
              >
                No bright passes above 10° in the next two nights
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 20px",
              borderRadius: 14,
              border: "1px solid rgba(129,140,248,0.3)",
              backgroundColor: "rgba(129,140,248,0.08)",
            }}
          >
            <div
              style={{
                fontSize: 16,
                color: "#c7d2fe",
              }}
            >
              {data.moonLine}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(148,163,184,0.16)",
            paddingTop: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 14,
              color: "#64748b",
            }}
          >
            {`All times are local to this location · ${data.timeZoneLabel}`}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: "#475569",
            }}
          >
            Sky Concierge
          </div>
        </div>
      </div>
    </div>
  );
}

/** Render the card as a PNG ImageResponse (used by the API route and OG image). */
export async function renderShareCard(
  params: ShareCardParams,
): Promise<ImageResponse> {
  const data = await loadShareCard(params);
  return new ImageResponse(<ShareCardImage data={data} />, {
    width: 1200,
    height: 630,
  });
}
