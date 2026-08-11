"use client";

import { CheckCircle2, Loader2, MoonStar } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type State = "idle" | "working" | "done" | "failed";

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, setState] = useState<State>("idle");
  const [wasFound, setWasFound] = useState(true);
  const [errorText, setErrorText] = useState("");

  const confirm = async () => {
    setState("working");
    try {
      const response = await fetch("/api/subscriptions/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? "Couldn't unsubscribe right now.",
        );
      }
      setWasFound(body?.data?.found !== false);
      setState("done");
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : "Couldn't unsubscribe right now.",
      );
      setState("failed");
    }
  };

  return (
    <main className="mx-auto flex min-h-[80svh] max-w-md flex-col items-center justify-center px-4 text-center">
      {state === "done" && (
        <>
          <MoonStar className="size-12 text-slate-300" />
          <h1 className="mt-5 text-2xl font-bold text-slate-100">
            {wasFound ? "You're unsubscribed" : "You're not subscribed"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            {wasFound
              ? "No more alerts from us — the night sky will keep doing its thing either way. You can resubscribe anytime."
              : "This link doesn't match an active subscription, so there's nothing to turn off."}
          </p>
        </>
      )}

      {state === "failed" && (
        <>
          <MoonStar className="size-12 text-amber-300" />
          <h1 className="mt-5 text-2xl font-bold text-slate-100">
            Something went wrong
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            {errorText}
          </p>
        </>
      )}

      {(state === "idle" || state === "working") && (
        <>
          <MoonStar className="size-12 text-slate-300" />
          <h1 className="mt-5 text-2xl font-bold text-slate-100">
            Unsubscribe from Sky Concierge?
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            You&apos;ll stop receiving satellite, aurora and meteor-shower
            alerts for this location. You can resubscribe anytime.
          </p>
          <button
            type="button"
            onClick={confirm}
            disabled={state === "working"}
            className="mt-8 inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-400/10 px-6 py-3 text-sm font-semibold text-rose-200 transition hover:border-rose-300/70 hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state === "working" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {state === "working" ? "Unsubscribing…" : "Yes, unsubscribe me"}
          </button>
        </>
      )}

      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 text-sm font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20"
      >
        Back to tonight&apos;s sky
      </Link>
    </main>
  );
}
