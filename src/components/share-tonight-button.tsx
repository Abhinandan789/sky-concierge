"use client";

import { Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * "Share this night" — turns tonight's brief for the current location into a
 * 1200×630 share card (the same image a shared link previews) and hands it to
 * the platform share sheet on phones, or downloads it on desktop. Reads the
 * live URL, so whatever location/satellites the visitor has set is what the
 * card shows.
 */
export function ShareTonightButton() {
  const [busy, setBusy] = useState(false);

  const shareCard = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The URL already carries ?lat=&lon=&sat= when a location is set; a
      // fresh visitor shares the same default city the page shows.
      const imageUrl = `/api/share-card${window.location.search}`;
      const response = await fetch(imageUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`share card request failed (${response.status})`);
      }
      const blob = await response.blob();
      const file = new File([blob], "tonights-sky.png", {
        type: "image/png",
      });

      const shareable = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };

      if (
        typeof shareable.share === "function" &&
        typeof shareable.canShare === "function" &&
        shareable.canShare({ files: [file] })
      ) {
        await shareable.share({
          files: [file],
          title: "Tonight's sky — Sky Concierge",
          text: "Tonight's sky, computed for my location. See yours at Sky Concierge.",
        });
      } else {
        // No share sheet (desktop) — download the card instead.
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "tonights-sky.png";
        link.click();
        URL.revokeObjectURL(objectUrl);
        toast.success(
          "Share card downloaded — send it to your stargazing friends!",
        );
      }
    } catch {
      toast.error("Couldn't create the share card — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={shareCard}
      disabled={busy}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Share2 className="size-3.5" />
      )}
      Share this night
    </button>
  );
}
