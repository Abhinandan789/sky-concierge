import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

export interface AlertMessage {
  subject: string;
  body: string;
  /** Optional HTML version of `body` — sent when a provider supports it. */
  html?: string;
}

export interface AlertSender {
  send(to: string, message: AlertMessage): Promise<void>;
}

/**
 * Sends email through Gmail's SMTP server using an App Password — the one
 * provider that needs no domain and no provider approval (just a Gmail
 * account with 2-Step Verification + an App Password). Configure with
 * GMAIL_USER and GMAIL_APP_PASSWORD.
 *
 * Gmail has no delivery webhook, so failures are captured here instead:
 * every rejected send is logged with nodemailer's error code and the SMTP
 * server's exact response (e.g. "535 5.7.8 Username and Password not
 * accepted") so misconfigurations are diagnosable from the logs alone.
 * Connection timeouts keep a hung SMTP session from stalling a serverless
 * function.
 */
export class GmailSmtpSender implements AlertSender {
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly user: string,
    appPassword: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass: appPassword },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  }

  async send(to: string, message: AlertMessage): Promise<void> {
    const mail: nodemailer.SendMailOptions = {
      from: `Sky Concierge <${this.user}>`,
      to,
      subject: message.subject,
      text: message.body,
    };
    if (message.html) {
      mail.html = message.html;
    }
    try {
      await this.transporter.sendMail(mail);
    } catch (error) {
      const err = error as {
        code?: string;
        responseCode?: number;
        response?: string;
        message?: string;
      };
      logger.error("Gmail SMTP send failed", {
        to,
        provider: "gmail",
        code: err.code ?? null,
        smtpResponseCode: err.responseCode ?? null,
        smtpResponse: err.response ?? null,
        reason: err.message ?? String(error),
      });
      throw error;
    }
  }
}

/**
 * Sends email through Brevo's REST API (no SDK needed). Configure with
 * BREVO_API_KEY and BREVO_FROM (a sender email address verified in Brevo —
 * no domain required; Brevo verifies the address with a confirmation link).
 */
export class BrevoEmailSender implements AlertSender {
  private readonly name: string;
  private readonly email: string;

  constructor(
    private readonly apiKey: string,
    from: string,
  ) {
    const { name, email } = splitSender(from);
    if (!email) {
      throw new Error(
        "BREVO_FROM is required — set it to the email address you verified in Brevo (e.g. yourname@gmail.com).",
      );
    }
    this.name = name;
    this.email = email;
  }

  async send(to: string, message: AlertMessage): Promise<void> {
    const payload: Record<string, unknown> = {
      sender: { name: this.name, email: this.email },
      to: [{ email: to }],
      subject: message.subject,
      textContent: message.body,
    };
    if (message.html) {
      payload.htmlContent = message.html;
    }
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Brevo returned HTTP ${response.status}: ${detail}`);
    }
  }
}

/**
 * Splits a "Name <email>" string into its parts; plain emails get the name
 * "Sky Concierge".
 */
function splitSender(from: string): { name: string; email: string } {
  const match = /^([^<]+)\s*<([^>]+)>$/.exec(from.trim());
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: "Sky Concierge", email: from.trim() };
}

/**
 * Sends email through Resend's REST API (no SDK needed). Configure with
 * RESEND_API_KEY and optionally RESEND_FROM (a verified sender domain).
 */
export class ResendEmailSender implements AlertSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(to: string, message: AlertMessage): Promise<void> {
    const payload: Record<string, unknown> = {
      from: this.from,
      to: [to],
      subject: message.subject,
      text: message.body,
    };
    if (message.html) {
      payload.html = message.html;
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend returned HTTP ${response.status}: ${detail}`);
    }
  }
}

/**
 * Default sender: Gmail SMTP when GMAIL_USER + GMAIL_APP_PASSWORD are
 * configured (no domain, no provider approval), otherwise Brevo when
 * BREVO_API_KEY is configured, otherwise Resend when RESEND_API_KEY is
 * configured, otherwise the console — so the alert engine works out of the
 * box and upgrades in place.
 */
export function createSender(): AlertSender {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (gmailUser && gmailAppPassword) {
    return new GmailSmtpSender(gmailUser, gmailAppPassword);
  }
  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) {
    return new BrevoEmailSender(brevoKey, process.env.BREVO_FROM ?? "");
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return new ResendEmailSender(
      resendKey,
      process.env.RESEND_FROM ?? "Sky Concierge <onboarding@resend.dev>",
    );
  }
  return new ConsoleSender();
}

/**
 * Fallback sender: prints alerts to the console.
 */
export class ConsoleSender implements AlertSender {
  async send(to: string, message: AlertMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[sky-concierge] To: ${to}`);
    // eslint-disable-next-line no-console
    console.log(`[sky-concierge] Subject: ${message.subject}`);
    // eslint-disable-next-line no-console
    console.log(message.body);
    if (message.html) {
      // eslint-disable-next-line no-console
      console.log(`[sky-concierge] html: ${message.html.length} chars`);
    }
  }
}
