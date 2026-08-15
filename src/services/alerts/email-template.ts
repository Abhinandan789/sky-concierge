/**
 * HTML email templates. Emails are rendered as table-based HTML with inline
 * styles — the widest-compatible approach across Gmail, Outlook, Apple Mail,
 * and mobile clients.
 *
 * The shared shell paints a CSS-only night sky: a deep navy wash, soft
 * aurora glows, and a field of stars built from layered radial gradients —
 * no images, no data URIs, nothing to block. Clients that strip gradients
 * (Outlook desktop, Yahoo) fall back to a solid dark `background-color`, so
 * the email still reads as a dark, polished piece. Everything here is pure
 * string composition (no React, no CSS files), so it runs in any Node
 * context and is trivially unit-testable.
 */

export interface ConfirmationEmailOptions {
  /** Full confirmation URL (already absolute). */
  confirmUrl: string;
  /** True when the email confirms a change to an existing subscription. */
  pendingChange?: boolean;
}

/** A labelled fact row in an alert email (e.g. label "Rises", value "22:14"). */
export interface AlertFact {
  label: string;
  value: string;
}

export interface AlertEmailOptions {
  /** Small uppercase label above the title, e.g. "SATELLITE PASS". */
  eyebrow: string;
  title: string;
  /** One or two sentences of context under the title. */
  intro: string;
  /** Key facts rendered as label/value rows. */
  facts: AlertFact[];
  /** Optional small print under the facts. */
  note?: string;
  /** Accent hex (eyebrow + fact labels). Defaults to the cyan brand color. */
  accent?: string;
  /** Full unsubscribe URL; when set, the footer links to it. */
  unsubscribeUrl?: string;
}

export interface DigestSection {
  title: string;
  items: string[];
}

export interface DigestEmailOptions {
  /** e.g. "Tuesday, August 11, 2026". */
  dateLabel: string;
  /** Content sections, rendered in order. */
  sections: DigestSection[];
  /** Shown prominently when there is nothing notable to report. */
  quietNote?: string;
  /** Full unsubscribe URL; when set, the footer links to it. */
  unsubscribeUrl?: string;
}

/** Escape dynamic values so a token or address can never break the markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Deep-space palette shared with the site. */
const C = {
  page: "#070a16",
  card: "#0f1528",
  cardBorder: "#26314f",
  text: "#e6edf7",
  muted: "#9aa7bd",
  faint: "#77839c",
  accent: "#22d3ee",
  divider: "rgba(255,255,255,0.07)",
  ctaFrom: "#06b6d4",
  ctaTo: "#6366f1",
};

/**
 * A field of stars built to match the site's animated canvas starfield
 * (src/components/starfield.tsx): ice-blue rgba(226,232,255) dots of varied
 * size and brightness, plus a couple of faint meteor streaks. Generated
 * deterministically (seeded PRNG) so the rendered HTML is stable across
 * builds and test runs. Pure CSS — no images to block, no data URIs.
 *
 * Gmail-safe baseline: a static multi-layer background-image (inline style)
 * that renders everywhere. Twinkle is added as a <style>-block progressive
 * enhancement — Gmail and Outlook ignore animations entirely and show the
 * static field, while Apple Mail / iOS Mail snap a subset of stars
 * bright/dim and breathe the base wash, echoing the canvas's sine-wave
 * alpha pulse.
 */

interface StarSpec {
  x: number;
  y: number;
  size: number;
  alpha: number;
  tint: "white" | "ice" | "violet";
}

/** Deterministic PRNG so the starfield is identical on every render. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_TINTS = [
  [226, 232, 255], // ice-white — the site's primary star color
  [226, 232, 255],
  [226, 232, 255],
  [190, 227, 255], // ice-blue
  [196, 181, 253], // faint violet
] as const;

/** ~75 stars scattered across the canvas, denser toward the top like the site. */
function buildStars(): StarSpec[] {
  const rand = mulberry32(0x5ca15e);
  const stars: StarSpec[] = [];
  for (let i = 0; i < 75; i += 1) {
    // Denser above the horizon line (~65% of the height) like a real night sky.
    const y = rand() * 0.62 + 0.02;
    const x = rand() * 0.94 + 0.03;
    const hero = rand() > 0.88; // a few standout stars, like the site's bright ones
    const size = hero ? 1.6 + rand() * 0.7 : 0.5 + rand() * 1.0;
    const alpha = hero ? 0.85 + rand() * 0.15 : 0.3 + rand() * 0.55;
    const tintRoll = rand();
    const tint: StarSpec["tint"] =
      tintRoll > 0.8 ? "ice" : tintRoll > 0.92 ? "violet" : "white";
    stars.push({ x, y, size, alpha, tint });
  }
  return stars;
}

