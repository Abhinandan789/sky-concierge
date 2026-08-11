import { jsonOk } from "@/lib/api";
import { computeMoonTrack } from "@/services/sky/moon-track";

export const runtime = "nodejs";

/**
 * The Moon's current sub-point and ground track (past 60 min → next 180 min).
 * Pure local computation (astronomy-engine), so no upstream dependency; the
 * client refetches each minute while the globe/radar animate between fetches.
 */
export async function GET() {
  return jsonOk(computeMoonTrack(), {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=120" },
  });
}
