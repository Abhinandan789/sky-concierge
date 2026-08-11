"use client";

import { CheckCircle2, Loader2, MailQuestion } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type State = "idle" | "working" | "confirmed" | "failed";

export function VerifyForm({ token }: { token: string }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  const confirm = async () => {
    setState("working");
    try {
      const response = await fetch("/api/subscriptions/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? "That confirmation link didn't work.",
        );
      }
      setState("confirmed");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That confirmation link didn't work.",
      );
      setState("failed");
    }
  };

  return (
    <main className="mx-auto flex min-h-[80svh] max-w-md flex-col items-center justify-center px-4 text-center">
      {state === "confirmed" && (
        <>
          <CheckCircle2 className="size-12 text-emerald-300" />
          <h1 className="mt-5 text-2xl font-bold text-slate-100">
            You&apos;re confirmed!
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Your alerts are now active. Sit back — we&apos;ll email you when
            something worth looking at is coming your way.
          </p>
        </>
      )}

      {state === "failed" && (
        <>
          <MailQuestion className="size-12 text-amber-300" />
          <h1 className="mt-5 text-2xl font-bold text-slate-100">
            That link didn&apos;t work
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">{error}</p>
        </>
      )}

      {(state === "idle" || state === "working") && (
        <>
          <CheckCircle2 className="size-12 text-cyan-300" />
          <h1 className="mt-5 text-2xl font-bold text-slate-100">
            Confirm your subscription
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            One last step — click the button below to confirm your email and
            start receiving Sky Concierge alerts.
          </p>
          <button
            type="button"
            onClick={confirm}
            disabled={state === "working"}
            className="mt-8 inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 text-sm font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state === "working" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {state === "working" ? "Confirming…" : "Confirm my subscription"}
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
