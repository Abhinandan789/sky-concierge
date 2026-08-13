import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import {
  BrevoEmailSender,
  createSender,
  GmailSmtpSender,
} from "./sender";

const createTransportMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (...args: unknown[]) => createTransportMock(...args),
  },
}));

describe("createSender", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("prefers Gmail when GMAIL_USER + GMAIL_APP_PASSWORD are set", () => {
    vi.stubEnv("GMAIL_USER", "you@gmail.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop");
    vi.stubEnv("BREVO_API_KEY", "xkeysib-test");
    const sender = createSender();
    expect(sender).toBeInstanceOf(GmailSmtpSender);
  });

  it("prefers Brevo when BREVO_API_KEY is set (no Gmail config)", () => {
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

  it("includes htmlContent when the message has an HTML body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const sender = new BrevoEmailSender("xkeysib-test", "you@gmail.com");

    await sender.send("friend@example.com", {
      subject: "Confirm your Sky Concierge alerts",
      body: "Click to confirm.",
      html: "<p>Click <a href=\"https://example.com\">here</a>.</p>",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { name: "Sky Concierge", email: "you@gmail.com" },
      to: [{ email: "friend@example.com" }],
      subject: "Confirm your Sky Concierge alerts",
      textContent: "Click to confirm.",
      htmlContent: "<p>Click <a href=\"https://example.com\">here</a>.</p>",
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

describe("GmailSmtpSender", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a secure Gmail transporter with the app password", () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: [] });
    createTransportMock.mockReturnValue({ sendMail });

    new GmailSmtpSender("you@gmail.com", "abcd efgh ijkl mnop");

    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: "you@gmail.com", pass: "abcd efgh ijkl mnop" },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  });

  it("passes extra headers (e.g. List-Unsubscribe) through", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["friend@example.com"] });
    createTransportMock.mockReturnValue({ sendMail });
    const sender = new GmailSmtpSender("you@gmail.com", "abcd efgh ijkl mnop");

    await sender.send("friend@example.com", {
      subject: "ISS pass in ~45 min",
      body: "Rises 22:14.",
      headers: {
        "List-Unsubscribe": "<https://example.com/unsubscribe?token=x>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: "Sky Concierge <you@gmail.com>",
      to: "friend@example.com",
      subject: "ISS pass in ~45 min",
      text: "Rises 22:14.",
      headers: {
        "List-Unsubscribe": "<https://example.com/unsubscribe?token=x>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  });

  it("passes the HTML body through when provided", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["friend@example.com"] });
    createTransportMock.mockReturnValue({ sendMail });
    const sender = new GmailSmtpSender("you@gmail.com", "abcd efgh ijkl mnop");

    await sender.send("friend@example.com", {
      subject: "Confirm your Sky Concierge alerts",
      body: "Click to confirm.",
      html: "<p>Hello</p>",
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: "Sky Concierge <you@gmail.com>",
      to: "friend@example.com",
      subject: "Confirm your Sky Concierge alerts",
      text: "Click to confirm.",
      html: "<p>Hello</p>",
    });
  });

  it("sends the message from the Gmail user with the alert content", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["friend@example.com"] });
    createTransportMock.mockReturnValue({ sendMail });
    const sender = new GmailSmtpSender("you@gmail.com", "abcd efgh ijkl mnop");

    await sender.send("friend@example.com", {
      subject: "Confirm your Sky Concierge alerts",
      body: "Click to confirm.",
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: "Sky Concierge <you@gmail.com>",
      to: "friend@example.com",
      subject: "Confirm your Sky Concierge alerts",
      text: "Click to confirm.",
    });
  });

  it("propagates SMTP failures and logs the provider's exact reason", async () => {
    const logError = vi.spyOn(logger, "error").mockImplementation(() => {});
    const smtpError = Object.assign(new Error("535 5.7.8 auth failed"), {
      code: "EAUTH",
      responseCode: 535,
      response: "535 5.7.8 Username and Password not accepted",
    });
    createTransportMock.mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(smtpError),
    });
    const sender = new GmailSmtpSender("you@gmail.com", "wrong-pass");

    await expect(
      sender.send("friend@example.com", { subject: "s", body: "b" }),
    ).rejects.toThrow(/535 5\.7\.8 auth failed/);

    expect(logError).toHaveBeenCalledWith("Gmail SMTP send failed", {
      to: "friend@example.com",
      provider: "gmail",
      code: "EAUTH",
      smtpResponseCode: 535,
      smtpResponse: "535 5.7.8 Username and Password not accepted",
      reason: "535 5.7.8 auth failed",
    });
  });
});
