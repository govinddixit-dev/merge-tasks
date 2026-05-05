/**
 * Structured logger with correlation ID support.
 *
 * Every incoming HTTP request is assigned a unique correlation ID (via the
 * requestLogger middleware). That ID is stored in an AsyncLocalStorage context
 * so that every log line emitted during that request automatically includes it.
 * This makes it trivial to trace a single user's request across all log lines.
 *
 * Usage:
 *   import { getLogger } from "./logger";
 *   const log = getLogger("proposals");
 *   log.info("Sending proposal", { proposalId: 42 });
 *   // → [2026-04-06T12:00:00.000Z] [INFO] [req:abc123] proposals Sending proposal { proposalId: 42 }
 */

import { AsyncLocalStorage } from "async_hooks";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isDev = process.env.NODE_ENV !== "production";
const MIN_LEVEL: LogLevel = isDev ? "debug" : "info";

/** Stores the correlation ID for the current async context (request) */
export const correlationStore = new AsyncLocalStorage<{ correlationId: string }>();

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[MIN_LEVEL];
}

function format(level: LogLevel, prefix: string, message: string): string {
  const ts = new Date().toISOString();
  const store = correlationStore.getStore();
  const reqTag = store ? ` [req:${store.correlationId}]` : "";
  return `[${ts}] [${level.toUpperCase()}]${reqTag} ${prefix ? `${prefix} ` : ""}${message}`;
}

function createLogger(prefix: string = "") {
  return {
    debug: (message: string, ...args: unknown[]) => {
      if (shouldLog("debug")) console.debug(format("debug", prefix, message), ...args);
    },
    info: (message: string, ...args: unknown[]) => {
      if (shouldLog("info")) console.info(format("info", prefix, message), ...args);
    },
    warn: (message: string, ...args: unknown[]) => {
      if (shouldLog("warn")) console.warn(format("warn", prefix, message), ...args);
    },
    error: (message: string, ...args: unknown[]) => {
      if (shouldLog("error")) console.error(format("error", prefix, message), ...args);
    },
  };
}

/** Default application-wide logger */
export const logger = createLogger();

/** Create a named logger for a specific module or subsystem */
export function getLogger(prefix: string) {
  return createLogger(prefix);
}
