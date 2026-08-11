import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.check("ip-1", 5, 60_000).allowed).toBe(true);
    }
    const blocked = limiter.check("ip-1", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(() => 0);
    for (let i = 0; i < 3; i += 1) {
      limiter.check("ip-1", 3, 60_000);
    }
    expect(limiter.check("ip-1", 3, 60_000).allowed).toBe(false);
    expect(limiter.check("ip-2", 3, 60_000).allowed).toBe(true);
  });

  it("releases the key after the window elapses", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 3; i += 1) {
      limiter.check("ip-1", 3, 60_000);
    }
    expect(limiter.check("ip-1", 3, 60_000).allowed).toBe(false);
    now = 61_000;
    expect(limiter.check("ip-1", 3, 60_000).allowed).toBe(true);
  });
});
