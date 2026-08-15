"use client";

import { BookOpen, CloudSun, MoonStar, Sparkles, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * "How to read this page" explainer — a small trigger tag that opens a modal
 * so the brief stays uncluttered while first-time stargazers get plain-
 * language explanations of the jargon that actually matters: the /10 verdict,
 * Kp, and the "in shadow" rule. Opens centered with a blurred backdrop;
 * closes on Esc, backdrop click, or the X.
 */
export function HowToReadModal() {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Esc to close; focus the close button when the modal opens; lock scroll
  // while it's open so the blurred page behind can't drift.
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-white/25 hover:bg-white/10 hover:text-slate-100"
      >
        <BookOpen className="size-3.5" />
        How to read this page
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="how-to-read-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Blurred, dimmed backdrop — the page stays visible but fades back. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-md"
          />

          <div className="glass relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2
                  id="how-to-read-title"
                  className="text-lg font-bold text-slate-100"
                >
                  How to read this page
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Everything below is computed for your exact spot — no
                  astronomy degree required.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-white/25 hover:text-slate-100"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-5">
              <section>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Sparkles className="size-4 text-emerald-300" />
                  The “X/10 night” verdict
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  One score that sums up the whole night, built from three
                  things: cloud cover, moonlight, and the best satellite pass.
                  7+ is a great night, 4–6 means pick the brightest events, and
                  below that keep expectations low. The sentence under the
                  score names exactly why — read that, not the math.
                </p>
              </section>

              <section>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Zap className="size-4 text-amber-300" />
                  Kp (aurora)
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Kp measures geomagnetic activity on a 0–9 scale — how stirred
                  up Earth&apos;s magnetic field is. It&apos;s the best single
                  aurora predictor: <span className="text-amber-200">4+ means
                  aurora may reach lower latitudes</span>. But it&apos;s a
                  planet-wide number — your local clouds still decide whether
                  you can see it.
                </p>
              </section>

              <section>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <MoonStar className="size-4 text-indigo-300" />
                  The “in shadow” rule
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  A satellite can clear the horizon and still be invisible: if
                  it&apos;s in Earth&apos;s shadow, the sun isn&apos;t on it,
                  so it&apos;s dark. Passes like that are tagged{" "}
                  <span className="text-slate-200">“in shadow”</span> and never
                  get the visible-pass arc on the globe or radar. A{" "}
                  <span className="text-slate-200">visible pass</span> needs
                  two things: above the horizon{" "}
                  <span className="italic">and</span> lit by the sun.
                </p>
              </section>

              <section>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <CloudSun className="size-4 text-sky-300" />
                  Pass rows, quickly
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Each pass shows when it rises, the direction to look, how
                  high it climbs (elevation, in ° — 30° is about a fist and a
                  half above the horizon), how long it lasts, and its{" "}
                  <span className="text-slate-200">magnitude</span> — how
                  bright. Magnitude runs backwards: <span className="text-slate-200">
                  −1 is brighter than +1</span>, and anything below 0 outshines
                  every star.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
