import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RememberedLocation } from "@/components/remembered-location";
import { Starfield } from "@/components/starfield";
import { Toaster } from "@/components/sonner";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/config/site";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s — ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
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
        <div className="relative z-10">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}
