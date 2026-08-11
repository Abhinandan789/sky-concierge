import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("SKY_DB_PATH", ":memory:");

import { NextRequest } from "next/server";
import { clearUpstreamCache } from "@/services/sky/cache";
import { GET as briefGet } from "./route";

function get(url: string, ip = "203.0.113.9") {
  return new NextRequest(`http://localhost${url}`, {
    headers: { "x-forwarded-for": ip },
  });
}

/** Offline fetcher: sections degrade gracefully, the envelope stays intact. */
function stubOfflineFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network unavailable");
    }),
  );
}

describe("GET /api/sky/brief", () => {
  beforeEach(() => {
    clearUpstreamCache();
    vi.unstubAllGlobals();
  });

  it("requires lat and lon", async () => {
    const response = await briefGet(get("/api/sky/brief"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("MISSING_COORDINATES");
  });

  it("rejects out-of-range coordinates", async () => {
    const response = await briefGet(get("/api/sky/brief?lat=91&lon=0"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_COORDINATES");
  });

  it("rejects malformed norad ids", async () => {
    const response = await briefGet(
      get("/api/sky/brief?lat=40.7&lon=-74&norad=25544,abc"),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_SATELLITE_IDS");
  });

  it("accepts a valid norad list", async () => {
    stubOfflineFetch();
    const response = await briefGet(
      get("/api/sky/brief?lat=40.7&lon=-74&norad=25544,48274"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    // Both satellites fail to load offline, but the envelope stays intact.
    expect(body.success).toBe(true);
    expect(
      body.data.errors.map((error: { section: string }) => error.section),
    ).toContain("iss");
  });

  it("returns a brief envelope even when upstream data is unavailable", async () => {
    stubOfflineFetch();
    const response = await briefGet(get("/api/sky/brief?lat=40.7&lon=-74"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.location).toEqual({ lat: 40.7, lon: -74 });
    // All upstream sections failed but the brief still degraded gracefully.
    expect(
      body.data.errors
        .map((error: { section: string }) => error.section)
        .sort(),
    ).toEqual(["aurora", "clouds", "iss"]);
    expect(Array.isArray(body.data.issPasses)).toBe(true);
  });

  it("rate limits repeated requests from one IP", async () => {
    stubOfflineFetch();
    const ip = "198.51.100.9";
    let lastStatus = 0;
    for (let i = 0; i < 61; i += 1) {
      const response = await briefGet(
        get("/api/sky/brief?lat=40.7&lon=-74", ip),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});
