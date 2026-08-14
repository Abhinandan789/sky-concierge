"use client";

import { ChevronDown, ChevronUp, LocateFixed, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { formatCoordinates, validateLatLon } from "@/lib/utils";
import {
  LOCATION_STORAGE_KEY,
  locationToUrl,
} from "./remembered-location";

/**
 * Manual lat/lon entry — the fallback when geolocation is denied, unavailable,
 * or just wrong. Collapsed by default to a single "showing … · Change" line so
 * the hero stays clean; expanding reveals the inputs. Applies instantly and
 * remembers the spot like the locate button does.
 */
export function LocationInput({
  defaultLat,
  defaultLon,
}: {
  defaultLat: number;
  defaultLon: number;
}) {
  const router = useRouter();
  const [lat, setLat] = useState(String(defaultLat));
  const [lon, setLon] = useState(String(defaultLon));
  const [open, setOpen] = useState(false);

  const apply = () => {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    const error = validateLatLon(parsedLat, parsedLon);
    if (error) {
      toast.error(error);
      return;
    }
    try {
      window.localStorage.setItem(
        LOCATION_STORAGE_KEY,
        JSON.stringify({ lat: parsedLat, lon: parsedLon }),
      );
    } catch {
      // Storage unavailable — the URL still carries the location.
    }
    router.push(locationToUrl(parsedLat, parsedLon));
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Collapsed summary line — the default state */}
      <div className="flex items-center gap-2">
        <span className="mono inline-flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="size-3.5 text-slate-600" />
          showing {formatCoordinates(defaultLat, defaultLon)}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-white/30 hover:bg-white/10"
        >
          {open ? (
            <>
              Done <ChevronUp className="size-3" />
            </>
          ) : (
            <>
              Change <ChevronDown className="size-3" />
            </>
          )}
        </button>
      </div>

      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
          className="flex items-center justify-center gap-2"
        >
          <label className="flex items-center gap-1 text-[10px] text-slate-500 uppercase">
            Lat
            <input
              type="number"
              step="0.0001"
              min={-90}
              max={90}
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              className="mono w-24 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400/50"
              aria-label="Latitude"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-slate-500 uppercase">
            Lon
            <input
              type="number"
              step="0.0001"
              min={-180}
              max={180}
              value={lon}
              onChange={(event) => setLon(event.target.value)}
              className="mono w-24 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400/50"
              aria-label="Longitude"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20"
          >
            <LocateFixed className="size-3.5" />
            Set location
          </button>
        </form>
      )}
    </div>
  );
}
