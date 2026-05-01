/**
 * Lightweight client-side logger.
 * In production builds, debug and info logs are suppressed.
 * Errors and warnings are always shown.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const isDev = import.meta.env.DEV;

function createLogger(prefix: string = "") {
  const tag = prefix ? `[${prefix}]` : "";
  return {
    debug: (...args: unknown[]) => {
      if (isDev) console.debug(tag, ...args);
    },
    info: (...args: unknown[]) => {
      if (isDev) console.info(tag, ...args);
    },
    warn: (...args: unknown[]) => {
      console.warn(tag, ...args);
    },
    error: (...args: unknown[]) => {
      console.error(tag, ...args);
    },
  };
}

export const logger = createLogger();
export function getLogger(prefix: string) {
  return createLogger(prefix);
}
