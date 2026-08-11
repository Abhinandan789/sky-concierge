import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearUpstreamCache, getCachedKpForecast, getCachedTleSet } from "./cache";

const TLE_RESPONSE = ["ISS (ZARYA)", "1 25544U ...", "2 25544 ..."].join("\n");

function mockFetcher() {
  return vi.fn(async (url: string) => {
    if (url.includes("celestrak")) {
      return new Response(TLE_RESPONSE);
    }
    return new Response("[]");
  });
}

describe("upstream cache", () => {
  beforeEach(() => {
    clearUpstreamCache();
  });

  it("fetches a TLE once and serves it from cache for the TTL", async () => {
    const fetcher = mockFetcher();
    const first = await getCachedTleSet("25544", fetcher as unknown as typeof fetch);
    const second = await getCachedTleSet("25544", fetcher as unknown as typeof fetch);

    expect(first.name).toBe("ISS (ZARYA)");
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("caches the Kp forecast", async () => {
    const fetcher = mockFetcher();
    await getCachedKpForecast(fetcher as unknown as typeof fetch);
    await getCachedKpForecast(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clears on demand", async () => {
    const fetcher = mockFetcher();
    await getCachedTleSet("25544", fetcher as unknown as typeof fetch);
    clearUpstreamCache();
    await getCachedTleSet("25544", fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
