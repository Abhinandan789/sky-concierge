import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RememberedLocation } from "@/components/remembered-location";
import { Starfield } from "@/components/starfield";
import { Toaster } from "@/components/sonner";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE, siteUrl } from "@/config/site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s — ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  // Google Search Console ownership proof — renders as
  // <meta name="google-site-verification" content="..."> in <head>.
  verification: {
    google: "AEeCrpqI0OmMFTZQuOPX1PDxT0dN4IYB5T_gUA0svvo",
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: APP_NAME,
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_DESCRIPTION,
    locale: "en_US",
    // The image is generated per-location by opengraph-image.tsx, so shared
    // links with ?lat=&lon= preview that exact night's verdict card.
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#04040c",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* Restore red-light mode before first paint so dark adaptation
            isn't broken by a flash of the normal palette on reload. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("sky-concierge:red-night")==="1"){document.documentElement.classList.add("red-night")}}catch(e){}`,
          }}
        />
        <Starfield />
        <RememberedLocation />
        {/* Structured data — helps search engines understand the site, and
            lets the result snippet carry a brand name + description. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "WebSite",
                  name: APP_NAME,
                  url: siteUrl(),
                  description: APP_DESCRIPTION,
                },
                {
                  "@type": "Organization",
                  name: APP_NAME,
                  url: siteUrl(),
                  description: APP_DESCRIPTION,
                },
              ],
            }),
          }}
        />
        <div className="relative z-10">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}
