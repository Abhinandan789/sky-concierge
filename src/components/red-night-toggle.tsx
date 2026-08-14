"use client";

import { MoonStar } from "lucide-react";
import { useEffect, useRef } from "react";

const STORAGE_KEY = "sky-concierge:red-night";

function syncButtonState(el: HTMLButtonElement, on: boolean) {
  el.setAttribute("aria-pressed", String(on));
  el.title = on
    ? "Red-light mode on — turn off to see the normal palette"
    : "Red-light mode — keeps your night vision (dark adaptation)";
}

/**
 * Red-light night mode toggle — the astronomy-app staple that preserves
 * dark adaptation. Toggling applies `html.red-night` (a sepia/hue-rotate
 * filter mapping the whole palette to reds) and remembers the choice across
 * reloads (the root layout restores it before first paint). Stateless: the
 * `html.red-night` filter recolors the button itself when the mode is on, so
 * the button never needs to mirror the mode in React state. A small floating
 * button so it never crowds the layout.
 */
export function RedNightToggle() {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The root layout restores the mode before first paint — reflect that in
  // the button's accessibility state once mounted (DOM attributes only, no
  // React state, so this never cascades a re-render).
  useEffect(() => {
    if (buttonRef.current) {
      syncButtonState(
        buttonRef.current,
        document.documentElement.classList.contains("red-night"),
      );
    }
  }, []);

  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const next = !root.classList.contains("red-night");
    root.classList.toggle("red-night", next);
    syncButtonState(event.currentTarget, next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Private mode etc. — the mode still applies for this session.
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      aria-pressed="false"
      aria-label="Red-light night mode"
      title="Red-light mode — keeps your night vision (dark adaptation)"
      className="fixed right-4 bottom-4 z-40 flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 backdrop-blur transition hover:border-white/25 hover:text-slate-200"
    >
      <MoonStar className="size-4" />
    </button>
  );
}
