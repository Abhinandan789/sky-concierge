import type {
  AuroraInfo,
  CloudSummary,
  ConjunctionEvent,
  IssPass,
  LatLon,
  MoonInfo,
  PlanetEvent,
  ShowerInfo,
  SkyBrief,
  SkyBriefError,
} from "@/types";
import { referenceMagnitude } from "@/config/satellites";
import { computeTonightAurora } from "./aurora";
import {
  getCachedCloudForecast,
  getCachedKpForecast,
  getCachedTleSet,
} from "./cache";
import { summarizeCloudCover } from "./clouds";
import { findSatellitePasses } from "./iss-passes";
import { computeMoonInfo, getTonightBounds } from "./moon";
import { computeMoonConjunctions, computePlanetEvents } from "./planets";
import { computeShowerStatus } from "./showers";

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

/**
 * Resolve the NORAD ids to track: explicit ids win, otherwise the
 * server-configured set (env or ISS). Shared by the brief and the TLE API.
 */
export function resolveNoradIds(explicitIds?: string[]): string[] {
  if (explicitIds && explicitIds.length > 0) {
    return explicitIds;
  }
  return readNoradIds();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Compute the upcoming passes for the selected satellites (used both by the
 * full brief and by the passes panel that lives in the TRACK picker, so the
 * selection and its pass list never disagree). Each satellite is fetched
 * independently so one bad NORAD id (or a transient CelesTrak miss) degrades
 * that satellite only.
 */
export async function computeSatellitePasses(
  location: LatLon,
  options: {
    noradIds?: string[];
    fetcher?: typeof fetch;
    now?: Date;
    windowHours?: number;
  } = {},
): Promise<{ passes: IssPass[]; errors: SkyBriefError[] }> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const all: IssPass[] = [];
  const errors: SkyBriefError[] = [];
  for (const id of resolveNoradIds(options.noradIds)) {
    try {
      const tle = await getCachedTleSet(id, fetcher);
      const passes = findSatellitePasses(tle.line1, tle.line2, location, {
        now,
        windowHours: options.windowHours,
        referenceMagnitude: referenceMagnitude(id),
      });
      all.push(
        ...passes.map((pass) => ({
          ...pass,
          satelliteName: tle.name,
          noradId: id,
        })),
      );
    } catch (error) {
      errors.push({
        section: "iss",
        message: `NORAD ${id}: ${errorMessage(error)}`,
      });
    }
  }
  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { passes: all, errors };
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

  // --- Satellite passes + aurora + clouds, fetched in parallel ---
  let issPasses: IssPass[] = [];
  let aurora: AuroraInfo | null = null;
  let clouds: CloudSummary = { level: "UNKNOWN", average: null, hours: [] };
  const [passResult, auroraRows, cloudResult] = await Promise.allSettled([
    computeSatellitePasses(location, {
      noradIds: options.noradIds,
      fetcher,
      now,
      windowHours: options.windowHours,
    }),
    getCachedKpForecast(fetcher),
    getCachedCloudForecast(location.lat, location.lon, fetcher),
  ]);

  if (passResult.status === "fulfilled") {
    issPasses = passResult.value.passes;
    errors.push(...passResult.value.errors);
  } else {
    errors.push({ section: "iss", message: errorMessage(passResult.reason) });
  }
  if (auroraRows.status === "fulfilled") {
    aurora = computeTonightAurora(auroraRows.value, now);
  } else {
    errors.push({
      section: "aurora",
      message: errorMessage(auroraRows.reason),
    });
  }
  if (cloudResult.status === "fulfilled") {
    const bounds = getTonightBounds(location, now);
    clouds = bounds
      ? summarizeCloudCover(cloudResult.value, bounds.start, bounds.end)
      : { level: "UNKNOWN", average: null, hours: [] };
  } else {
    errors.push({
      section: "clouds",
      message: errorMessage(cloudResult.reason),
    });
  }

  // --- Meteor showers ---
  let showers: ShowerInfo[] = [];
  try {
    showers = computeShowerStatus(now).filter(
      (shower) =>
        Math.abs(shower.daysUntilPeak) <= SHOWER_RELEVANCE_WINDOW_DAYS,
    );
  } catch (error) {
    errors.push({ section: "showers", message: errorMessage(error) });
  }

  // --- Planets & moon-planet conjunctions (all local math) ---
  let planets: PlanetEvent[] = [];
  let conjunctions: ConjunctionEvent[] = [];
  try {
    const bounds = getTonightBounds(location, now);
    if (bounds) {
      planets = computePlanetEvents(location, bounds.start, bounds.end);
      conjunctions = computeMoonConjunctions(
        location,
        bounds.start,
        bounds.end,
      );
    }
  } catch (error) {
    errors.push({ section: "planets", message: errorMessage(error) });
  }

  // --- Moon & viewing window ---
  const moon: MoonInfo = computeMoonInfo(location, now);

  // Collapse per-satellite failures into one entry per section.
  const mergedErrors: SkyBriefError[] = [];
  for (const error of errors) {
    const existing = mergedErrors.find(
      (candidate) => candidate.section === error.section,
    );
    if (existing) {
      existing.message = `${existing.message}; ${error.message}`;
    } else {
      mergedErrors.push({ ...error });
    }
  }

  return {
    location,
    generatedAt: now,
    issPasses,
    aurora,
    showers,
    moon,
    clouds,
    planets,
    conjunctions,
    errors: mergedErrors,
  };
}
