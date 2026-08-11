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
    (async () => {
      const ids = resolveNoradIds(options.noradIds);
      const all: IssPass[] = [];
      for (const id of ids) {
        const tle = await getCachedTleSet(id, fetcher);
        const passes = findSatellitePasses(tle.line1, tle.line2, location, {
          now,
          windowHours: options.windowHours,
        });
        all.push(
          ...passes.map((pass) => ({ ...pass, satelliteName: tle.name })),
        );
      }
      all.sort((a, b) => a.start.getTime() - b.start.getTime());
      return all;
    })(),
    getCachedKpForecast(fetcher),
    getCachedCloudForecast(location.lat, location.lon, fetcher),
  ]);

  if (passResult.status === "fulfilled") {
    issPasses = passResult.value;
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
    errors,
  };
}
