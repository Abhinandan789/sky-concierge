import { describe, expect, it } from "vitest";

import {
  renderConfirmationEmail,
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
