import type { AuroraInfo, AuroraLevel } from "@/types";

const KP_FORECAST_URL =
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";

export interface KpForecastRow {
  /** UTC time tag, e.g. "2026-08-11 00:00:00" or "2026-08-11T00:00:00". */
  time: string;
  predictedKp: number;
}

/**
 * Parse the NOAA SWPC planetary K-index forecast. NOAA currently serves rows
 * as objects ({ time_tag, kp, observed, noaa_scale }); the legacy format was
 * an array of [time_tag, predicted_kp, range] tuples. Both are handled.
 */
export function parseKpForecast(json: unknown): KpForecastRow[] {
  if (!Array.isArray(json)) {
    return [];
  }

  const rows: KpForecastRow[] = [];
  for (const row of json) {
    if (Array.isArray(row)) {
      const [time, kp] = row;
      const parsedKp = Number(kp);
      if (
        typeof time === "string" &&
        Number.isFinite(parsedKp) &&
        parsedKp >= 0
      ) {
        rows.push({ time, predictedKp: parsedKp });
      }
      continue;
    }

    if (row !== null && typeof row === "object") {
      const obj = row as Record<string, unknown>;
      const time = obj.time_tag ?? obj.time;
      const kp = obj.kp ?? obj.predicted_kp;
      const parsedKp = Number(kp);
      if (
        typeof time === "string" &&
        Number.isFinite(parsedKp) &&
        parsedKp >= 0
      ) {
        rows.push({ time, predictedKp: parsedKp });
      }
    }
  }
  return rows;
}

export function auroraLevelForKp(kp: number): AuroraLevel {
  if (kp >= 7) {
    return "STORM";
  }
  if (kp >= 5) {
    return "HIGH";
  }
  if (kp >= 4) {
    return "MODERATE";
  }
  return "LOW";
}

export function viewingLatitudeHint(kp: number): string {
  if (kp >= 8) {
    return "Visible as far south as ~45° latitude";
  }
  if (kp >= 7) {
    return "Visible as far south as ~50° latitude";
  }
  if (kp >= 6) {
    return "Visible as far south as ~55° latitude";
  }
  if (kp >= 5) {
    return "Visible as far south as ~60° latitude";
  }
  return "Mainly visible above ~65° latitude";
}

function parseUtcTime(value: string): number {
  return new Date(`${value.replace(" ", "T")}Z`).getTime();
}

/**
 * Reduce the forecast to the next 12 hours — a UTC approximation of "tonight".
 * Returns null when no forecast rows fall inside the window (i.e. no data);
 * a genuinely quiet night still returns a LOW level.
 */
export function computeTonightAurora(
  rows: KpForecastRow[],
  now: Date = new Date(),
): AuroraInfo | null {
  const windowEnd = now.getTime() + 12 * 3600 * 1000;

  let maxKp = 0;
  let hasWindowRows = false;
  for (const row of rows) {
    const t = parseUtcTime(row.time);
    if (Number.isFinite(t) && t >= now.getTime() && t <= windowEnd) {
      hasWindowRows = true;
      maxKp = Math.max(maxKp, row.predictedKp);
    }
  }

  if (!hasWindowRows) {
    return null;
  }

  return {
    maxKpTonight: maxKp,
    level: auroraLevelForKp(maxKp),
    viewingLatitudeHint: viewingLatitudeHint(maxKp),
  };
}

export async function fetchKpForecast(
  fetcher: typeof fetch = fetch,
): Promise<KpForecastRow[]> {
  const response = await fetcher(KP_FORECAST_URL, { next: { revalidate: 1800 } });
  if (!response.ok) {
    throw new Error(`NOAA SWPC returned HTTP ${response.status}`);
  }
  return parseKpForecast(await response.json());
}
