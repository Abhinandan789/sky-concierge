export interface AlertMessage {
  subject: string;
  body: string;
}

export interface AlertSender {
  send(to: string, message: AlertMessage): Promise<void>;
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
 * Default sender: real email when RESEND_API_KEY is configured, otherwise the
 * console — so the alert engine works out of the box and upgrades in place.
 */
export function createSender(): AlertSender {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return new ResendEmailSender(
      apiKey,
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
