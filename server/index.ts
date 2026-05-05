/**
 * ⚠️  DEPRECATED ENTRYPOINT
 *
 * This file previously served as a standalone Express static server with
 * ZERO security middleware (no CORS, no CSRF, no helmet, no auth, no rate limiting).
 *
 * The correct entrypoint is: server/_core/index.ts
 *
 * This file now exists only to prevent accidental use. If someone runs
 * `node server/index.ts` or `tsx server/index.ts`, they will get a clear
 * error message instead of an unprotected server.
 */

console.error(`
╔══════════════════════════════════════════════════════════════╗
║                    WRONG ENTRYPOINT                         ║
║                                                             ║
║  You are running server/index.ts, which is deprecated.      ║
║  This file has no security middleware and must not be used.  ║
║                                                             ║
║  Use the correct entrypoint instead:                        ║
║                                                             ║
║    npx tsx server/_core/index.ts                            ║
║                                                             ║
║  Or via package.json:                                       ║
║                                                             ║
║    pnpm dev                                                 ║
║                                                             ║
╚══════════════════════════════════════════════════════════════╝
`);

process.exit(1);
