import { TtlCache } from "@/lib/ttl-cache";
import { fetchKpForecast, type KpForecastRow } from "./aurora";
import { fetchTleSet, type TleSet } from "./tle";

/**
 * Cached wrappers around the upstream fetchers. TLEs are valid for hours and
 * the Kp forecast updates slowly, so a short TTL cache removes the bulk of
 * redundant CelesTrak / NOAA traffic without serving stale data. The raw
 * fetcher stays injectable so tests can mock the network.
 */

const TLE_TTL_MS = 4 * 3600 * 1000; // 4h
const KP_TTL_MS = 15 * 60 * 1000; // 15min

const tleCache = new TtlCache<string, TleSet>();
const kpCache = new TtlCache<string, KpForecastRow[]>();

export function clearUpstreamCache(): void {
  tleCache.clear();
  kpCache.clear();
}

export async function getCachedTleSet(
  noradId: string,
  fetcher: typeof fetch = fetch,
): Promise<TleSet> {
  const cached = tleCache.get(noradId);
  if (cached) {
    return cached;
  }
  const fresh = await fetchTleSet(noradId, fetcher);
  tleCache.set(noradId, fresh, TLE_TTL_MS);
  return fresh;
}

export async function getCachedKpForecast(
  fetcher: typeof fetch = fetch,
): Promise<KpForecastRow[]> {
  const cached = kpCache.get("kp-forecast");
  if (cached) {
    return cached;
  }
  const fresh = await fetchKpForecast(fetcher);
  kpCache.set("kp-forecast", fresh, KP_TTL_MS);
  return fresh;
}
