export const COOKIE_NAME = "app_session_id";
export const REFRESH_COOKIE_NAME = "app_refresh_token";
/**
 * Access token lifetime: 2 hours.
 * Matches the distributor inactivity timeout so the cookie outlives an
 * active session rather than forcing silent refreshes mid-click.
 */
export const ACCESS_TOKEN_MS = 1000 * 60 * 60 * 2;
/** Refresh token lifetime: 7 days */
export const REFRESH_TOKEN_MS = 1000 * 60 * 60 * 24 * 7;
/** @deprecated Use ACCESS_TOKEN_MS instead. Kept for migration compatibility. */
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
