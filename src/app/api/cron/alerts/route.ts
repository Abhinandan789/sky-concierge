import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { logger } from "@/lib/logger";
import { runAlertCheck, runDigestCheck } from "@/services/alerts/checker";

export const runtime = "nodejs";
// Cron runs can take a while (upstream weather + TLE fetches per subscriber).
export const maxDuration = 300;

/**
 * Scheduled alert engine entry point — the production equivalent of running
 * `pnpm check:alerts` by hand. Vercel Cron (see vercel.json) hits this route
 * every 5 minutes; the per-(subscription, event, day) log dedup makes
 * overlapping runs harmless, so running it often is safe.
 *
 * Auth: when CRON_SECRET is set, Vercel sends it as `Authorization: Bearer`
 * automatically. The same secret is accepted as ?secret= so the route can be
 * exercised from a terminal. With no secret configured (local dev) the route
 * runs unauthenticated.
 *
 * ?digest=1 also runs the weekly sky digest; its ISO-week dedup means it only
 * ever sends once per week regardless of how often the cron fires.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const query = request.nextUrl.searchParams.get("secret") ?? "";
    const supplied = bearer || query;
    if (!supplied || supplied !== secret) {
      return jsonError("Unauthorized.", 401, "UNAUTHORIZED");
    }
  }

  const digest = request.nextUrl.searchParams.get("digest") === "1";
  const startedAt = Date.now();

  try {
    const result = digest ? await runDigestCheck() : await runAlertCheck();
    logger.info(
      digest ? "Cron: weekly digest complete" : "Cron: alert check complete",
      {
        digest,
        checked: result.checked,
        sent: result.sent,
        durationMs: Date.now() - startedAt,
      },
    );
    return jsonOk({
      digest,
      checked: result.checked,
      sent: result.sent,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error(
      digest ? "Cron: weekly digest failed" : "Cron: alert check failed",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return jsonError(
      error instanceof Error ? error.message : "Alert check failed.",
      500,
      "ALERT_CHECK_FAILED",
    );
  }
}
