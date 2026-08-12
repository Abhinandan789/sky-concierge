import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { applyEmailWebhookEvent } from "@/lib/db";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Resend webhook endpoint — delivery + bounce tracking.
 *
 * Configure a webhook in the Resend dashboard (Settings → Webhooks → Add
 * endpoint) pointing at {SITE_URL}/api/webhooks/resend, subscribe to at least
 * `email.delivered` and `email.bounced`, and paste the webhook's signing
 * secret into RESEND_WEBHOOK_SECRET. Bounces/complaints mark the matching
 * subscription as failed and disable it, so the alert engine stops emailing a
 * dead address; every event is appended to the email_events log.
 *
 * Requests are verified with Resend's HMAC-SHA256 signature (the
 * `Resend-Signature: t=<ts>,s=<hex>` header). When RESEND_WEBHOOK_SECRET is
 * unset (local dev), requests are accepted without verification so the flow
 * can be exercised with curl.
 */

/** Accept signatures up to 5 minutes old to blunt replay attacks. */
const MAX_SIGNATURE_AGE_MS = 5 * 60_000;

interface ResendWebhookPayload {
  type?: unknown;
  created_at?: unknown;
  data?: {
    email_id?: unknown;
    to?: unknown;
    bounce?: { bounce_type?: unknown } | null;
  };
}

/** Recipient address from the payload — Resend sends `to` as a string for
 * most events and an array for a few; accept both. */
function recipientAddress(data: ResendWebhookPayload["data"]): string | null {
  const to = data?.to;
  if (typeof to === "string") {
    return to.trim();
  }
  if (Array.isArray(to)) {
    for (const entry of to) {
      if (typeof entry === "string" && entry.trim()) {
        return entry.trim();
      }
    }
  }
  return null;
}

function isValidSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return true; // unverified in local dev — the secret gates production
  }
  if (!header) {
    return false;
  }
  const parts = new Map(
    header
      .split(",")
      .map((pair) => pair.trim().split("=", 2))
      .filter((pair) => pair.length === 2)
      .map(([key, value]) => [key.trim(), value.trim()]),
  );
  const timestamp = parts.get("t");
  const signature = parts.get("s");
  if (!timestamp || !signature) {
    return false;
  }
  if (!/^\d+$/.test(timestamp)) {
    return false;
  }
  const age = Date.now() - Number(timestamp) * 1000;
  if (age < -MAX_SIGNATURE_AGE_MS || age > MAX_SIGNATURE_AGE_MS) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const provided = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (provided.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(provided, expectedBuffer);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!isValidSignature(rawBody, request.headers.get("resend-signature"))) {
    logger.warn("Rejected Resend webhook with an invalid signature", {
      remote: request.headers.get("x-forwarded-for") ?? undefined,
    });
    return jsonError("Invalid webhook signature.", 401, "INVALID_SIGNATURE");
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ResendWebhookPayload;
  } catch {
    return jsonError("Invalid JSON payload.", 400, "INVALID_BODY");
  }

  const type = typeof payload.type === "string" ? payload.type : "";
  if (!type.startsWith("email.")) {
    // Not an email lifecycle event (e.g. account events) — nothing to do, but
    // acknowledge so Resend doesn't retry forever.
    return jsonOk({ received: type || "unknown" });
  }

  const email = recipientAddress(payload.data);
  if (!email) {
    logger.warn("Resend webhook event without a recipient address", { type });
    return jsonError("Webhook event is missing a recipient.", 400, "NO_TO");
  }

  const emailId =
    typeof payload.data?.email_id === "string" ? payload.data.email_id : null;
  const bounceType =
    typeof payload.data?.bounce?.bounce_type === "string"
      ? payload.data.bounce.bounce_type
      : null;

  try {
    const subscriptionId = applyEmailWebhookEvent(getDb(), {
      email,
      eventType: type,
      emailId,
      bounceType,
      detail: bounceType ? `bounce_type=${bounceType}` : "",
    });
    if (subscriptionId) {
      logger.info("Resend email event applied", {
        type,
        email,
        bounceType,
        subscriptionId,
      });
    } else {
      // The address isn't subscribed (e.g. a confirmation email for a signup
      // that never completed) — the event is still logged for tracking.
      logger.info("Resend email event recorded (no subscription)", {
        type,
        email,
      });
    }
  } catch (error) {
    logger.error("Resend webhook processing failed", {
      type,
      email,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      "Could not process the webhook event.",
      500,
      "PROCESSING_FAILED",
    );
  }

  return jsonOk({ received: type });
}
