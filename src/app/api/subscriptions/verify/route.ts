import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { getDb, verifySubscription } from "@/lib/db";

export const runtime = "nodejs";

const VERIFY_LIMIT = 20;
const VERIFY_WINDOW_MS = 60_000;

const limiter = new RateLimiter();

interface VerifyBody {
  token?: unknown;
}

export async function POST(request: NextRequest) {
  const rate = limiter.check(clientIp(request), VERIFY_LIMIT, VERIFY_WINDOW_MS);
  if (!rate.allowed) {
    return jsonError(
      "Too many requests — please try again in a minute.",
      429,
      "RATE_LIMITED",
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "INVALID_BODY");
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return jsonError("A verification token is required.", 400, "MISSING_TOKEN");
  }

  const found = verifySubscription(getDb(), token);
  if (!found) {
    return jsonError(
      "That confirmation link is invalid or has already been used.",
      404,
      "TOKEN_NOT_FOUND",
    );
  }

  return jsonOk({ verified: true });
}
