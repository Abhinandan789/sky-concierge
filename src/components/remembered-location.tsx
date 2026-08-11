"use client";

import { useEffect } from "react";

export const LOCATION_STORAGE_KEY = "sky-concierge:location";

/**
 * Restores the visitor's last-used coordinates (saved by LocateButton) when
 * they come back without an explicit ?lat=&lon= in the URL. Renders nothing.
 */
export function RememberedLocation() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("lat") || params.has("lon")) {
      return;
    }
    const saved = window.localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!saved) {
      return;
    }
    try {
      const { lat, lon } = JSON.parse(saved) as {
        lat?: unknown;
        lon?: unknown;
      };
      if (
        typeof lat === "number" &&
        typeof lon === "number" &&
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      ) {
        window.location.replace(
          `/?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}#tonight`,
        );
      }
    } catch {
      // Malformed saved location — ignore and keep the default.
    }
  }, []);

  return null;
}
