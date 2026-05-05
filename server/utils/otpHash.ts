/**
 * OTP Code Hashing — PCI DSS Req 8.3.2
 *
 * Verification codes (OTPs) are hashed with SHA-256 before storage in the database.
 * Since OTPs are short-lived (10 minutes) and 6 digits, SHA-256 without salt is
 * sufficient — the codes expire before brute-force becomes practical.
 *
 * The plaintext code is sent via email; only the hash is stored in the DB.
 * On verification, the submitted code is hashed and compared to the stored hash.
 */

import { createHash } from "crypto";

/**
 * Hash a 6-digit OTP code using SHA-256.
 * Returns a hex-encoded hash string (64 chars).
 */
export function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
