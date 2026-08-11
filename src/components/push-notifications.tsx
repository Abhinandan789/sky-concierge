"use client";

import { BellRing, Loader2, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ALERT_EVENT_TYPES, type LatLon } from "@/types";

const STORAGE_KEY = "sky-concierge:push-on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Url);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/**
 * Browser push notifications. Requires the service worker (public/sw.js) and
 * VAPID keys on the server; the toggle simply doesn't render until the
 * server confirms push is configured.
 */
export function PushNotifications({ location }: { location: LatLon }) {
  const [ready, setReady] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      return; // unsupported — render nothing
    }

    let cancelled = false;
    (async () => {
      try {
        const [keyBody] = await Promise.all([
          fetch("/api/push/public-key").then((r) => r.json()),
          navigator.serviceWorker.register("/sw.js"),
        ]);
        if (cancelled) {
          return;
        }
        if (!keyBody?.data?.publicKey) {
          return; // VAPID not configured — hide the toggle
        }
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) {
          return;
        }
        setSubscribed(Boolean(existing));
        setReady(true);
      } catch {
        // Push is optional; fail silently.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const turnOn = async () => {
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error(
          permission === "denied"
            ? "Notifications are blocked in your browser settings."
            : "You'll need to allow notifications to use this.",
        );
        return;
      }
    }

    setBusy(true);
    try {
      const keyBody = await fetch("/api/push/public-key").then((r) => r.json());
      const publicKey = keyBody?.data?.publicKey as string | undefined;
      if (!publicKey) {
        toast.error("Push isn't configured on this deployment yet.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const response = await fetch("/api/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: subscription.toJSON().keys,
          lat: location.lat,
          lon: location.lon,
          events: [...ALERT_EVENT_TYPES],
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Couldn't save the subscription.");
      }

      window.localStorage.setItem(STORAGE_KEY, "1");
      setSubscribed(true);
      toast.success("Push alerts on — passes, aurora and showers.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't enable push notifications.",
      );
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {});
        await subscription.unsubscribe();
      }
      window.localStorage.removeItem(STORAGE_KEY);
      setSubscribed(false);
      toast.success("Push notifications turned off.");
    } catch {
      toast.error("Couldn't turn off push — please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return null;
  }

  return (
    <div className="glass mx-auto mt-6 flex max-w-3xl flex-col items-center gap-4 rounded-2xl p-5 sm:flex-row sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-sky-300">
          <Smartphone className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-200">
            Push notifications
          </p>
          <p className="text-xs text-slate-500">
            Alerts straight to this browser — no email needed.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={subscribed ? turnOff : turnOn}
        disabled={busy}
        className={`inline-flex items-center gap-2 rounded-full border px-5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
          subscribed
            ? "border-white/15 bg-white/5 text-slate-300 hover:border-white/30"
            : "border-sky-400/40 bg-sky-400/10 text-sky-200 hover:border-sky-300/70 hover:bg-sky-400/20"
        }`}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <BellRing className="size-4" />
        )}
        {subscribed ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}
