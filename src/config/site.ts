import type { LatLon } from "@/types";

export const APP_NAME = "Sky Concierge";

export const APP_TAGLINE = "Your night sky, curated.";

export const APP_DESCRIPTION =
  "ISS passes, aurora alerts and meteor showers — predicted for your exact location and delivered before you miss them.";

/**
 * Public base URL used to build verification / unsubscribe links. Defaults to
 * localhost so the app works with zero config; set SITE_URL in production.
 */
export function siteUrl(): string {
  return process.env.SITE_URL ?? "http://localhost:3000";
}

/** Shown when the visitor hasn't shared a location yet. */
export const DEFAULT_LOCATION: LatLon = { lat: 40.7128, lon: -74.006 };

export const DATA_SOURCES = [
  { name: "CelesTrak", href: "https://celestrak.org", note: "Satellite TLEs" },
  {
    name: "NOAA SWPC",
    href: "https://www.swpc.noaa.gov",
    note: "Aurora / Kp forecast",
  },
  {
    name: "NASA",
    href: "https://api.nasa.gov",
    note: "Astronomical data",
  },
];
