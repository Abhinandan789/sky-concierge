import type { Metadata, Viewport } from "next";
import "./globals.css";
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
        <Starfield />
        <div className="relative z-10">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}
