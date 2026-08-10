const CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php";

export interface TleSet {
  name: string;
  line1: string;
  line2: string;
}

/**
 * Fetch the current TLE for a satellite by NORAD catalog number (e.g. 25544
 * for the ISS). CelesTrak returns name + two element lines per object.
 */
export async function fetchTleSet(
  noradId: string,
  fetcher: typeof fetch = fetch,
): Promise<TleSet> {
  const url = `${CELESTRAK_URL}?CATNR=${encodeURIComponent(noradId)}&FORMAT=TLE`;
  const response = await fetcher(url, { next: { revalidate: 3600 } });
  if (!response.ok) {
    throw new Error(`CelesTrak returned HTTP ${response.status}`);
  }

  const text = await response.text();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const name = lines[0] ?? `NORAD ${noradId}`;
  const line1 = lines[1];
  const line2 = lines[2];
  if (!line1 || !line2) {
    throw new Error(`Malformed TLE response for NORAD ${noradId}`);
  }

  return { name, line1, line2 };
}