const STARS = buildStars();

/** One radial-gradient layer per star; larger stars get a soft glow halo. */
function starLayer(star: StarSpec, alphaScale = 1): string {
  const [r, g, b] = STAR_TINTS[star.tint === "white" ? 0 : star.tint === "ice" ? 3 : 4];
  const alpha = Math.max(0.05, star.alpha * alphaScale);
  const { x, y, size } = star;
  if (size >= 1.6) {
    return (
      `radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, ` +
      `rgba(${r},${g},${b},${alpha.toFixed(2)}) 0 ${(size * 0.55).toFixed(2)}px, ` +
      `rgba(${r},${g},${b},${(alpha * 0.32).toFixed(2)}) ${(size * 0.9).toFixed(2)}px, ` +
      `transparent ${(size * 1.6).toFixed(2)}px)`
    );
  }
  return (
    `radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, ` +
    `rgba(${r},${g},${b},${alpha.toFixed(2)}) 0 ${size.toFixed(2)}px, ` +
    `transparent ${(size + 0.9).toFixed(2)}px)`
  );
}

/** The ~14 stars that twinkle (the brighter half of the field). */
const TWINKLE_INDICES = STARS.map((s, i) => ({ s, i }))
  .filter(({ s }) => s.size >= 0.95)
  .slice(0, 14)
  .map(({ i }) => i);

const METEORS = [
  // Two faint streaks like the site's occasional shooting stars.
  "radial-gradient(ellipse 120px 1.5px at 22% 15%, rgba(255,255,255,0.7), rgba(255,255,255,0) 68%)",
  "radial-gradient(ellipse 70px 1px at 74% 6%, rgba(255,255,255,0.45), rgba(255,255,255,0) 68%)",
];

/**
 * The base sky: soft cyan + violet aurora glows near the top, over a deep
 * navy vertical wash. Bottom layer — the stars render on top of it.
 */
const SKY_GLOWS =
  "radial-gradient(ellipse 120% 60% at 50% -20%, rgba(34,211,238,0.16), transparent 60%), " +
  "radial-gradient(ellipse 90% 50% at 85% -5%, rgba(129,140,248,0.14), transparent 55%), " +
  "linear-gradient(180deg, #0c1226 0%, #070a16 48%, #0a0d1c 100%)";

/** The static (Gmail-safe) starfield: stars + meteors + aurora glows. */
const STARS_STATIC = [
  ...STARS.map((s) => starLayer(s)),
  ...METEORS,
  SKY_GLOWS,
].join(", ");

/** The dimmed variant used by the twinkle animation's "off" phase. */
const STARS_TWINKLE_DIM = [
  ...STARS.map((s, i) =>
    TWINKLE_INDICES.includes(i) ? starLayer(s, 0.35) : starLayer(s),
  ),
  ...METEORS,
  SKY_GLOWS,
].join(", ");

/**
 * Twinkle + breathing, inside a <style> block. Gmail and Outlook ignore
 * animations entirely (the inline STARS_STATIC stays put); Apple Mail and
 * iOS Mail run it: a subset of stars snap dim/bright and the wash breathes.
 */
const TWINKLE_CSS = `
  @keyframes skyConciergeTwinkle {
    0%, 60%, 100% { background-image: ${STARS_STATIC}; }
    30% { background-image: ${STARS_TWINKLE_DIM}; }
  }
  @keyframes skyConciergeBreath {
    0%, 100% { background-color: #070a16; }
    50% { background-color: #0c1124; }
  }
  .sky-concierge-sky {
    animation: skyConciergeTwinkle 5.5s ease-in-out infinite,
               skyConciergeBreath 11s ease-in-out infinite;
  }
`;
const DEFAULT_FOOTER =
  "You are receiving this because you subscribed to Sky Concierge.<br>Every alert email includes a one-click unsubscribe link.";

/**
 * The email shell: a star-field sky, the brand wordmark, a glassy card with
 * a gradient ribbon, and a quiet footer. `preheader` is the hidden preview
 * text shown next to the subject line. `footerHtml` replaces the default
 * footer when provided (e.g. to link the actual unsubscribe URL).
 */
