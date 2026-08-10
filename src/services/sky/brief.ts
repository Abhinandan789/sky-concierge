import type {
  AuroraInfo,
  IssPass,
  LatLon,
  ShowerInfo,
  SkyBrief,
  SkyBriefError,
} from "@/types";
import { computeTonightAurora, fetchKpForecast } from "./aurora";
import { findSatellitePasses } from "./iss-passes";
import { computeShowerStatus } from "./showers";
import { fetchTleSet } from "./tle";

const DEFAULT_NORAD_IDS = ["25544"];
const SHOWER_RELEVANCE_WINDOW_DAYS = 21;

export interface BuildBriefOptions {
  fetcher?: typeof fetch;
  now?: Date;
  /** NORAD catalog numbers of satellites to track (defaults to env or ISS). */
  noradIds?: string[];
  windowHours?: number;
}

function readNoradIds(): string[] {
  const raw = process.env.ISS_NORAD_IDS ?? "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : DEFAULT_NORAD_IDS;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Build "tonight's sky" for a location. Each data source is isolated so a
 * single upstream failure degrades gracefully instead of failing the brief.
 */
export async function buildTonightBrief(
  location: LatLon,
  options: BuildBriefOptions = {},
): Promise<SkyBrief> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const errors: SkyBriefError[] = [];

  // --- Satellite passes ---
  let issPasses: IssPass[] = [];
  try {
    const ids = options.noradIds ?? readNoradIds();
    const all: IssPass[] = [];
    for (const id of ids) {
      const tle = await fetchTleSet(id, fetcher);
      all.push(
        ...findSatellitePasses(tle.line1, tle.line2, location, {
          now,
          windowHours: options.windowHours,
        }),
      );
    }
    all.sort((a, b) => a.start.getTime() - b.start.getTime());
    issPasses = all;
  } catch (error) {
    errors.push({ section: "iss", message: errorMessage(error) });
  }

  // --- Aurora ---
  let aurora: AuroraInfo | null = null;
  try {
    const rows = await fetchKpForecast(fetcher);
    aurora = computeTonightAurora(rows, now);
  } catch (error) {
    errors.push({ section: "aurora", message: errorMessage(error) });
  }

  // --- Meteor showers ---
  let showers: ShowerInfo[] = [];
  try {
    showers = computeShowerStatus(now).filter(
      (shower) => Math.abs(shower.daysUntilPeak) <= SHOWER_RELEVANCE_WINDOW_DAYS,
    );
  } catch (error) {
    errors.push({ section: "showers", message: errorMessage(error) });
  }

  return {
    location,
    generatedAt: now,
    issPasses,
    aurora,
    showers,
    errors,
  };
}
