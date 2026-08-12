"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export const LOCATION_STORAGE_KEY = "sky-concierge:location";
/** Set just before an auto-locate redirect, so the reloaded page can toast. */
const JUST_LOCATED_KEY = "sky-concierge:just-located";

/** Coordinates as a full-precision URL pair (5 decimals ≈ 1 m). */
export function locationToUrl(lat: number, lon: number): string {
  return `/?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}#tonight`;
}

/**
 * Restores the visitor's last-used coordinates (saved by LocateButton) when
 * they come back without an explicit ?lat=&lon= in the URL. On a true first
 * visit — no URL location and nothing saved — it asks the browser for the
 * exact position once, so the sky is computed for the visitor's real spot
 * instead of the default city. Renders nothing.
 */
export function RememberedLocation() {
  useEffect(() => {
    // Only the home page consumes the remembered location. Email links (the
    // /verify and /unsubscribe pages) must never be redirected away — a saved
    // location would otherwise yank the visitor off their confirmation link
    // before its token is ever applied.
    if (window.location.pathname !== "/") {
      return;
    }

    // A just-completed auto-locate reloaded the page — tell the visitor their
    // exact coordinates are now in use.
    if (sessionStorage.getItem(JUST_LOCATED_KEY)) {
      sessionStorage.removeItem(JUST_LOCATED_KEY);
      toast.success(
        "Location set — everything below is computed for your exact coordinates.",
      );
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has("lat") || params.has("lon")) {
      return;
    }
    const saved = window.localStorage.getItem(LOCATION_STORAGE_KEY);
    if (saved) {
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
          window.location.replace(locationToUrl(lat, lon));
        }
      } catch {
        // Malformed saved location — fall through to the first-visit prompt.
      }
      return;
    }

    // First visit with no location anywhere — ask once, remember the answer.
    if (!("geolocation" in navigator)) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        try {
          window.localStorage.setItem(
            LOCATION_STORAGE_KEY,
            JSON.stringify({ lat: latitude, lon: longitude }),
          );
          sessionStorage.setItem(JUST_LOCATED_KEY, "1");
        } catch {
          // Storage unavailable — the URL still carries the location.
        }
        window.location.replace(locationToUrl(latitude, longitude));
      },
      () => {
        // Denied or unavailable — stay on the default city; the hero button
        // lets them retry on demand.
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  return null;
}
