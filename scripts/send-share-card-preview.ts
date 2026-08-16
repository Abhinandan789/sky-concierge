/**
 * Dev tool: render tonight's-sky share cards (landscape + square) and email
 * them to a recipient so the layout can be eyeballed without visiting the
 * site.
 *
 *   TO=you@example.com LOC=40.7128,-74.006  pnpm tsx scripts/send-share-card-preview.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nodemailer from "nodemailer";
import { renderShareCard } from "../src/services/sky/share-card";

// Load .env.local (tsx does not auto-load env files for plain scripts).
const envPath = resolve(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (match && !(match[1] in process.env)) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const to = process.env.TO?.trim();
if (!to) {
  throw new Error("TO=email@example.com is required");
}
const user = process.env.GMAIL_USER;
const appPassword = process.env.GMAIL_APP_PASSWORD;
if (!user || !appPassword) {
  throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD are required");
}

const [lat, lon] = (process.env.LOC ?? "40.7128,-74.006")
  .split(",")
  .map((part) => part.trim());

console.log("Rendering share cards…");
const landscape = await renderShareCard({ lat, lon, sat: "25544" });
const square = await renderShareCard({ lat, lon, sat: "25544", shape: "square" });
const [landscapePng, squarePng] = await Promise.all([
  Buffer.from(await landscape.arrayBuffer()),
  Buffer.from(await square.arrayBuffer()),
]);
console.log(
  `Landscape ${landscapePng.length} bytes · square ${squarePng.length} bytes`,
);

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user, pass: appPassword },
});

const subject = "Sky Concierge — tonight's sky share card preview";
await transporter.sendMail({
  from: `Sky Concierge <${user}>`,
  to,
  subject,
  text: "Tonight's sky share card — landscape and square crops are attached.",
  html: `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#04040c;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px;">
        Here are the two share cards for your location — the landscape crop
        (feeds, link previews) and the square crop (Instagram / WhatsApp
        statuses). The card shows tonight's verdict, the best satellite pass,
        moon status, and the site URL so a screenshot always points back to
        the tool.
      </p>
      <p style="color:#e2e8f0;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
        Feed (landscape) — 1200 × 630
      </p>
      <img src="cid:card-landscape" alt="Tonight's sky — landscape" style="width:100%;border-radius:14px;border:1px solid rgba(255,255,255,0.12);margin-bottom:28px;" />
      <p style="color:#e2e8f0;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
        Status (square) — 1080 × 1080
      </p>
      <img src="cid:card-square" alt="Tonight's sky — square" style="width:100%;max-width:420px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);margin-bottom:28px;" />
      <p style="color:#64748b;font-size:12px;line-height:1.6;margin:0;">
        Generated from live orbital, cloud and aurora data — the exact image
        the "Share this night" button produces on the site.
      </p>
    </div>
  </body>
</html>`,
  attachments: [
    {
      filename: "tonights-sky.png",
      content: landscapePng,
      cid: "card-landscape",
    },
    {
      filename: "tonights-sky-square.png",
      content: squarePng,
      cid: "card-square",
    },
  ],
});

console.log(`Sent "${subject}" to ${to} via Gmail SMTP`);
