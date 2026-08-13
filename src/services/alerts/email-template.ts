/**
 * HTML email templates. Emails are rendered as table-based HTML with inline
 * styles — the widest-compatible approach across Gmail, Outlook, Apple Mail,
 * and mobile clients. Everything here is pure string composition (no React,
 * no CSS files), so it runs in any Node context and is trivially unit-testable.
 */

export interface ConfirmationEmailOptions {
  /** Full confirmation URL (already absolute). */
  confirmUrl: string;
  /** True when the email confirms a change to an existing subscription. */
  pendingChange?: boolean;
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

/** Dark space palette shared with the site. */
const C = {
  page: "#0a0c10",
  card: "#141926",
  cardBorder: "#232b3d",
  text: "#e6edf7",
  muted: "#9aa7bd",
  faint: "#77839c",
  accent: "#22d3ee",
  ctaFrom: "#06b6d4",
  ctaTo: "#6366f1",
};

/**
 * The email shell: brand wordmark, a centered card, and a quiet footer.
 * `preheader` is the hidden preview text shown next to the subject line.
 */
export function renderEmailShell(options: {
  preheader: string;
  children: string;
}): string {
  const { preheader, children } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Sky Concierge</title>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.page};">
  <tr>
    <td align="center" style="padding:36px 16px 32px;">
      <!-- Brand wordmark -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
        <tr>
          <td align="center" style="font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:0.5px;color:${C.text};">
            <span style="color:${C.accent};">✦</span>&nbsp; SKY CONCIERGE &nbsp;<span style="color:${C.faint};">✧</span>
          </td>
        </tr>
        <tr>
          <td align="center" style="font-family:${FONT};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};padding-top:6px;">
            Let the sky come to you
          </td>
        </tr>
      </table>

      <!-- Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate;">
        <tr>
          <td style="border-radius:20px;border:1px solid ${C.cardBorder};background-color:${C.card};padding:40px 36px 36px;">
            ${children}
          </td>
        </tr>
      </table>

      <!-- Footer -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 0;max-width:520px;">
        <tr>
          <td align="center" style="font-family:${FONT};font-size:11px;line-height:18px;color:${C.faint};">
            You are receiving this because you subscribed to Sky Concierge.<br>
            Every alert email includes a one-click unsubscribe link.
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
  const fallbackNote = pendingChange
    ? "If the button doesn't work, copy and paste this link into your browser."
    : "If the button doesn't work, copy and paste this link into your browser.";
  const ignoreNote = pendingChange
    ? "If you didn't request this change, you can safely ignore this email — your subscription stays exactly as it is."
    : "If you didn't request this, you can safely ignore this email — nothing changes.";

  return renderEmailShell({
    preheader: `${heading} — one click and you're set.`,
    children: `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="width:60px;height:60px;border-radius:50%;background-color:#1c2c4a;background-image:linear-gradient(135deg,#0ea5e9,#6366f1);">
            <span style="font-size:26px;line-height:60px;">🛰️</span>
          </td>
        </tr>
      </table>
      <h1 style="margin:22px 0 0;font-family:${FONT};font-size:24px;font-weight:700;color:${C.text};letter-spacing:-0.2px;">
        ${heading}
      </h1>
      <p style="margin:12px auto 0;max-width:440px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">
        ${intro}
      </p>

      <!-- CTA button (solid-color fallback for clients without gradients) -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px auto 6px;">
        <tr>
          <td style="border-radius:14px;background-color:${C.ctaFrom};background-image:linear-gradient(135deg,${C.ctaFrom},${C.ctaTo});">
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

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
        <tr>
          <td style="border-top:1px solid ${C.cardBorder};padding-top:18px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint};">
            ${ignoreNote}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  });
}
