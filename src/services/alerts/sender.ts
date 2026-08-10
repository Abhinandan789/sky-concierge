export interface AlertMessage {
  subject: string;
  body: string;
}

export interface AlertSender {
  send(to: string, message: AlertMessage): Promise<void>;
}

/**
 * Default sender: prints alerts to the console. To ship real notifications,
 * implement AlertSender with a provider (Resend/SES for email, or a push
 * service) and wire it into runAlertCheck.
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
