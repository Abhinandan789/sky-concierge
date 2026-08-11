import type { NextRequest } from "next/server";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the client should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
}

/**
 * In-memory sliding-window rate limiter. Tracks the timestamps of recent hits
 * per key (usually an IP address) and allows at most `limit` hits per
 * `windowMs`. Cheap and correct enough for a single-instance deploy.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const t = this.now();

    // Guard against unbounded growth from many distinct keys.
    if (this.hits.size > 10_000) {
      this.hits.clear();
    }

    const recent = (this.hits.get(key) ?? []).filter((ts) => t - ts < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)),
      };
    }

    recent.push(t);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  clear(): void {
    this.hits.clear();
  }
}

/** Best-effort client IP from common proxy headers. */
export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
