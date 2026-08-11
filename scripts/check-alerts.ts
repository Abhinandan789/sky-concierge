import { logger } from "../src/lib/logger.ts";
import {
  runAlertCheck,
  runDigestCheck,
} from "../src/services/alerts/checker.ts";

const digest = process.argv.includes("--digest");
const startedAt = Date.now();

const result = digest ? await runDigestCheck() : await runAlertCheck();

logger.info(digest ? "Weekly digest run complete" : "Alert check complete", {
  digest,
  checked: result.checked,
  sent: result.sent,
  durationMs: Date.now() - startedAt,
});
