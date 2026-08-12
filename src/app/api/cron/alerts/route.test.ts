import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("SKY_DB_PATH", ":memory:");

import { NextRequest } from "next/server";
import { GET as cronGet } from "./route";

function get(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: "GET",
    headers,
  });
}

function resetDb() {
  (globalThis as { skyDb?: unknown }).skyDb = undefined;
}

describe("GET /api/cron/alerts", () => {
  beforeEach(() => {
    resetDb();
    vi.unstubAllEnvs();
    vi.stubEnv("SKY_DB_PATH", ":memory:");
  });

  it("runs the alert check with no subscriptions (empty DB, no network)", async () => {
    const response = await cronGet(get("/api/cron/alerts"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.checked).toBe(0);
    expect(body.data.sent).toBe(0);
    expect(body.data.digest).toBe(false);
  });

  it("requires the CRON_SECRET when configured", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");

    const noAuth = await cronGet(get("/api/cron/alerts"));
    expect(noAuth.status).toBe(401);

    const wrongAuth = await cronGet(
      get("/api/cron/alerts", { authorization: "Bearer nope" }),
    );
    expect(wrongAuth.status).toBe(401);

    const bearer = await cronGet(
      get("/api/cron/alerts", { authorization: "Bearer topsecret" }),
    );
    expect(bearer.status).toBe(200);

    const querySecret = await cronGet(get("/api/cron/alerts?secret=topsecret"));
    expect(querySecret.status).toBe(200);
  });

  it("runs the digest when requested", async () => {
    const response = await cronGet(get("/api/cron/alerts?digest=1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.digest).toBe(true);
  });
});
