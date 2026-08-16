import { NextRequest } from "next/server";
import { renderShareCard } from "@/services/sky/share-card";

export const runtime = "nodejs";

/**
 * GET /api/share-card?lat=..&lon=..&sat=.. → 1200×630 PNG of "tonight's sky"
 * for that location. The Share button fetches this image to share/download,
 * and it doubles as the page's Open Graph image, so a shared link's preview
 * is the same picture a stargazer sends to friends.
 */
export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const shape =
    searchParams.get("shape") === "square" ? ("square" as const) : undefined;
  const response = await renderShareCard({
    lat: searchParams.get("lat"),
    lon: searchParams.get("lon"),
    sat: searchParams.get("sat"),
    shape,
  });
  // "Tonight" data — safe to cache for an hour at the edge, revalidated in
  // the background after that (the underlying TLE/cloud fetches are TTL-cached
  // server-side, so a stale edge copy is never worse than "last hour's sky").
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400",
  );
  return response;
}
