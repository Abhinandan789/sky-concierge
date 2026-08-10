import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { parseNumber, validateLatLon } from "@/lib/utils";
import { buildTonightBrief } from "@/services/sky/brief";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const lat = parseNumber(request.nextUrl.searchParams.get("lat"));
  const lon = parseNumber(request.nextUrl.searchParams.get("lon"));

  if (lat === null || lon === null) {
    return jsonError(
      "Query parameters 'lat' and 'lon' are required.",
      400,
      "MISSING_COORDINATES",
    );
  }

  const validation = validateLatLon(lat, lon);
  if (validation) {
    return jsonError(validation, 400, "INVALID_COORDINATES");
  }

  try {
    const brief = await buildTonightBrief({ lat, lon });
    return jsonOk(brief, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=600" },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Brief generation failed.",
      500,
      "BRIEF_FAILED",
    );
  }
}
