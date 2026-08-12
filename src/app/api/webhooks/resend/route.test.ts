import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("SKY_DB_PATH", ":memory:");

import { NextRequest } from "next/server";
import { getDb, listEnabledSubscriptions, upsertSubscription } from "@/lib/db";
import { POST as webhookPost } from "./route";

function webhookRequest(body: unknown, signature?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature !== undefined) {
    if (signature === null) {
      headers["resend-signature"] = "";
    } else {
      headers["resend-signature"] = signature;
    }
  }
  return new NextRequest("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function sign(body: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},s=${sig}`;
}

function resetDb() {
  (globalThis as { skyDb?: unknown }).skyDb = undefined;
}

describe("POST /api/webhooks/resend", () => {
  beforeEach(() => {
    resetDb();
    vi.unstubAllEnvs();
    vi.stubEnv("SKY_DB_PATH", ":memory:");
  });

  it("marks a permanent bounce as failed and disables the subscription", async () => {
    upsertSubscription(getDb(), {
      email: "dead@example.com",
      lat: 40.7,
      lon: -74,
      events: "iss",
    });
    expect(listEnabledSubscriptions(getDb())).toHaveLength(1);

    const response = await webhookPost(
      webhookRequest({
        type: "email.bounced",
        created_at: "2026-08-12T00:00:00.000Z",
        data: {
          email_id: "email_abc",
          to: ["dead@example.com"],
          subject: "ISS pass in ~20 min over your location",
          bounce: { bounce_type: "Permanent", to: "dead@example.com" },
        },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.received).toBe("email.bounced");

    const row = getDb()
      .prepare(
        `SELECT enabled, email_status AS emailStatus, bounced_at AS bouncedAt
         FROM alert_subscriptions WHERE email = 'dead@example.com'`,
      )
      .get() as {
      enabled: number;
      emailStatus: string;
      bouncedAt: string | null;
    };
    expect(row.enabled).toBe(0);
    expect(row.emailStatus).toBe("bounced");
    expect(row.bouncedAt).toBeTruthy();
    expect(listEnabledSubscriptions(getDb())).toHaveLength(0);
  });

  it("treats `to` as a string too (Resend sends both shapes)", async () => {
    upsertSubscription(getDb(), {
      email: "solo@example.com",
      lat: 1,
      lon: 2,
      events: "iss",
    });
    const response = await webhookPost(
      webhookRequest({
        type: "email.delivered",
        data: { email_id: "email_1", to: "solo@example.com" },
      }),
    );
    expect(response.status).toBe(200);
    const row = getDb()
      .prepare(
        `SELECT email_status AS emailStatus
         FROM alert_subscriptions WHERE email = 'solo@example.com'`,
      )
      .get() as { emailStatus: string };
    expect(row.emailStatus).toBe("delivered");
  });

  it("acknowledges non-email events without touching subscriptions", async () => {
    upsertSubscription(getDb(), {
      email: "safe@example.com",
      lat: 1,
      lon: 2,
      events: "iss",
    });
    const response = await webhookPost(
      webhookRequest({ type: "domain.created", data: {} }),
    );
    expect(response.status).toBe(200);
    const row = getDb()
      .prepare(
        `SELECT email_status AS emailStatus
         FROM alert_subscriptions WHERE email = 'safe@example.com'`,
      )
      .get() as { emailStatus: string };
    expect(row.emailStatus).toBe("ok");
  });

  it("rejects events for addresses that aren't subscribed", async () => {
    const response = await webhookPost(
      webhookRequest({
        type: "email.bounced",
        data: {
          email_id: "email_x",
          to: "ghost@example.com",
          bounce: { bounce_type: "Permanent" },
        },
      }),
    );
    expect(response.status).toBe(200); // still acknowledged so Resend stops retrying
  });

  it("rejects a missing recipient", async () => {
    const response = await webhookPost(
      webhookRequest({ type: "email.bounced", data: { email_id: "email_x" } }),
    );
    expect(response.status).toBe(400);
  });

  it("enforces the signing secret when configured", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "webhook-secret");
    upsertSubscription(getDb(), {
      email: "signed@example.com",
      lat: 1,
      lon: 2,
      events: "iss",
    });

    const body = {
      type: "email.bounced",
      data: {
        email_id: "email_1",
        to: "signed@example.com",
        bounce: { bounce_type: "Permanent" },
      },
    };

    // No signature → 401, subscription untouched.
    const unsigned = await webhookPost(webhookRequest(body));
    expect(unsigned.status).toBe(401);
    const row = getDb()
      .prepare(
        `SELECT enabled FROM alert_subscriptions WHERE email = 'signed@example.com'`,
      )
      .get() as { enabled: number };
    expect(row.enabled).toBe(1);

    // Wrong signature → 401.
    const tampered = await webhookPost(webhookRequest(body, "t=0,s=deadbeef"));
    expect(tampered.status).toBe(401);

    // Valid signature → processed.
    const signed = await webhookPost(
      webhookRequest(body, sign(JSON.stringify(body), "webhook-secret")),
    );
    expect(signed.status).toBe(200);
    const after = getDb()
      .prepare(
        `SELECT enabled FROM alert_subscriptions WHERE email = 'signed@example.com'`,
      )
      .get() as { enabled: number };
    expect(after.enabled).toBe(0);
  });
});
