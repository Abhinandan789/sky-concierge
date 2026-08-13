import { describe, expect, it } from "vitest";

import {
  renderAlertEmail,
  renderConfirmationEmail,
  renderDigestEmail,
  renderEmailShell,
} from "./email-template";

describe("renderEmailShell", () => {
  it("renders a complete HTML document with the brand header and footer", () => {
    const html = renderEmailShell({ preheader: "Preview text", children: "<p>hi</p>" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("SKY CONCIERGE");
    expect(html).toContain("Let the sky come to you");
    expect(html).toContain("<p>hi</p>");
    // Hidden preheader text is present.
    expect(html).toContain("Preview text");
  });

  it("escapes the preheader so dynamic text cannot break the markup", () => {
    const html = renderEmailShell({
      preheader: "a<b>&c",
      children: "",
    });
    expect(html).toContain("a&lt;b&gt;&amp;c");
    expect(html).not.toContain("<b>");
  });
});

describe("renderConfirmationEmail", () => {
  it("embeds the confirmation URL in both the button and the fallback link", () => {
    const url = "https://sky-concierge-six.vercel.app/verify?token=abc123";
    const html = renderConfirmationEmail({ confirmUrl: url });
    // Button link.
    expect(html).toContain(`href="${url}"`);
    // Fallback plain-text link.
    expect(html).toContain(url);
    expect(html).toContain("Confirm my subscription");
    expect(html).toContain("Confirm your email");
  });

  it("switches copy and CTA for a pending-change confirmation", () => {
    const html = renderConfirmationEmail({
      confirmUrl: "https://example.com/verify?token=xyz",
      pendingChange: true,
    });
    expect(html).toContain("Confirm your changes");
    expect(html).toContain("Apply my changes");
    expect(html).toContain("your subscription stays exactly as it is");
    expect(html).not.toContain("Confirm my subscription");
  });

  it("escapes the URL before embedding it in markup", () => {
    const html = renderConfirmationEmail({
      confirmUrl: "https://example.com/verify?token=a\"onmouseover=\"alert(1)",
    });
    expect(html).not.toContain(`"onmouseover=`);
  });
});

describe("renderAlertEmail", () => {
  it("renders eyebrow, title, intro and labelled fact rows", () => {
    const html = renderAlertEmail({
      eyebrow: "Satellite pass",
      title: "ISS in ~45 min",
      intro: "Get ready — a pass is coming up.",
      facts: [
        { label: "Rises", value: "22:14" },
        { label: "Look", value: "Southwest at 22:20 — no telescope needed" },
      ],
      note: "Find a dark spot.",
    });
    expect(html).toContain("Satellite pass");
    expect(html).toContain("ISS in ~45 min");
    expect(html).toContain("Rises");
    expect(html).toContain("22:14");
    expect(html).toContain("Find a dark spot.");
  });

  it("links the unsubscribe URL in the footer when provided", () => {
    const html = renderAlertEmail({
      eyebrow: "Meteor shower",
      title: "Perseids tonight",
      intro: "Up to 100 meteors an hour.",
      facts: [{ label: "Rate", value: "100/hr" }],
      unsubscribeUrl: "https://sky-concierge-six.vercel.app/unsubscribe?token=xyz",
    });
    expect(html).toContain(
      'href="https://sky-concierge-six.vercel.app/unsubscribe?token=xyz"',
    );
    expect(html).toContain("Unsubscribe from these alerts");
  });

  it("escapes fact values so satellite data cannot break the markup", () => {
    const html = renderAlertEmail({
      eyebrow: "Satellite pass",
      title: "ISS <s>now</s>",
      intro: "intro",
      facts: [{ label: "Look", value: "a<b>&c" }],
    });
    expect(html).toContain("ISS &lt;s&gt;now&lt;/s&gt;");
    expect(html).toContain("a&lt;b&gt;&amp;c");
  });
});

describe("renderDigestEmail", () => {
  it("renders the date and each section with items", () => {
    const html = renderDigestEmail({
      dateLabel: "Tuesday, August 11, 2026",
      sections: [
        { title: "Satellite passes", items: ["22:14 — ISS, max 45° for 6 min"] },
        { title: "Moon", items: ["Waxing Gibbous, 85% illuminated"] },
      ],
    });
    expect(html).toContain("Tuesday, August 11, 2026");
    expect(html).toContain("Satellite passes");
    expect(html).toContain("22:14 — ISS, max 45° for 6 min");
    expect(html).toContain("Waxing Gibbous, 85% illuminated");
  });

  it("shows the quiet note when there is nothing notable", () => {
    const html = renderDigestEmail({
      dateLabel: "Tuesday, August 11, 2026",
      sections: [{ title: "Moon", items: ["New Moon, 2% illuminated"] }],
      quietNote: "Nothing notable this week — the sky is quiet.",
    });
    expect(html).toContain("Nothing notable this week — the sky is quiet.");
  });
});
