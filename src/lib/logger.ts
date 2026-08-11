type LogLevel = "info" | "warn" | "error";

/**
 * Minimal structured logger — one JSON line per event with a timestamp, so
 * logs are grep-able and machine-parseable wherever the app runs.
 */
export function log(
  level: LogLevel,
  message: string,
  meta: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: "sky-concierge",
    message,
    ...meta,
  });
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) =>
    log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    log("error", message, meta),
};
