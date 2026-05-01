/**
 * tRPC Input Sanitization Middleware
 *
 * Automatically sanitizes all string values in tRPC procedure inputs
 * before they reach the handler. Applied globally via publicProcedure
 * and protectedProcedure in trpc.ts.
 *
 * What it does:
 *  - Strips null bytes from all strings
 *  - Strips HTML tags and javascript: URIs (XSS prevention)
 *  - Trims whitespace
 *  - Enforces a hard maximum of 50,000 chars per field (prevents payload bombs)
 *
 * What it does NOT do:
 *  - It does not validate business rules (that stays in Zod schemas)
 *  - It does not modify numbers, booleans, arrays, or nested objects' structure
 *  - It does not touch base64 image data (detected by data: prefix — left as-is)
 */
// NOTE: No import from trpc.ts here — that would create a circular dependency.
// Instead, createSanitizeMiddleware(t) is called from trpc.ts after t is initialized.

const MAX_FIELD_LENGTH = 50_000;

// Regex compiled once at module load
const NULL_BYTES = /\x00/g; // eslint-disable-line no-control-regex
const SCRIPT_BLOCKS = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const HTML_TAGS = /<[^>]+>/g;
const JS_URIS = /javascript:/gi;
const EVENT_HANDLERS = /on\w+\s*=/gi;

function sanitizeValue(value: unknown): unknown {
  if (typeof value !== "string") {
    // Recurse into plain objects and arrays
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = sanitizeValue(v);
      }
      return result;
    }
    return value;
  }

  // Skip base64 data URIs (images, files) — sanitizing these would corrupt them
  if (value.startsWith("data:")) return value;

  let s = value;

  // 1. Hard length cap
  if (s.length > MAX_FIELD_LENGTH) s = s.slice(0, MAX_FIELD_LENGTH);

  // 2. Remove null bytes
  s = s.replace(NULL_BYTES, "");

  // 3. Strip script blocks
  s = s.replace(SCRIPT_BLOCKS, "");

  // 4. Strip HTML tags
  s = s.replace(HTML_TAGS, "");

  // 5. Strip javascript: URIs
  s = s.replace(JS_URIS, "");

  // 6. Strip inline event handlers
  s = s.replace(EVENT_HANDLERS, "");

  // 7. Trim
  s = s.trim();

  return s;
}

/**
 * Creates a tRPC middleware that sanitizes all string fields in the procedure input.
 * Call this from trpc.ts AFTER initializing `t` to avoid circular imports.
 *
 * @param t - The initialized tRPC instance (from initTRPC.create())
 */
// tRPC middleware typing is complex and version-dependent; using any for compatibility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSanitizeMiddleware(t: { middleware: (fn: any) => any }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return t.middleware(async (opts: any) => {
    const { next } = opts;
    const rawInput = opts.rawInput;
    if (rawInput !== null && rawInput !== undefined && typeof rawInput === "object") {
      const sanitized = sanitizeValue(rawInput) as Record<string, unknown>;
      Object.assign(rawInput as object, sanitized);
    }
    return next();
  });
}
