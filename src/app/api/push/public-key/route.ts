import { jsonOk } from "@/lib/api";
import { publicVapidKey } from "@/services/alerts/push";

export const runtime = "nodejs";

/** Browser clients ask for the VAPID public key before subscribing to push. */
export async function GET() {
  const publicKey = publicVapidKey();
  if (!publicKey) {
    return jsonOk({ publicKey: null });
  }
  return jsonOk({ publicKey });
}
