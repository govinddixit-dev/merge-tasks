/**
 * Input Sanitization Utilities
 *
 * Provides helpers to sanitize and validate string inputs before they
 * reach the database or get rendered back to clients.
 *
 * Strategy:
 *  - Strip leading/trailing whitespace
 *  - Remove null bytes (common in injection attempts)
 *  - Strip HTML tags to prevent XSS when content is rendered
 *  - Enforce maximum lengths to prevent oversized payloads
 *  - Normalize email addresses to lowercase
 */

//  HTML Tag Stripper 
// Simple regex-based tag stripper — no external deps required.
// For rich-text fields that intentionally allow HTML, use `sanitizeHtml` instead.
function stripHtmlTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "") // remove script blocks first
    .replace(/<[^>]+>/g, "")                              // strip all remaining tags
    .replace(/javascript:/gi, "")                         // strip javascript: URIs
    .replace(/on\w+\s*=/gi, "");                          // strip event handlers (onclick=, etc.)
}

//  Null Byte Remover 
function removeNullBytes(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x00/g, "");
}

//  Core Sanitizer 

export interface SanitizeOptions {
  /** Maximum allowed length. Strings longer than this are truncated. Default: 1000 */
  maxLength?: number;
  /** Whether to strip HTML tags. Default: true */
  stripHtml?: boolean;
  /** Whether to trim whitespace. Default: true */
  trim?: boolean;
  /** Whether to normalize to lowercase (useful for emails). Default: false */
  lowercase?: boolean;
}

/**
 * Sanitize a single string value.
 */
export function sanitizeString(
  value: string | null | undefined,
  opts: SanitizeOptions = {}
): string {
  if (value === null || value === undefined) return "";

  const {
    maxLength = 1000,
    stripHtml = true,
    trim = true,
    lowercase = false,
  } = opts;

  let result = String(value);

  // Remove null bytes
  result = removeNullBytes(result);

  // Strip HTML tags
  if (stripHtml) result = stripHtmlTags(result);

  // Trim whitespace
  if (trim) result = result.trim();

  // Enforce max length
  if (result.length > maxLength) result = result.slice(0, maxLength);

  // Lowercase
  if (lowercase) result = result.toLowerCase();

  return result;
}

/**
 * Sanitize an optional string — returns undefined if the input is nullish.
 */
export function sanitizeOptional(
  value: string | null | undefined,
  opts: SanitizeOptions = {}
): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const result = sanitizeString(value, opts);
  return result === "" ? undefined : result;
}

/**
 * Sanitize an email address — lowercase, trim, max 254 chars (RFC 5321).
 */
export function sanitizeEmail(value: string): string {
  return sanitizeString(value, { maxLength: 254, stripHtml: true, trim: true, lowercase: true });
}

/**
 * Sanitize a short name field (company name, contact name, product name, etc.)
 * Max 255 chars, HTML stripped.
 */
export function sanitizeName(value: string | null | undefined): string {
  return sanitizeString(value, { maxLength: 255, stripHtml: true, trim: true });
}

/**
 * Sanitize a long text/notes field.
 * Max 10,000 chars, HTML stripped.
 */
export function sanitizeText(value: string | null | undefined): string | undefined {
  return sanitizeOptional(value, { maxLength: 10_000, stripHtml: true, trim: true });
}

/**
 * Sanitize a URL — basic check that it starts with http/https.
 * Returns undefined if the URL is invalid.
 */
export function sanitizeUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, 2048);
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Sanitize a hex color string (e.g. "#654BF9").
 * Returns undefined if not a valid hex color.
 */
export function sanitizeColor(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{3,8}$/.test(trimmed)) return trimmed;
  return undefined;
}

/**
 * Sanitize a slug — lowercase alphanumeric with hyphens only.
 * Returns undefined if the result is empty.
 */
export function sanitizeSlug(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return result || undefined;
}

/**
 * Sanitize an object by applying sanitizeString to all string values.
 * Useful for sanitizing entire input objects at once.
 */
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  fieldOpts: Partial<Record<keyof T, SanitizeOptions>> = {}
): T {
  const result = { ...obj };
  for (const key of Object.keys(result) as (keyof T)[]) {
    const value = result[key];
    if (typeof value === "string") {
      const opts = fieldOpts[key] || {};
      (result as Record<string, unknown>)[key as string] = sanitizeString(value, opts);
    }
  }
  return result;
}
