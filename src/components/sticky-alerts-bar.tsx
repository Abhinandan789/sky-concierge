"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * A sticky "Get alerts" bar that slides in once the visitor scrolls past the
 * hero — the subscribe form is at the very bottom, so this captures intent
 * without putting a form in the hero (nobody subscribes before seeing value).
 * Bottom safe-area padding keeps the CTA clear of iPhone home indicators.
 */
export function StickyAlertsBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // Show once the hero (90svh) has been mostly scrolled past.
      setVisible(window.scrollY > window.innerHeight * 0.7);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mx-auto max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <a
          href="#alerts"
          className="flex items-center justify-center gap-2 rounded-full border border-cyan-400/40 bg-slate-950/90 px-6 py-3 text-sm font-semibold text-cyan-200 shadow-lg shadow-black/40 backdrop-blur transition hover:border-cyan-300/70 hover:bg-slate-900/95"
        >
          <Bell className="size-4" />
          Get alerts before the next pass
        </a>
      </div>
    </div>
  );
}
