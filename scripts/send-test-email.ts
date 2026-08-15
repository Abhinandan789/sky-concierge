/**
 * Dev tool: send a sample styled email through the configured provider
 * (GMAIL_USER + GMAIL_APP_PASSWORD preferred) so the templates can be
 * eyeballed without waiting for a real alert.
 *
 *   TO=you@example.com                        pnpm tsx scripts/send-test-email.ts
 *   TO=you@example.com KIND=digest            pnpm tsx scripts/send-test-email.ts
 *   TO=you@example.com KIND=pass              pnpm tsx scripts/send-test-email.ts
 *   KIND=confirm ONLY_RENDER=1                pnpm tsx scripts/send-test-email.ts   # write HTML, don't send
 *
 * KIND: confirm (default) | digest | pass | aurora | meteor
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { siteUrl } from "../src/config/site";
import {
  renderAlertEmail,
  renderConfirmationEmail,
  renderDigestEmail,
} from "../src/services/alerts/email-template";
import { createSender } from "../src/services/alerts/sender";

// Load .env.local (tsx does not auto-load env files for plain scripts).
const envPath = resolve(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (match && !(match[1] in process.env)) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const kind = process.env.KIND ?? "confirm";
const to = process.env.TO?.trim();
const onlyRender = process.env.ONLY_RENDER === "1";

function sampleMessage(): { subject: string; html: string } {
  const confirmUrl = `${siteUrl()}/confirm?token=sample-token-123`;
  switch (kind) {
    case "digest":
      return {
        subject: "Sky Concierge — weekly sky highlights",
        html: renderDigestEmail({
          dateLabel: "Saturday, August 15, 2026",
          sections: [
            {
              title: "Satellite passes",
              items: [
                "09:58 PM — ISS (ZARYA), max 76.9° for 7 min",
                "04:12 AM — Tiangong, max 33.5° for 5 min",
              ],
            },
            {
              title: "Meteor showers",
              items: ["Perseids peak in 4 days (~100/hr, moon 45% up)"],
            },
            {
              title: "Aurora watch",
              items: ["Predicted Kp 3.0 (Low). Mainly visible above ~65° latitude."],
            },
            { title: "Moon", items: ["Waxing Crescent, 8% illuminated."] },
          ],
          unsubscribeUrl: `${siteUrl()}/unsubscribe?token=sample-token-123`,
        }),
      };
    case "pass":
      return {
        subject: "ISS pass in ~35 min over your location",
        html: renderAlertEmail({
          eyebrow: "Satellite pass",
          title: "ISS (ZARYA) in ~35 min",
          intro:
            "Get ready — an ISS pass is coming up over your location. No telescope needed.",
          facts: [
            { label: "Rises", value: "09:58 PM" },
            { label: "Peak", value: "76.9° elevation for 7 minutes" },
            { label: "Look", value: "West-southwest at 10:01 PM" },
          ],
          note: "Find a spot with a clear view of the horizon.",
          unsubscribeUrl: `${siteUrl()}/unsubscribe?token=sample-token-123`,
        }),
      };
    case "aurora":
      return {
        subject: "Aurora watch tonight — Kp 5",
        html: renderAlertEmail({
          eyebrow: "Aurora alert",
          title: "Aurora watch tonight",
          intro: "The forecast predicts active aurora conditions in the next 12 hours.",
          accent: "#a78bfa",
          facts: [
            { label: "Intensity", value: "Predicted Kp 5 (Moderate)" },
            { label: "Where", value: "Visible at your latitude near the horizon" },
          ],
          note: "Find a dark spot with a clear northern view.",
          unsubscribeUrl: `${siteUrl()}/unsubscribe?token=sample-token-123`,
        }),
      };
    case "meteor":
      return {
        subject: "Perseids peak tonight ✨",
        html: renderAlertEmail({
          eyebrow: "Meteor shower",
          title: "Perseids — peak tonight",
          intro: "Up to 100 meteors an hour at the peak.",
          accent: "#e879f9",
          facts: [
            { label: "Peak date", value: "Tonight" },
            { label: "Rate", value: "up to 100 meteors/hour" },
          ],
          note: "Best viewing after midnight, away from city lights.",
          unsubscribeUrl: `${siteUrl()}/unsubscribe?token=sample-token-123`,
        }),
      };
    default:
      return {
        subject: "Confirm your Sky Concierge subscription",
        html: renderConfirmationEmail({ confirmUrl }),
      };
  }
}

const { subject, html } = sampleMessage();

if (onlyRender) {
  const out = resolve(process.cwd(), "scripts/email-preview.html");
  writeFileSync(out, html, "utf8");
  console.log(`Rendered ${kind} email (${html.length} chars) -> ${out}`);
} else {
  if (!to) {
    throw new Error("TO=email@example.com is required to send");
  }
  const sender = createSender();
  await sender.send(to, { subject, body: "See the styled HTML version of this email.", html });
  console.log(`Sent "${subject}" to ${to} via ${sender.constructor.name}`);
}
