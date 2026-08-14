import { Satellite } from "lucide-react";
import { satelliteLabel } from "@/config/satellites";
import { formatCompass, formatDuration, formatTime, timeZoneFor } from "@/lib/utils";
import { computeSatellitePasses, resolveNoradIds } from "@/services/sky/brief";
import type { IssPass, LatLon } from "@/types";

/** How many upcoming passes to show per satellite. */
const PASSES_PER_SATELLITE = 2;

/**
 * The pass list for the satellites selected in the TRACK panel — it lives
 * right where the selection happens, so toggling a satellite immediately
 * shows what it will actually fly over. Every selected satellite gets a
 * row: its next passes, or an honest "no passes" line (a satellite with
 * nothing coming shouldn't silently vanish from the list). Server
 * component: the picker passes it the URL's location + NORAD ids and it
 * recomputes passes for exactly that selection (the same helper the brief
 * uses, so they never disagree).
 */
export async function SatellitePassesPanel({
  location,
  noradIds,
}: {
  location: LatLon;
  noradIds?: string[];
}) {
  const { passes, errors } = await computeSatellitePasses(location, {
    noradIds,
  });
  const tz = timeZoneFor(location.lat, location.lon);

  // Every satellite the user actually selected — passes grouped by NORAD id
  // so a satellite with no upcoming passes still gets a (muted) row.
  const selectedIds = resolveNoradIds(noradIds);
  const byId = new Map<string, IssPass[]>();
  for (const pass of passes) {
    const id = pass.noradId ?? "other";
    const list = byId.get(id);
    if (list) {
      list.push(pass);
    } else {
      byId.set(id, [pass]);
    }
  }
  const groups = selectedIds.map((id) => ({
    id,
    name: satelliteLabel(id),
    passes: (byId.get(id) ?? []).slice(0, PASSES_PER_SATELLITE),
  }));

  const best = passes.length > 0
    ? passes.reduce((current, pass) =>
        pass.maxElevationDeg > current.maxElevationDeg ? pass : current,
      passes[0])
    : null;

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        <Satellite className="size-3" />
        Upcoming passes
      </p>

      {best && (
        <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5">
          <span className="text-[10px] font-semibold tracking-wider text-cyan-300 uppercase">
            Next good pass
          </span>
          <span className="mono ml-auto shrink-0 text-xs font-semibold text-cyan-100">
            {formatTime(best.start, tz)}
          </span>
          <span className="mono shrink-0 text-[10px] text-cyan-300/80">
            {best.maxElevationDeg}° max
          </span>
        </div>
      )}

      <ul className="space-y-2.5">
        {groups.map((group) => (
          <li key={group.id}>
            <p className="mb-1 text-[9px] font-semibold tracking-wide text-slate-500 uppercase">
              {group.name}
            </p>
            {group.passes.length === 0 ? (
              <p className="text-[10px] leading-relaxed text-slate-600">
                No passes above 10° in the next two nights — this one stays
                below your horizon.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {group.passes.map((pass, index) => (
                  <li key={index} className="flex items-baseline gap-2">
                    <span className="mono text-xs font-semibold text-cyan-200">
                      {formatTime(pass.start, tz)}
                    </span>
                    <span className="text-[10px] text-slate-600">→</span>
                    <span className="mono text-[10px] text-slate-400">
                      {formatTime(pass.end, tz)}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-500">
                      rises{" "}
                      <span className="font-medium text-cyan-300/80">
                        {formatCompass(pass.riseAzimuthDeg ?? pass.maxAzimuthDeg)}
                      </span>
                      <span className="text-slate-600"> · </span>
                      <span className="mono">
                        max {pass.maxElevationDeg}° ·{" "}
                        {formatDuration(pass.durationMinutes)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {errors.length > 0 && (
        <p className="mt-2 text-[10px] leading-relaxed text-amber-300/70">
          Some satellites couldn&apos;t be computed right now — the rest above
          are current.
        </p>
      )}
    </div>
  );
}
