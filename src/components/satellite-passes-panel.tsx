import { Satellite } from "lucide-react";
import { satelliteLabel } from "@/config/satellites";
import { formatCompass, formatDuration, formatTime, timeZoneFor } from "@/lib/utils";
import { computeSatellitePasses, resolveNoradIds } from "@/services/sky/brief";
import type { IssPass, LatLon } from "@/types";

/** How many upcoming passes to show per satellite. */
const PASSES_PER_SATELLITE = 2;

/** How easy a pass is to spot, from its peak magnitude. */
function easeInfo(magnitude: number): {
  label: string;
  className: string;
  hint: string;
} {
  if (magnitude <= -1) {
    return {
      label: "very bright",
      className: "border-lime-400/30 bg-lime-400/10 text-lime-300",
      hint: "brighter than any star — unmissable",
    };
  }
  if (magnitude <= 1) {
    return {
      label: "bright",
      className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
      hint: "as bright as the brightest stars",
    };
  }
  if (magnitude <= 3) {
    return {
      label: "faint",
      className: "border-amber-400/30 bg-amber-400/10 text-amber-300",
      hint: "faint — binoculars help",
    };
  }
  return {
    label: "hard",
    className: "border-rose-400/30 bg-rose-400/10 text-rose-300",
    hint: "hard — dark skies and binoculars needed",
  };
}

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

  // The best pass a person can actually see — skip shadowed ones.
  const visiblePasses = passes.filter((pass) => !pass.shadowed);
  const best =
    visiblePasses.length > 0
      ? visiblePasses.reduce((current, pass) =>
          pass.maxElevationDeg > current.maxElevationDeg ? pass : current,
        visiblePasses[0])
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
          {best.magnitude !== undefined && (
            <span
              className="mono shrink-0 rounded border border-cyan-400/20 bg-cyan-400/5 px-1 text-[10px] text-cyan-200/90"
              title={`magnitude ${best.magnitude} — ${easeInfo(best.magnitude).hint}`}
            >
              mag {best.magnitude}
            </span>
          )}
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
                      {pass.shadowed ? (
                        <span
                          className="ml-1.5 rounded border border-slate-500/30 bg-slate-500/10 px-1 text-[9px] text-slate-400"
                          title="The satellite is in Earth's shadow at its peak — it won't be visible even though it's above the horizon."
                        >
                          in shadow
                        </span>
                      ) : (
                        pass.magnitude !== undefined && (
                          <span
                            className={`mono ml-1.5 rounded border px-1 text-[9px] ${easeInfo(pass.magnitude).className}`}
                            title={`magnitude ${pass.magnitude} — ${easeInfo(pass.magnitude).hint}`}
                          >
                            mag {pass.magnitude}
                          </span>
                        )
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
        mag = how bright it appears at its peak — negative is brighter than
        any star. The badge color is how easy it&apos;ll be to spot.
      </p>

      {errors.length > 0 && (
        <p className="mt-2 text-[10px] leading-relaxed text-amber-300/70">
          Some satellites couldn&apos;t be computed right now — the rest above
          are current.
        </p>
      )}
    </div>
  );
}
