/**
 * Sentry Client-Side Initialization
 *
 * Import and call initSentryClient() at the top of main.tsx before rendering.
 *
 * Required environment variable (in .env):
 *   VITE_SENTRY_DSN — your Sentry project DSN (same DSN as server, or a separate one)
 *
 * Sentry will automatically capture:
 *   - Unhandled JavaScript errors
 *   - Unhandled promise rejections
 *   - React component errors (via the ErrorBoundary)
 *   - Network request errors (optional, via tracing)
 */

import * as Sentry from "@sentry/react";

export function initSentryClient() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (!dsn) {
    // Sentry not configured — silently skip
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "development",

    // Capture 100% of sessions in production for now
    // Lower replaysSessionSampleRate (e.g. 0.1) once you have high traffic
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    tracesSampleRate: import.meta.env.PROD ? 1.0 : 0.0,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Mask all text content and block all media in session replays for privacy
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Don't send events in development unless DSN is explicitly set
    enabled: !!dsn,
  });
}

/**
 * Set the authenticated user on the Sentry scope.
 * Call this after a successful login.
 */
export function setSentryUser(user: { id: number; email: string; name?: string }) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.setUser({
    id: String(user.id),
    email: user.email,
    username: user.name,
  });
}

/**
 * Clear the Sentry user scope on logout.
 */
export function clearSentryUser() {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.setUser(null);
}

/**
 * Manually capture a client-side exception with optional context.
 */
export function captureClientException(
  err: unknown,
  context?: Record<string, unknown>
) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}

/**
 * Sentry-wrapped React ErrorBoundary component.
 * Wrap your app root with this to catch React render errors.
 *
 * Usage:
 *   <SentryErrorBoundary fallback={<p>Something went wrong</p>}>
 *     <App />
 *   </SentryErrorBoundary>
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;
