import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory DB for every route test — read lazily by getDb().
vi.stubEnv("SKY_DB_PATH", ":memory:");
vi.stubEnv("SITE_URL", "https://example.test");

import { NextRequest } from "next/server";
import { getDb, listEnabledSubscriptions } from "@/lib/db";
import { POST as subscribePost } from "./route";
import { POST as unsubscribePost } from "./unsubscribe/route";
import { POST as verifyPost } from "./verify/route";

function post(url: string, body: unknown, ip = "203.0.113.9") {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  email: "stargazer@example.com",
  lat: 40.7128,
  lon: -74.006,
  events: ["iss", "aurora"],
};

function resetDb() {
  (globalThis as { skyDb?: unknown }).skyDb = undefined;
}

describe("POST /api/subscriptions", () => {
  beforeEach(() => {
    resetDb();
    vi.unstubAllEnvs();
    vi.stubEnv("SKY_DB_PATH", ":memory:");
    vi.stubEnv("SITE_URL", "https://example.test");
    vi.unstubAllGlobals();
  });

  it("creates a subscription, auto-verified in console mode", async () => {
    const response = await subscribePost(
      post("/api/subscriptions", VALID_BODY),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.verified).toBe(true);
    expect(body.data.id).toBeTruthy();
    // Unsubscribe tokens only ever travel inside alert emails, never in
    // unauthenticated API responses.
    expect(body.data.unsubscribeToken).toBeUndefined();
    expect(listEnabledSubscriptions(getDb())).toHaveLength(1);
  });

  it("validates the email, coordinates and events", async () => {
    const badEmail = await subscribePost(
      post("/api/subscriptions", { ...VALID_BODY, email: "nope" }),
    );
    expect(badEmail.status).toBe(400);
    expect((await badEmail.json()).error.code).toBe("INVALID_EMAIL");

    const badCoords = await subscribePost(
      post("/api/subscriptions", { ...VALID_BODY, lat: 123 }),
    );
    expect(badCoords.status).toBe(400);
    expect((await badCoords.json()).error.code).toBe("INVALID_COORDINATES");

    const noEvents = await subscribePost(
      post("/api/subscriptions", { ...VALID_BODY, events: ["nope"] }),
    );
    expect(noEvents.status).toBe(400);
    expect((await noEvents.json()).error.code).toBe("NO_EVENTS");
  });

  it("requires confirmation when a real sender is configured, then verifies", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const resendMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", resendMock);

    const response = await subscribePost(
      post("/api/subscriptions", VALID_BODY),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.verified).toBe(false);
    // The confirmation email was sent to Resend with a /verify link.
    const [url, init] = resendMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(init.body)) as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(payload.to).toEqual([VALID_BODY.email]);
    expect(payload.text).toContain("https://example.test/verify?token=");

    // Not yet listed for the alert engine…
    expect(listEnabledSubscriptions(getDb())).toHaveLength(0);

    // …until the subscriber confirms via the verify endpoint (the token is
    // only delivered inside the confirmation email, not the API response).
    const pending = getDb()
      .prepare(
        `SELECT verify_token AS verifyToken FROM alert_subscriptions WHERE email = ?`,
      )
      .get(VALID_BODY.email) as { verifyToken: string };
    const verifyResponse = await verifyPost(
      post("/api/subscriptions/verify", { token: pending.verifyToken }),
    );
    expect(verifyResponse.status).toBe(200);
    expect(listEnabledSubscriptions(getDb())).toHaveLength(1);
  });

  it("unsubscribes via the per-subscription token (from the DB, as email links do)", async () => {
    await subscribePost(post("/api/subscriptions", VALID_BODY));
    const row = getDb()
      .prepare(
        `SELECT unsubscribe_token AS unsubscribeToken
         FROM alert_subscriptions WHERE email = ?`,
      )
      .get(VALID_BODY.email) as { unsubscribeToken: string };

    const response = await unsubscribePost(
      post("/api/subscriptions/unsubscribe", { token: row.unsubscribeToken }),
    );
    expect(response.status).toBe(200);
    expect(listEnabledSubscriptions(getDb())).toHaveLength(0);
  });

  it("never exposes or rotates the token for an already-verified address", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    // The owner signs up and confirms via the email link.
    const first = await subscribePost(post("/api/subscriptions", VALID_BODY));
    expect((await first.json()).data.unsubscribeToken).toBeUndefined();
    const pending = getDb()
      .prepare(
        `SELECT verify_token AS verifyToken
         FROM alert_subscriptions WHERE email = ?`,
      )
      .get(VALID_BODY.email) as { verifyToken: string };
    await verifyPost(
      post("/api/subscriptions/verify", { token: pending.verifyToken }),
    );
    const ownerToken = (
      getDb()
        .prepare(
          `SELECT unsubscribe_token AS unsubscribeToken
         FROM alert_subscriptions WHERE email = ?`,
        )
        .get(VALID_BODY.email) as { unsubscribeToken: string }
    ).unsubscribeToken;

    // Someone who doesn't control the mailbox re-submits the same details…
    const resubmit = await subscribePost(
      post("/api/subscriptions", VALID_BODY),
    );
    const resubmitBody = await resubmit.json();
    expect(resubmitBody.data.verified).toBe(true);
    expect(resubmitBody.data.unsubscribeToken).toBeUndefined();

    // …and can neither harvest nor rotate the owner's unsubscribe token.
    const after = getDb()
      .prepare(
        `SELECT unsubscribe_token AS unsubscribeToken
         FROM alert_subscriptions WHERE email = ?`,
      )
      .get(VALID_BODY.email) as { unsubscribeToken: string };
    expect(after.unsubscribeToken).toBe(ownerToken);
  });

  it("rate limits repeated signups from one IP", async () => {
    const ip = "198.51.100.7";
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const response = await subscribePost(
        post("/api/subscriptions", VALID_BODY, ip),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});
