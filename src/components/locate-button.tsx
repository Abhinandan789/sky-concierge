"use client";

import { Loader2, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function LocateButton({ className }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation isn't supported by this browser.");
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        router.push(
          `/?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}#tonight`,
        );
      },
      () => {
        setLoading(false);
        toast.error(
          "Couldn't access your location — you can still browse the default city.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  return (
    <button
      type="button"
      onClick={locate}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 text-sm font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <MapPin className="size-4" />
      )}
      {loading ? "Finding you…" : "Use my location"}
    </button>
  );
}
