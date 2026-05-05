/**
 * Sentry Server-Side Initialization
 *
 * Initialize as early as possible — import this at the top of server/_core/index.ts
 * before any other imports.
 *
 * Required environment variable:
 *   SENTRY_DSN — your Sentry project DSN (from sentry.io → Project Settings → Client Keys)
 *
 * Optional:
 *   NODE_ENV — set to "production" to enable Sentry (disabled in development by default)
 */

import * as Sentry from "@sentry/node";

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    // Sentry not configured — silently skip (not an error)
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",

    // Capture 100% of transactions in production for now
    // Lower this (e.g. 0.1) once you have high traffic
    tracesSampleRate: process.env.NODE_ENV === "production" ? 1.0 : 0.0,

    // Capture unhandled promise rejections
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],

    // Don't send events in development unless DSN is explicitly set
    enabled: !!dsn,

    // Scrub sensitive fields from error reports
    beforeSend(event) {
      // Remove password fields from request data
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        if (data.password) data.password = "[Filtered]";
        if (data.newPassword) data.newPassword = "[Filtered]";
        if (data.currentPassword) data.currentPassword = "[Filtered]";
      }
      return event;
    },
  });
}

/**
 * Express error handler middleware — must be added AFTER all routes.
 * Captures unhandled errors and forwards them to Sentry before responding.
 */
export const sentryErrorHandler = Sentry.expressErrorHandler();

/**
 * Manually capture an exception with optional context.
 * Use this in catch blocks where you handle the error but still want visibility.
 *
 * Example:
 *   try { ... } catch (err) { captureException(err, { userId: ctx.user.id }); }
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>
) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(err);
  });
}

/**
 * Set the authenticated user on the current Sentry scope.
 * Call this after verifying the user session.
 */
export function setSentryUser(user: { id: number; email: string }) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.setUser({ id: String(user.id), email: user.email });
}
