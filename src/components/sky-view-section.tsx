"use client";

import dynamic from "next/dynamic";
import { Globe2, Loader2, Radar } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LatLon } from "@/types";
import { SatelliteMap } from "./satellite-map";

// The three.js globe is ~150 KB gzipped — load it only when the user asks.
const SatelliteGlobe = dynamic(
  () => import("./satellite-globe").then((module) => module.SatelliteGlobe),
  {
    ssr: false,
    loading: () => (
      <div className="glass flex aspect-[2/1] items-center justify-center gap-2 rounded-2xl text-sm text-slate-500">
        <Loader2 className="size-5 animate-spin" />
        Loading the 3D globe…
      </div>
    ),
  },
);

type View = "radar" | "globe";

const VIEWS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "radar", label: "Radar", icon: <Radar className="size-3.5" /> },
  { id: "globe", label: "3D globe", icon: <Globe2 className="size-3.5" /> },
];

/**
 * "See what's overhead right now" — a toggle between the 2D ground-track
 * radar (default) and the 3D globe with real Earth rotation.
 */
export function SkyViewSection({
  location,
  selectedIds,
}: {
  location: LatLon;
  selectedIds: string[];
}) {
  const [view, setView] = useState<View>("radar");

  return (
    <div>
      <div className="mb-4 flex justify-center">
        <div className="glass inline-flex rounded-full p-1">
          {VIEWS.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition",
                view === id
                  ? "bg-cyan-400/15 text-cyan-200"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "radar" ? (
        <SatelliteMap location={location} selectedIds={selectedIds} />
      ) : (
        <SatelliteGlobe location={location} selectedIds={selectedIds} />
      )}
    </div>
  );
}
