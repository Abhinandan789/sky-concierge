"use client";

import {
  Bell,
  CheckCircle2,
  Info,
  Loader2,
  Mail,
  Plus,
  Satellite,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  KNOWN_SATELLITES,
  MAX_TRACKED_SATELLITES,
  satelliteLabel,
} from "@/config/satellites";
import { formatCoordinates } from "@/lib/utils";
import type { LatLon } from "@/types";

const NORAD_ID_PATTERN = /^\d{1,8}$/;

const EVENT_OPTIONS = [
  {
    id: "iss",
    label: "Satellite passes",
    description: "When the ISS flies overhead",
  },
  {
    id: "aurora",
    label: "Aurora alerts",
    description: "Kp 4+ nights for your latitude",
  },
  {
    id: "showers",
    label: "Meteor showers",
    description: "Upcoming peak nights",
  },
] as const;

export function SubscribeSection({
  location,
  initialSatelliteIds = [],
}: {
  location: LatLon;
  /** NORAD ids chosen in the tracker picker (?sat=…) — carried into alerts. */
  initialSatelliteIds?: string[];
}) {
  const [email, setEmail] = useState("");
  const [events, setEvents] = useState<string[]>(["iss", "aurora", "showers"]);
  const [satelliteIds, setSatelliteIds] =
    useState<string[]>(initialSatelliteIds);
  const [customSatelliteId, setCustomSatelliteId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);

  const customIds = satelliteIds.filter(
    (id) => !KNOWN_SATELLITES.some((satellite) => satellite.noradId === id),
  );

  const toggleSatellite = (noradId: string) => {
    setSatelliteIds((previous) =>
      previous.includes(noradId)
        ? previous.filter((id) => id !== noradId)
        : [...previous, noradId],
    );
  };

  const addSatellite = () => {
    const id = customSatelliteId.trim();
    if (!NORAD_ID_PATTERN.test(id)) {
      toast.error("Enter a numeric NORAD catalog id (e.g. 25544).");
      return;
    }
    if (satelliteIds.includes(id)) {
      toast.info(`${satelliteLabel(id)} is already selected.`);
      return;
    }
    if (satelliteIds.length >= MAX_TRACKED_SATELLITES) {
      toast.error(
        `Up to ${MAX_TRACKED_SATELLITES} satellites at once — remove one first.`,
      );
      return;
    }
    setCustomSatelliteId("");
    setSatelliteIds((previous) => [...previous, id]);
  };

  const toggle = (id: string) => {
    setEvents((previous) =>
      previous.includes(id)
        ? previous.filter((event) => event !== id)
        : [...previous, id],
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!email.trim()) {
      toast.error("Please enter your email address.");
      return;
    }
    if (events.length === 0) {
      toast.error("Pick at least one event type.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          lat: location.lat,
          lon: location.lon,
          events,
          satelliteIds: satelliteIds.length > 0 ? satelliteIds : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Couldn't subscribe.");
      }
      if (body?.data?.verified) {
        setSubscribed(true);
        toast.success("You're on the list!");
      } else {
        setPendingVerification(true);
        toast.success("Confirmation email sent!");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't subscribe.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingVerification) {
    return (
      <div className="glass mx-auto flex max-w-md flex-col items-center rounded-2xl p-10 text-center">
        <Mail className="size-10 text-cyan-300" />
        <h3 className="mt-4 text-lg font-semibold text-slate-100">
          Confirm your email
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          We sent a confirmation link to{" "}
          <span className="text-slate-200">{email}</span>. Alerts start as soon
          as you click it — and you can unsubscribe anytime from any email.
        </p>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-left">
          <Info className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <p className="text-xs leading-relaxed text-amber-200/90">
            Can&apos;t find it? Check your{" "}
            <span className="font-semibold text-amber-100">Spam</span> or{" "}
            <span className="font-semibold text-amber-100">Promotions</span>{" "}
            folder — confirmation emails can land there. Adding the sender to
            your contacts keeps them in your inbox.
          </p>
        </div>
      </div>
    );
  }

  if (subscribed) {
    return (
      <div className="glass mx-auto flex max-w-md flex-col items-center rounded-2xl p-10 text-center">
        <CheckCircle2 className="size-10 text-emerald-300" />
        <h3 className="mt-4 text-lg font-semibold text-slate-100">
          You&apos;re on the list!
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Alerts for{" "}
          {events
            .map(
              (event) =>
                EVENT_OPTIONS.find((option) => option.id === event)?.label,
            )
            .filter(Boolean)
            .join(", ")}{" "}
          will arrive at <span className="text-slate-200">{email}</span>. Every
          email includes a one-click unsubscribe link.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300">
          <Bell className="size-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-slate-100">
            Get the concierge
          </h3>
          <p className="text-sm text-slate-400">
            {formatCoordinates(location.lat, location.lon)} · one email when
            something worth looking at is coming
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-xs font-medium tracking-wide text-slate-400 uppercase"
          >
            Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-500" />
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pr-4 pl-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <span className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-slate-400 uppercase">
            <Satellite className="size-3.5" />
            Satellites to alert about
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {KNOWN_SATELLITES.map((satellite) => {
              const active = satelliteIds.includes(satellite.noradId);
              return (
                <button
                  key={satellite.noradId}
                  type="button"
                  onClick={() => toggleSatellite(satellite.noradId)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition sm:py-1 ${
                    active
                      ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25"
                  }`}
                >
                  {satellite.name}
                </button>
              );
            })}
            {customIds.map((noradId) => (
              <span
                key={noradId}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-400/40 bg-indigo-400/10 px-3 py-2 text-xs font-medium text-indigo-200 sm:py-1"
              >
                {satelliteLabel(noradId)}
                <button
                  type="button"
                  onClick={() => toggleSatellite(noradId)}
                  aria-label={`Remove ${satelliteLabel(noradId)}`}
                  className="text-indigo-300/70 transition hover:text-indigo-100"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <input
                type="text"
                value={customSatelliteId}
                onChange={(event) => setCustomSatelliteId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSatellite();
                  }
                }}
                placeholder="NORAD id…"
                aria-label="Add satellite by NORAD catalog id"
                className="w-28 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none sm:py-1"
              />
              <button
                type="button"
                onClick={addSatellite}
                className="inline-flex items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-2 text-xs font-medium text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20 sm:py-1"
              >
                <Plus className="size-3" />
                Add
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Your selection from the tracker above carries over — leave it empty
            to use the server&apos;s default set.
          </p>
        </div>

        <div>
          <span className="mb-2 block text-xs font-medium tracking-wide text-slate-400 uppercase">
            Events
          </span>
          <div className="grid gap-2 sm:grid-cols-3">
            {EVENT_OPTIONS.map((option) => {
              const active = events.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggle(option.id)}
                  aria-pressed={active}
                  className={`rounded-xl border p-3 text-left transition ${
                    active
                      ? "border-cyan-400/50 bg-cyan-400/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                >
                  <span
                    className={`block text-sm font-semibold ${active ? "text-cyan-200" : "text-slate-300"}`}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Bell className="size-4" />
          )}
          {submitting ? "Subscribing…" : "Subscribe to alerts"}
        </button>
      </form>
    </div>
  );
}
