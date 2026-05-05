/**
 * AES-256-GCM Encryption Utility
 *
 * Encrypts sensitive credentials (OAuth tokens, SMTP passwords) at rest.
 * Uses AES-256-GCM with a random 12-byte IV per ciphertext, providing both
 * confidentiality and authenticity.
 *
 * Ciphertext format: "enc:v1:" + base64(iv || authTag || ciphertext)
 *   - prefix:      "enc:v1:" (7 bytes, identifies encrypted values)
 *   - iv:          12 bytes
 *   - authTag:     16 bytes
 *   - ciphertext:  variable length
 *
 * The "enc:v1:" prefix allows O(1) detection of encrypted values without
 * trial-decrypting, which is both cheaper and avoids masking real errors.
 *
 * The encryption key is derived from the CREDENTIAL_ENCRYPTION_KEY env var
 * using SHA-256 to ensure exactly 32 bytes regardless of input length.
 */
import crypto from "crypto";
import { getLogger } from "./logger";

const log = getLogger("encryption");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Magic prefix for identifying encrypted values without trial-decrypt */
const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * Derive a 32-byte key from the CREDENTIAL_ENCRYPTION_KEY env var.
 * Uses SHA-256 so any passphrase length works.
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return crypto.createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a plaintext string. Returns a prefixed base64-encoded blob
 * containing the IV, auth tag, and ciphertext.
 * Returns null if the input is null or undefined.
 */
export function encryptCredential(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: iv + authTag + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return ENCRYPTED_PREFIX + packed.toString("base64");
}

/**
 * Decrypt a prefixed base64-encoded blob back to the original plaintext.
 * Returns null if the input is null or undefined.
 * Returns the original string unchanged if it doesn't have the encryption
 * prefix (graceful migration: old plaintext values still work).
 */
export function decryptCredential(cipherBlob: string | null | undefined): string | null {
  if (cipherBlob == null || cipherBlob === "") return null;

  // Check for the magic prefix — if absent, this is a legacy plaintext value
  if (!cipherBlob.startsWith(ENCRYPTED_PREFIX)) {
    log.warn("Credential missing encryption prefix — treating as legacy plaintext. Run the credential migration script to encrypt existing values.");
    return cipherBlob;
  }

  try {
    const key = getEncryptionKey();
    const packed = Buffer.from(cipherBlob.slice(ENCRYPTED_PREFIX.length), "base64");

    // Minimum size: IV (12) + authTag (16) + at least 1 byte ciphertext
    if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
      log.warn("Encrypted credential too short after prefix — corrupted data");
      return null;
    }

    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    // Decryption failed — this is a real error (wrong key, corrupted data)
    // Do NOT silently return the raw value, as that would mask the problem.
    log.error("Failed to decrypt credential — possible key mismatch or data corruption", error);
    throw new Error("Failed to decrypt credential. Check CREDENTIAL_ENCRYPTION_KEY.");
  }
}

/**
 * Check whether a string looks like it was encrypted by this module.
 * Uses the magic prefix for O(1) detection — no trial-decrypt needed.
 * Used by migration scripts to skip already-encrypted values.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith(ENCRYPTED_PREFIX);
}
