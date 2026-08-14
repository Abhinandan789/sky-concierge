import { clsx, type ClassValue } from "clsx";
import tzLookup from "tz-lookup";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * IANA timezone for a coordinate pair (e.g. "America/New_York"). Falls back
 * to UTC for ocean/edge cases where the lookup returns nothing.
 */
export function timeZoneFor(lat: number, lon: number): string {
  try {
    const zone = tzLookup(lat, lon);
    return typeof zone === "string" && zone.length > 0 ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/** Format a Date as HH:MM AM/PM in the given timezone (server-local when omitted). */
export function formatTime(date: Date, timeZone?: string) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  });
}

/** Format a Date as weekday + HH:MM in the given timezone. */
export function formatDayTime(date: Date, timeZone?: string) {
  return date.toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

/** Round minutes to a readable duration like "6 min" or "1 h 2 min". */
export function formatDuration(minutes: number) {
  const rounded = Math.round(minutes);
  if (rounded < 60) {
    return `${rounded} min`;
  }
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Format coordinates like "40.713° N, 74.006° W" (~110 m precision). */
export function formatCoordinates(lat: number, lon: number) {
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}° ${latDir}, ${Math.abs(lon).toFixed(3)}° ${lonDir}`;
}

const COMPASS_POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

/** Convert a compass azimuth in degrees to a direction like "NE". */
export function formatCompass(azimuthDeg: number) {
  const index = Math.round(azimuthDeg / 22.5) % 16;
  return COMPASS_POINTS[index];
}

/**
 * Validate a latitude/longitude pair coming from user input.
 * Returns null when valid, otherwise an error message.
 */
export function validateLatLon(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return "Coordinates must be finite numbers.";
  }
  if (lat < -90 || lat > 90) {
    return "Latitude must be between -90 and 90.";
  }
  if (lon < -180 || lon > 180) {
    return "Longitude must be between -180 and 180.";
  }
  return null;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
