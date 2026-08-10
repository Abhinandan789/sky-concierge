import { runAlertCheck } from "../src/services/alerts/checker.ts";

const result = await runAlertCheck();
// eslint-disable-next-line no-console
console.log(
  `[sky-concierge] Checked ${result.checked} subscription(s), sent ${result.sent} alert(s).`,
);
