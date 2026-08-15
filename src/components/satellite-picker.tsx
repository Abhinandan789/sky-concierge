"use client";

import { Plus, Satellite, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  KNOWN_SATELLITES,
  MAX_TRACKED_SATELLITES,
  satelliteLabel,
} from "@/config/satellites";
import { cn } from "@/lib/utils";
import type { LatLon } from "@/types";

interface SatellitePickerProps {
  /** NORAD ids currently in the URL (empty = use the server's default set). */
  selected: string[];
  /** Explicit location from the URL, so navigation preserves it. */
  location: LatLon | null;
  /** The pass list for the selection, rendered inside the panel (server). */
  children?: React.ReactNode;
}

const NORAD_ID_PATTERN = /^\d{1,8}$/;

/**
 * Lets visitors choose which satellites to compute passes for. Selection is
 * stored in the URL (?sat=25544,48274) so the server component re-renders the
 * brief with the requested NORAD ids.
 */
export function SatellitePicker({
  selected,
  location,
  children,
}: SatellitePickerProps) {
  const router = useRouter();
  const [customId, setCustomId] = useState("");

  const customIds = selected.filter(
    (id) => !KNOWN_SATELLITES.some((satellite) => satellite.noradId === id),
  );

  const buildUrl = (ids: string[]) => {
    const params = new URLSearchParams();
    if (location) {
      params.set("lat", String(location.lat));
      params.set("lon", String(location.lon));
    }
    if (ids.length > 0) {
      params.set("sat", ids.join(","));
    }
    const query = params.toString();
    return `/?${query}#tonight`;
  };

  const toggle = (noradId: string) => {
    const next = selected.includes(noradId)
      ? selected.filter((id) => id !== noradId)
      : [...selected, noradId];
    router.push(buildUrl(next));
  };

  const addCustom = (event: React.FormEvent) => {
    event.preventDefault();
    const id = customId.trim();
    if (!NORAD_ID_PATTERN.test(id)) {
      toast.error("Enter a numeric NORAD catalog id (e.g. 25544).");
      return;
    }
    if (selected.includes(id)) {
      toast.info(`${satelliteLabel(id)} is already tracked.`);
      return;
    }
    if (selected.length >= MAX_TRACKED_SATELLITES) {
      toast.error(
        `Up to ${MAX_TRACKED_SATELLITES} satellites at once — remove one first.`,
      );
      return;
    }
    setCustomId("");
    router.push(buildUrl([...selected, id]));
  };

  const removeCustom = (noradId: string) => {
    router.push(buildUrl(selected.filter((id) => id !== noradId)));
  };

  return (
    <div className="glass mb-6 rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-slate-400 uppercase">
          <Satellite className="size-3.5" />
          Track
        </span>

        {/* Default (server-configured) */}
        <button
          type="button"
          onClick={() => router.push(buildUrl([]))}
          aria-pressed={selected.length === 0}
          className={cn(
            "rounded-full border px-3 py-2 text-xs font-medium transition sm:py-1",
            selected.length === 0
              ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200"
              : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25",
          )}
        >
          Default
        </button>

        {/* Preset satellites */}
        {KNOWN_SATELLITES.map((satellite) => {
          const active = selected.includes(satellite.noradId);
          return (
            <button
              key={satellite.noradId}
              type="button"
              onClick={() => toggle(satellite.noradId)}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-3 py-2 text-xs font-medium transition sm:py-1",
                active
                  ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200"
                  : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25",
              )}
            >
              {satellite.name}
            </button>
          );
        })}

        {/* Custom additions */}
        {customIds.map((noradId) => (
          <span
            key={noradId}
            className="inline-flex items-center gap-1 rounded-full border border-indigo-400/40 bg-indigo-400/10 px-3 py-2 text-xs font-medium text-indigo-200 sm:py-1"
          >
            {satelliteLabel(noradId)}
            <button
              type="button"
              onClick={() => removeCustom(noradId)}
              aria-label={`Stop tracking ${satelliteLabel(noradId)}`}
              className="text-indigo-300/70 transition hover:text-indigo-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        {/* Custom id input */}
        <form
          onSubmit={addCustom}
          className="ml-auto flex items-center gap-1.5"
        >
          <input
            type="text"
            value={customId}
            onChange={(event) => setCustomId(event.target.value)}
            placeholder="NORAD id…"
            aria-label="Add satellite by NORAD catalog id"
            className="w-28 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none sm:py-1"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-2 text-xs font-medium text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20 sm:py-1"
          >
            <Plus className="size-3" />
            Add
          </button>
        </form>
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        Pass times are recomputed for the selection — up to{" "}
        {MAX_TRACKED_SATELLITES} at once. Alert emails use the same selection
        when you subscribe below.
      </p>
      {children}
    </div>
  );
}
