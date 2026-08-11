import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — your night sky, curated`,
    short_name: "Sky Concierge",
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#04040c",
    theme_color: "#04040c",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
