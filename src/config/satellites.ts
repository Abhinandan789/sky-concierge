/**
 * Curated satellite catalog for the tracker picker. NORAD catalog numbers,
 * fetched live from CelesTrak on request (TLEs are TTL-cached server-side).
 */
export interface SatelliteDef {
  noradId: string;
  name: string;
}

export const KNOWN_SATELLITES: SatelliteDef[] = [
  { noradId: "25544", name: "ISS" },
  { noradId: "48274", name: "Tiangong" },
  { noradId: "20580", name: "Hubble" },
  { noradId: "33591", name: "NOAA 19" },
  { noradId: "25994", name: "Terra" },
  { noradId: "27424", name: "Aqua" },
];

/** Most satellites the tracker will compute at once — keeps the brief fast. */
export const MAX_TRACKED_SATELLITES = 4;

const NORAD_ID_PATTERN = /^\d{1,8}$/;

export type SatelliteIdsResult =
  { valid: true; ids: string[] } | { valid: false };

/**
 * Parse a comma-separated NORAD id list (e.g. "25544,48274") from a URL or
 * API query. Empty/missing input is valid and means "use the default set";
 * invalid ids, duplicates and over-long lists are rejected.
 */
export function parseSatelliteIds(raw: unknown): SatelliteIdsResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { valid: true, ids: [] };
  }

  const parts = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { valid: true, ids: [] }; // e.g. ",," — treat as the default set
  }
  if (parts.length > MAX_TRACKED_SATELLITES) {
    return { valid: false };
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of parts) {
    if (!NORAD_ID_PATTERN.test(part)) {
      return { valid: false };
    }
    if (!seen.has(part)) {
      seen.add(part);
      ids.push(part);
    }
  }
  return { valid: true, ids };
}

/** Human-friendly label for a NORAD id, falling back to "NORAD {id}". */
export function satelliteLabel(noradId: string): string {
  return (
    KNOWN_SATELLITES.find((satellite) => satellite.noradId === noradId)?.name ??
    `NORAD ${noradId}`
  );
}
