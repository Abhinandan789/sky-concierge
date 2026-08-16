"use client";

import { Download, Loader2, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Variant = "landscape" | "square";

interface CardVariant {
  file: File;
  url: string;
}

/**
 * "Share this night" — opens a preview modal of the tonight's-sky share card
 * (landscape for feeds + square for statuses) with Share and Download
 * actions, so the visitor sees exactly what they're sending before it goes
 * out. The images come from /api/share-card — the same renderer that backs
 * the page's Open Graph preview, so what you see is what gets shared.
 */
export function ShareTonightButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Variant>("landscape");
  const [landscape, setLandscape] = useState<CardVariant | null>(null);
  const [square, setSquare] = useState<CardVariant | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const urlsRef = useRef<string[]>([]);

  // Revoke preview URLs on unmount so SPA navigations don't leak them.
  useEffect(
    () => () => {
      for (const url of urlsRef.current) {
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  // Esc to close; focus the close button; lock scroll while open.
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

  const close = () => {
    setOpen(false);
    for (const url of urlsRef.current) {
      URL.revokeObjectURL(url);
    }
    urlsRef.current = [];
    setLandscape(null);
    setSquare(null);
  };

  const openModal = async () => {
    setOpen(true);
    if (landscape && square) return; // already loaded
    setLoading(true);
    try {
      // The URL already carries ?lat=&lon=&sat= when a location is set; a
      // fresh visitor shares the same default city the page shows.
      const search = window.location.search;
      const [landscapeResponse, squareResponse] = await Promise.all([
        fetch(`/api/share-card${search}`, { cache: "no-store" }),
        fetch(
          `/api/share-card${search}${search ? "&" : "?"}shape=square`,
          { cache: "no-store" },
        ),
      ]);
      if (!landscapeResponse.ok || !squareResponse.ok) {
        throw new Error("share card request failed");
      }
      const [landscapeBlob, squareBlob] = await Promise.all([
        landscapeResponse.blob(),
        squareResponse.blob(),
      ]);
      const landscapeUrl = URL.createObjectURL(landscapeBlob);
      const squareUrl = URL.createObjectURL(squareBlob);
      urlsRef.current = [landscapeUrl, squareUrl];
      setLandscape({
        file: new File([landscapeBlob], "tonights-sky.png", {
          type: "image/png",
        }),
        url: landscapeUrl,
      });
      setSquare({
        file: new File([squareBlob], "tonights-sky-square.png", {
          type: "image/png",
        }),
        url: squareUrl,
      });
    } catch {
      toast.error("Couldn't create the share card — try again in a moment.");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const download = (variant: CardVariant) => {
    const link = document.createElement("a");
    link.href = variant.url;
    link.download = variant.file.name;
    link.click();
    toast.success("Share card downloaded — send it to your stargazing friends!");
  };

  const share = async () => {
    if (!landscape || !square || busy) return;
    setBusy(true);
    try {
      const shareable = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      if (
        typeof shareable.share === "function" &&
        typeof shareable.canShare === "function" &&
        shareable.canShare({ files: [landscape.file, square.file] })
      ) {
        await shareable.share({
          files: [landscape.file, square.file],
          title: "Tonight's sky — Sky Concierge",
          text: "Tonight's sky, computed for my location. See yours at Sky Concierge.",
        });
      } else {
        // No share sheet (desktop) — fall back to downloading the choice.
        download(selected === "square" ? square : landscape);
      }
    } catch {
      toast.error("Couldn't share the card — try the download instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200"
      >
        <Share2 className="size-3.5" />
        Share this night
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-card-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Blurred, dimmed backdrop — the page stays visible but fades back. */}
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-md"
          />

          <div className="glass relative z-10 max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3
                  id="share-card-title"
                  className="text-lg font-bold text-slate-100"
                >
                  Share tonight&apos;s sky
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  The card for your location — pick a crop, then share or
                  download it.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close"
                onClick={close}
                className="rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:border-white/25 hover:text-slate-100"
              >
                <X className="size-4" />
              </button>
            </div>

            {loading ? (
              <div className="flex h-44 items-center justify-center gap-2.5 text-sm text-slate-400">
                <Loader2 className="size-4 animate-spin" />
                Rendering your card…
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Landscape — feeds / link previews */}
                <button
                  type="button"
                  onClick={() => setSelected("landscape")}
                  aria-pressed={selected === "landscape"}
                  className={`group rounded-xl border p-2 text-left transition ${
                    selected === "landscape"
                      ? "border-cyan-400/60 bg-cyan-400/5"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                >
                  {/* Local blob preview — next/image can't optimize blobs. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={landscape?.url}
                    alt="Tonight's sky share card — landscape crop"
                    className="w-full rounded-lg border border-white/10"
                  />
                  <span className="mt-2 flex items-center gap-1.5 px-1 text-xs font-medium text-slate-300">
                    <span
                      className={`size-2 rounded-full ${
                        selected === "landscape"
                          ? "bg-cyan-400"
                          : "bg-slate-600"
                      }`}
                    />
                    Feed (landscape)
                  </span>
                </button>

                {/* Square — Instagram / WhatsApp statuses */}
                <button
                  type="button"
                  onClick={() => setSelected("square")}
                  aria-pressed={selected === "square"}
                  className={`group rounded-xl border p-2 text-left transition ${
                    selected === "square"
                      ? "border-cyan-400/60 bg-cyan-400/5"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                >
                  {/* Local blob preview — next/image can't optimize blobs. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={square?.url}
                    alt="Tonight's sky share card — square crop"
                    className="w-full rounded-lg border border-white/10"
                  />
                  <span className="mt-2 flex items-center gap-1.5 px-1 text-xs font-medium text-slate-300">
                    <span
                      className={`size-2 rounded-full ${
                        selected === "square" ? "bg-cyan-400" : "bg-slate-600"
                      }`}
                    />
                    Status (square)
                  </span>
                </button>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={share}
                disabled={busy || loading || !landscape}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20 disabled:cursor-wait disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Share2 className="size-4" />
                )}
                Share
              </button>
              <button
                type="button"
                onClick={() => {
                  const variant = selected === "square" ? square : landscape;
                  if (variant) download(variant);
                }}
                disabled={loading || !landscape}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-60"
              >
                <Download className="size-4" />
                Download {selected === "square" ? "square" : "card"}
              </button>
            </div>
            <p className="mt-3 text-center text-[10px] text-slate-500">
              Sharing offers both crops in the system sheet — pick the one you
              want. No account needed.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
