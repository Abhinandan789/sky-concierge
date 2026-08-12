import { afterEach, describe, expect, it, vi } from "vitest";

import { BrevoEmailSender, createSender } from "./sender";

describe("createSender", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prefers Brevo when BREVO_API_KEY is set", () => {
    vi.stubEnv("BREVO_API_KEY", "xkeysib-test");
    vi.stubEnv("BREVO_FROM", "Sky Concierge <you@gmail.com>");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const sender = createSender();
    expect(sender).toBeInstanceOf(BrevoEmailSender);
  });

  it("falls back to the console when no provider key is set", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const sender = createSender();
    expect(sender.constructor.name).toBe("ConsoleSender");
    void sender.send("a@b.co", { subject: "s", body: "b" });
    expect(log).toHaveBeenCalledWith("[sky-concierge] To: a@b.co");
  });
});

describe("BrevoEmailSender", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws a clear error when BREVO_FROM is missing", () => {
    expect(() => new BrevoEmailSender("xkeysib-test", "")).toThrow(/BREVO_FROM/);
  });

  it("posts to the Brevo SMTP API with the right payload shape", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const sender = new BrevoEmailSender(
      "xkeysib-test",
      "Sky Concierge <you@gmail.com>",
    );

    await sender.send("friend@example.com", {
      subject: "Confirm your Sky Concierge alerts",
      body: "Click to confirm.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    const headers = init?.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("xkeysib-test");
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { name: "Sky Concierge", email: "you@gmail.com" },
      to: [{ email: "friend@example.com" }],
      subject: "Confirm your Sky Concierge alerts",
      textContent: "Click to confirm.",
    });
  });

  it("throws with the API detail when Brevo rejects the send", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{\"message\":\"invalid sender\"}", { status: 400 }),
    );
    const sender = new BrevoEmailSender("xkeysib-test", "you@gmail.com");
    await expect(
      sender.send("friend@example.com", { subject: "s", body: "b" }),
    ).rejects.toThrow(/Brevo returned HTTP 400/);
  });
});
