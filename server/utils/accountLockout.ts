/**
 * Account Lockout — PCI DSS Req 8.1.6
 *
 * Locks an account after MAX_FAILED_ATTEMPTS consecutive failed login attempts.
 * The lockout lasts for LOCKOUT_DURATION_MINUTES and resets on successful login.
 *
 * This module provides helpers used by both platform auth (onboarding.ts signIn)
 * and store auth (storeUserProvisioning.ts passwordLogin, storeAuth.ts verifyCode).
 */

/** Maximum consecutive failed attempts before lockout */
export const MAX_FAILED_ATTEMPTS = 10;

/** Lockout duration in minutes */
export const LOCKOUT_DURATION_MINUTES = 30;

/**
 * Check if an account is currently locked.
 * @returns true if the account is locked and the lockout has not expired.
 */
export function isAccountLocked(lockedUntil: Date | null): boolean {
  if (!lockedUntil) return false;
  return new Date() < lockedUntil;
}

/**
 * Calculate the new lockedUntil timestamp when the threshold is reached.
 */
export function getLockoutExpiry(): Date {
  return new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
}

/**
 * Get a user-facing lockout error message.
 */
export function getLockoutMessage(): string {
  return `Account temporarily locked due to too many failed login attempts. Please try again in ${LOCKOUT_DURATION_MINUTES} minutes.`;
}
