export interface AlertMessage {
  subject: string;
  body: string;
}

export interface AlertSender {
  send(to: string, message: AlertMessage): Promise<void>;
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
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: this.name, email: this.email },
        to: [{ email: to }],
        subject: message.subject,
        textContent: message.body,
      }),
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
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject: message.subject,
        text: message.body,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend returned HTTP ${response.status}: ${detail}`);
    }
  }
}

/**
 * Default sender: Brevo when BREVO_API_KEY is configured (works with a
 * verified email address, no domain needed), otherwise Resend when
 * RESEND_API_KEY is configured, otherwise the console — so the alert engine
 * works out of the box and upgrades in place.
 */
export function createSender(): AlertSender {
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
  }
}
