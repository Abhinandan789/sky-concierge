import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";
import { clearUpstreamCache } from "@/services/sky/cache";
import { GET as tlesGet } from "./route";

const ISS_TLE = {
  line1:
    "1 25544U 98067A   26222.50435993  .00003786  00000+0  75820-4 0  9991",
  line2:
    "2 25544  51.6324  31.2750 0007420  32.4605 327.6839 15.49403146580170",
};

function get(url: string, ip = "203.0.113.9") {
  return new NextRequest(`http://localhost${url}`, {
    headers: { "x-forwarded-for": ip },
  });
}

/** CelesTrak returns name + two TLE lines for any queried NORAD id. */
function stubTleFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(`ISS (ZARYA)\n${ISS_TLE.line1}\n${ISS_TLE.line2}\n`),
    ),
  );
}

describe("GET /api/sky/tles", () => {
  beforeEach(() => {
    clearUpstreamCache();
    vi.unstubAllGlobals();
  });

  it("serves TLEs for explicit norad ids", async () => {
    stubTleFetch();
    const response = await tlesGet(get("/api/sky/tles?norad=25544,48274"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.tles).toHaveLength(2);
    const tle = body.data.tles[0];
    expect(tle.noradId).toBe("25544");
    expect(tle.name).toBe("ISS (ZARYA)");
    expect(tle.line1).toBe(ISS_TLE.line1);
    expect(tle.line2).toBe(ISS_TLE.line2);
  });

  it("falls back to the default set when norad is omitted", async () => {
    stubTleFetch();
    const response = await tlesGet(get("/api/sky/tles"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.tles.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects malformed norad ids", async () => {
    const response = await tlesGet(get("/api/sky/tles?norad=25544,abc"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_SATELLITE_IDS");
  });
});
