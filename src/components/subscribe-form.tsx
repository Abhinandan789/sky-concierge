"use client";

import { Bell, CheckCircle2, Loader2, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatCoordinates } from "@/lib/utils";
import type { LatLon } from "@/types";

const EVENT_OPTIONS = [
  {
    id: "iss",
    label: "ISS passes",
    description: "When the station flies overhead",
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

export function SubscribeSection({ location }: { location: LatLon }) {
  const [email, setEmail] = useState("");
  const [events, setEvents] = useState<string[]>(["iss", "aurora", "showers"]);
  const [submitting, setSubmitting] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

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
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Couldn't subscribe.");
      }
      setSubscribed(true);
      toast.success("You're on the list!");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't subscribe.",
      );
    } finally {
      setSubmitting(false);
    }
  };

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
          will arrive at <span className="text-slate-200">{email}</span>. The
          email sender is wired up in the next milestone.
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
