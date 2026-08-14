import type { Metadata } from "next";
import { MoonStar, Satellite } from "lucide-react";
import { Suspense } from "react";
import { LocateButton } from "@/components/locate-button";
import { PushNotifications } from "@/components/push-notifications";
import { SatellitePicker } from "@/components/satellite-picker";
import { LocationInput } from "@/components/location-input";
import { SkyViewSection } from "@/components/sky-view-section";
import { SkyBriefSection } from "@/components/sky-brief-view";
import { SatellitePassesPanel } from "@/components/satellite-passes-panel";
import { StickyAlertsBar } from "@/components/sticky-alerts-bar";
import { SubscribeSection } from "@/components/subscribe-form";
import { parseSatelliteIds } from "@/config/satellites";
import { APP_DESCRIPTION, DATA_SOURCES, DEFAULT_LOCATION } from "@/config/site";
import { parseNumber, validateLatLon } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Tonight's Sky",
  description: APP_DESCRIPTION,
};

function BriefSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((index) => (
        <div key={index} className="glass h-64 animate-pulse rounded-2xl" />
      ))}
    </div>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    lat?: string;
    lon?: string;
    sat?: string;
    view?: string;
    focus?: string;
  }>;
}) {
  const params = await searchParams;
  const requestedLat = parseNumber(params.lat);
  const requestedLon = parseNumber(params.lon);
  const hasLocation =
    requestedLat !== null &&
    requestedLon !== null &&
    validateLatLon(requestedLat, requestedLon) === null;
  const location = hasLocation
    ? { lat: requestedLat, lon: requestedLon }
    : DEFAULT_LOCATION;

  // Optional ?sat=25544,48274 — invalid input falls back to the default set.
  const satelliteIds = parseSatelliteIds(params.sat);
  const selectedSatelliteIds =
    satelliteIds.valid && satelliteIds.ids.length > 0 ? satelliteIds.ids : [];
  const noradIds =
    selectedSatelliteIds.length > 0 ? selectedSatelliteIds : undefined;

  // Optional ?view=globe and ?focus=<norad> — restored into the tracker so a
  // page refresh (or a shared link) lands on the same view and satellite.
  const initialView = params.view === "globe" ? "globe" : "radar";
  const initialFocus =
    params.focus && /^\d+$/.test(params.focus) ? params.focus : null;

  return (
    <main className="relative">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="mx-auto flex min-h-[90svh] max-w-4xl flex-col items-center justify-center px-4 text-center">
        <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide text-cyan-200 uppercase">
          <MoonStar className="size-3.5" />
          Tonight&apos;s sky, curated
        </span>

        <h1 className="mt-6 max-w-3xl text-4xl leading-tight font-extrabold tracking-tight text-balance sm:text-6xl">
          <span className="text-gradient">
            Never miss a light in the sky again.
          </span>
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
          ISS passes, aurora alerts and meteor showers — computed for your exact
          coordinates and delivered before they happen.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <LocateButton />
          <a
            href="#tonight"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/10"
          >
            <Satellite className="size-4" />
            See tonight&apos;s sky
          </a>
        </div>

        <div className="mt-6">
          <LocationInput
            defaultLat={location.lat}
            defaultLon={location.lon}
          />
        </div>
      </section>

      {/* ── Tonight's brief ──────────────────────────────────── */}
      <section
        id="tonight"
        className="mx-auto max-w-5xl scroll-mt-8 px-4 pb-24"
      >
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-100">
              Tonight&apos;s Brief
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Everything worth looking at, computed from live orbital and space
              weather data.
            </p>
          </div>
        </div>

        <SatellitePicker
          selected={selectedSatelliteIds}
          location={hasLocation ? location : null}
        >
          {/* The pass list for the selection lives right where the user
              picks satellites — the two always describe the same set. */}
          <Suspense
            fallback={
              <div className="mt-3 h-24 animate-pulse rounded-xl border-t border-white/5 bg-white/[0.02]" />
            }
          >
            <SatellitePassesPanel
              location={location}
              noradIds={noradIds}
            />
          </Suspense>
        </SatellitePicker>

        <Suspense fallback={<BriefSkeleton />}>
          <SkyBriefSection location={location} noradIds={noradIds}>
            {/* The live tracker sits right after the at-a-glance summary —
                the visual payoff before the dense cards. */}
            <div
              id="radar"
              className="scroll-mt-8"
            >
              <h2 className="mb-6 text-center text-2xl font-bold text-slate-100">
                See what&apos;s overhead right now
              </h2>
              <SkyViewSection
                location={location}
                selectedIds={selectedSatelliteIds}
                initialView={initialView}
                initialFocus={initialFocus}
              />
            </div>
          </SkyBriefSection>
        </Suspense>
      </section>

      {/* ── Subscribe ────────────────────────────────────────── */}
      <section id="alerts" className="mx-auto max-w-3xl scroll-mt-8 px-4 pb-24">
        <h2 className="mb-6 text-center text-2xl font-bold text-slate-100">
          Let the sky come to you
        </h2>
        <SubscribeSection
          location={location}
          initialSatelliteIds={selectedSatelliteIds}
        />
        <PushNotifications location={location} />
      </section>

      {/* ── Sticky "Get alerts" bar — appears after the hero ── */}
      <StickyAlertsBar />

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 text-center">
          <p className="text-xs text-slate-500">
            Data:{" "}
            {DATA_SOURCES.map((source, index) => (
              <span key={source.name}>
                <a
                  href={source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 underline-offset-2 hover:text-cyan-300 hover:underline"
                >
                  {source.name}
                </a>
                {source.note ? ` (${source.note})` : ""}
                {index < DATA_SOURCES.length - 1 ? " · " : ""}
              </span>
            ))}
          </p>
          <p className="text-xs text-slate-600">
            Sky Concierge — built for stargazers, one location at a time.
          </p>
        </div>
      </footer>
    </main>
  );
}
