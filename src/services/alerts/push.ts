import type { PushSubscriptionRow } from "@/lib/db";
import webpush from "web-push";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushOptions {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}

/** True when VAPID keys are configured (push is live; otherwise it no-ops). */
export function vapidConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

/** The VAPID public key exposed to browsers for push subscription requests. */
export function publicVapidKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

/**
 * Send a push notification to a stored browser subscription. Silently no-ops
 * when VAPID keys aren't configured, so the whole app still works with zero
 * env vars. Payloads are encrypted per the Web Push protocol (RFC 8291) by
 * the web-push library; TTL keeps stale notifications from piling up.
 */
export async function sendPush(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
  options: PushOptions = {},
): Promise<void> {
  const publicKey =
    options.publicKey ?? process.env.VAPID_PUBLIC_KEY;
  const privateKey =
    options.privateKey ?? process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return;
  }

  webpush.setVapidDetails(
    options.subject ??
      process.env.VAPID_SUBJECT ??
      "mailto:alerts@localhost",
    publicKey,
    privateKey,
  );

  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload),
    { TTL: 86_400 },
  );
}
