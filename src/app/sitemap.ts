import type { MetadataRoute } from "next";
import { siteUrl } from "@/config/site";

/**
 * Sitemap for search engines. The site is a single page whose state lives in
 * query params (?lat=&lon=&sat=), so we advertise the canonical URL only —
 * the personalized combinations are infinite and would dilute crawl budget.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl(),
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
