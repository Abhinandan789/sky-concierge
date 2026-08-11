import { describe, expect, it } from "vitest";
import { TtlCache } from "./ttl-cache";

describe("TtlCache", () => {
  it("returns the cached value until it expires", () => {
    let now = 1_000;
    const cache = new TtlCache<string, number>(() => now);

    cache.set("a", 42, 5_000);
    expect(cache.get("a")).toBe(42);

    now = 5_999;
    expect(cache.get("a")).toBe(42);

    now = 6_000; // exactly expired
    expect(cache.get("a")).toBeUndefined();
  });

  it("overwrites values for the same key", () => {
    const cache = new TtlCache<string, number>();
    cache.set("a", 1, 5_000);
    cache.set("a", 2, 5_000);
    expect(cache.get("a")).toBe(2);
  });

  it("clears everything", () => {
    const cache = new TtlCache<string, number>();
    cache.set("a", 1, 5_000);
    cache.set("b", 2, 5_000);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
