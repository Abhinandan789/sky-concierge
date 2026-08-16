import { renderShareCard } from "@/services/sky/share-card";

export const alt = "Tonight's sky verdict for your location";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The card summarizes "tonight" — an hour of edge caching keeps crawlers and
// chat-previews fast without serving an obviously stale night.
export const revalidate = 3600;

/**
 * Personalized Open Graph image: whatever ?lat=&lon=&sat= the shared page URL
 * carries, the preview shows that exact night's verdict card (same renderer
 * as /api/share-card, so the preview and the downloaded card never differ).
 */
export default async function OpenGraphImage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const value = (key: string) => {
    const entry = sp?.[key];
    return typeof entry === "string" ? entry : null;
  };
  return renderShareCard({
    lat: value("lat"),
    lon: value("lon"),
    sat: value("sat"),
  });
}