export function renderEmailShell(options: {
  preheader: string;
  children: string;
  footerHtml?: string;
}): string {
  const { preheader, children, footerHtml } = options;
  const footer = footerHtml ?? DEFAULT_FOOTER;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Sky Concierge</title>
<style>${TWINKLE_CSS}</style>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" class="sky-concierge-sky" style="background-color:${C.page};background-image:${STARS_STATIC};">
  <tr>
    <td align="center" style="padding:40px 16px 32px;">
      <!-- Brand wordmark -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 26px;">
        <tr>
          <td align="center" style="font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:0.5px;color:${C.text};">
            <span style="color:${C.accent};">✦</span>&nbsp; SKY CONCIERGE &nbsp;<span style="color:${C.faint};">✧</span>
          </td>
        </tr>
        <tr>
          <td align="center" style="font-family:${FONT};font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:${C.faint};padding-top:7px;">
            Let the sky come to you
          </td>
        </tr>
      </table>

      <!-- Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate;">
        <tr>
          <td style="border-radius:22px;border:1px solid ${C.cardBorder};background-color:${C.card};box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);padding:40px 36px 36px;">
            <!-- Gradient ribbon: a slice of aurora across the top of the card -->
            <div style="height:5px;border-radius:999px;background-image:linear-gradient(90deg,#22d3ee,#818cf8,#a78bfa);margin:0 0 26px;"></div>
            ${children}
          </td>
        </tr>
      </table>

      <!-- Footer -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 0;max-width:520px;">
        <tr>
          <td align="center" style="font-family:${FONT};font-size:11px;line-height:18px;color:${C.faint};">
            ${footer}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:10px;font-family:${FONT};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(119,131,156,0.55);">
            ✦ &nbsp;ISS · aurora · meteors&nbsp; ✦
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

/** Shared opener for alert-style emails: eyebrow, title, intro. */
function renderAlertHead(options: {
  eyebrow: string;
  title: string;
  intro: string;
  accent: string;
}): string {
  const { accent } = options;
  return `
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${accent};">
            <span style="color:${C.faint};">—</span>&nbsp; ${esc(options.eyebrow)} &nbsp;<span style="color:${C.faint};">—</span>
          </td>
        </tr>
      </table>
      <h1 style="margin:12px 0 0;font-family:${FONT};font-size:26px;font-weight:700;color:${C.text};letter-spacing:-0.3px;">
        ${esc(options.title)}
      </h1>
      <p style="margin:12px auto 0;max-width:460px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">
        ${esc(options.intro)}
      </p>`;
}

function renderFactRows(facts: AlertFact[], accent: string): string {
  if (facts.length === 0) {
    return "";
  }
  return facts
    .map(
      (fact, index) => `
      <tr>
        <td style="width:100px;padding:11px 0;border-bottom:${index === facts.length - 1 ? "0" : `1px solid ${C.divider}`};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${accent};vertical-align:top;">
          ${esc(fact.label)}
        </td>
        <td style="padding:11px 0;border-bottom:${index === facts.length - 1 ? "0" : `1px solid ${C.divider}`};font-family:${FONT};font-size:14px;line-height:22px;color:${C.text};">
          ${esc(fact.value)}
        </td>
      </tr>`,
    )
    .join("");
}

/** Footer used by alert emails: unsubscribe link when one is available. */
function alertFooter(unsubscribeUrl?: string): string | undefined {
  if (!unsubscribeUrl) {
    return undefined;
  }
  return `You are receiving this because you subscribed to Sky Concierge.<br><a href="${esc(unsubscribeUrl)}" target="_blank" style="color:${C.accent};text-decoration:underline;">Unsubscribe from these alerts</a>`;
}

/** A single due-alert email (satellite pass, aurora, or meteor shower). */
export function renderAlertEmail(options: AlertEmailOptions): string {
  const { eyebrow, title, intro, facts, note, unsubscribeUrl } = options;
  const accent = options.accent ?? C.accent;
  const noteHtml = note
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;">
        <tr>
          <td style="border-top:1px solid ${C.divider};padding-top:14px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">
            <span style="color:${accent};">✦</span>&nbsp; ${esc(note)}
          </td>
        </tr>
      </table>`
    : "";

  return renderEmailShell({
    preheader: `${eyebrow} — ${title}`,
    footerHtml: alertFooter(unsubscribeUrl),
    children: `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center">
      ${renderAlertHead({ eyebrow, title, intro, accent })}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;">
        ${renderFactRows(facts, accent)}
      </table>
      ${noteHtml}
    </td>
  </tr>
</table>`,
  });
}

/** The weekly sky-highlights digest. */
export function renderDigestEmail(options: DigestEmailOptions): string {
  const { dateLabel, sections, quietNote, unsubscribeUrl } = options;

  const sectionHtml = sections
    .map(
      (section) => `
      <tr>
        <td style="padding:20px 0 4px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.accent};">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-image:linear-gradient(135deg,#22d3ee,#a78bfa);margin-right:8px;vertical-align:1px;"></span>${esc(section.title)}
        </td>
      </tr>
      ${section.items
        .map(
          (item) => `
      <tr>
        <td style="padding:5px 0;border-bottom:1px solid ${C.divider};font-family:${FONT};font-size:14px;line-height:22px;color:${C.text};">
          <span style="color:${C.faint};">✦</span>&nbsp; ${esc(item)}
        </td>
      </tr>`,
        )
        .join("")}`,
    )
    .join("");

  const quietHtml = quietNote
    ? `
      <p style="margin:18px 0 0;font-family:${FONT};font-size:15px;line-height:24px;color:${C.muted};">
        <span style="color:${C.accent};">✦</span>&nbsp; ${esc(quietNote)}
      </p>`
    : "";

  return renderEmailShell({
    preheader: "Weekly sky highlights",
    footerHtml: alertFooter(unsubscribeUrl),
    children: `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center">
      ${renderAlertHead({
        eyebrow: "WEEKLY DIGEST",
        title: "Sky highlights",
        intro: `The week ahead for your location — ${esc(dateLabel)}.`,
        accent: C.accent,
      })}
      ${quietHtml}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 0;">
        ${sectionHtml}
      </table>
    </td>
  </tr>
</table>`,
  });
}

/** The double-opt-in email: a friendly CTA button plus the raw link as fallback. */
export function renderConfirmationEmail(
  options: ConfirmationEmailOptions,
): string {
  const { confirmUrl, pendingChange = false } = options;
  const url = esc(confirmUrl);

  const heading = pendingChange
    ? "Confirm your changes"
    : "Confirm your email";
  const intro = pendingChange
    ? "We received a request to update your Sky Concierge subscription. Confirm below and the new settings will go live right away."
    : "Almost there. Confirm your address and alerts start the moment something worth looking at passes over your location.";
  const buttonLabel = pendingChange ? "Apply my changes" : "Confirm my subscription";
  const fallbackNote =
    "If the button doesn't work, copy and paste the link below into your browser.";
  const ignoreNote = pendingChange
    ? "If you didn't request this change, you can safely ignore this email — your subscription stays exactly as it is."
    : "If you didn't request this, you can safely ignore this email — nothing changes.";
  const spamHint =
    "Can't find this email? Check your spam folder and mark Sky Concierge as \u201cnot spam\u201d — new senders occasionally land there on the first email.";

  return renderEmailShell({
    preheader: `${heading} — one click and you're set.`,
    children: `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center">
      <!-- Satellite badge with a starlit ring -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>
          <td align="center" style="width:72px;height:72px;border-radius:50%;border:1px solid rgba(34,211,238,0.35);box-shadow:0 0 24px rgba(34,211,238,0.25);">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" style="width:60px;height:60px;border-radius:50%;background-color:#1c2c4a;background-image:linear-gradient(135deg,#0ea5e9,#6366f1);">
                  <span style="font-size:28px;line-height:60px;">🛰️</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <h1 style="margin:22px 0 0;font-family:${FONT};font-size:26px;font-weight:700;color:${C.text};letter-spacing:-0.3px;">
        ${heading}
      </h1>
      <p style="margin:12px auto 0;max-width:440px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">
        ${intro}
      </p>

      <!-- CTA button (solid-color fallback for clients without gradients) -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px auto 6px;">
        <tr>
          <td style="border-radius:14px;background-color:${C.ctaFrom};background-image:linear-gradient(135deg,${C.ctaFrom},${C.ctaTo});box-shadow:0 8px 24px rgba(6,182,212,0.25);">
            <a href="${url}" target="_blank" style="display:inline-block;padding:15px 38px;border-radius:14px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
              ${buttonLabel}
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint};">
        ${fallbackNote}
      </p>
      <p style="margin:4px 0 0;font-family:${FONT};font-size:12px;line-height:18px;">
        <a href="${url}" target="_blank" style="color:${C.accent};text-decoration:underline;word-break:break-all;">${url}</a>
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;">
        <tr>
          <td style="border-top:1px solid ${C.divider};padding-top:16px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint};">
            ${ignoreNote}
          </td>
        </tr>
        <tr>
          <td style="padding-top:10px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint};">
            ${spamHint}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  });
}
