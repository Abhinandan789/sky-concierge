import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("SKY_DB_PATH", ":memory:");

import { NextRequest } from "next/server";
import { clearUpstreamCache } from "@/services/sky/cache";
import { GET as cloudsGet } from "./route";

function get(url: string, ip = "203.0.113.9") {
  return new NextRequest(`http://localhost${url}`, {
    headers: { "x-forwarded-for": ip },
  });
}

describe("GET /api/sky/clouds", () => {
  beforeEach(() => {
    clearUpstreamCache();
    vi.unstubAllGlobals();
  });

  it("requires lat and lon", async () => {
    const response = await cloudsGet(get("/api/sky/clouds"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("MISSING_COORDINATES");
  });

  it("rejects out-of-range coordinates", async () => {
    const response = await cloudsGet(get("/api/sky/clouds?lat=95&lon=0"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_COORDINATES");
  });

  it("returns a cloud summary from Open-Meteo", async () => {
    // Cover 24h before and 48h after the real clock: getTonightBounds can
    // return either the night just ended or the one approaching, so the mock
    // forecast must overlap whichever window the route computes.
    const times: string[] = [];
    const covers: number[] = [];
    for (let i = -24; i < 48; i += 1) {
      times.push(
        new Date(Date.now() + i * 3600_000).toISOString().slice(0, 13) + ":00",
      );
      covers.push(10 + ((i + 24) % 3) * 10);
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ hourly: { time: times, cloud_cover: covers } }),
            { status: 200 },
          ),
      ),
    );
    const response = await cloudsGet(get("/api/sky/clouds?lat=40.7&lon=-74"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.level).toBe("string");
    expect(typeof body.data.average).toBe("number");
    expect(body.data.level).not.toBe("UNKNOWN");
  });

  it("degrades to UNKNOWN when the upstream call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );
    const response = await cloudsGet(get("/api/sky/clouds?lat=40.7&lon=-74"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.level).toBe("UNKNOWN");
    expect(body.data.average).toBeNull();
  });

  it("rate limits repeated requests from one IP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              hourly: { time: ["2026-08-11T23:00"], cloud_cover: [10] },
            }),
            { status: 200 },
          ),
      ),
    );
    const ip = "198.51.100.9";
    let lastStatus = 0;
    for (let i = 0; i < 61; i += 1) {
      const response = await cloudsGet(
        get("/api/sky/clouds?lat=40.7&lon=-74", ip),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});
