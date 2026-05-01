import "../envBootstrap";
import { validateEnv } from "../utils/validateEnv";
// Validate environment variables before any other initialization
validateEnv();
import { initSentry, sentryErrorHandler } from "../utils/sentry";
// Initialize Sentry as early as possible — before any other imports
initSentry();
import express from "express";
import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import tls from "tls";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import net from "net";
import fs from "fs";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerSocialAuthRoutes } from "../socialAuthCallbacks";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../stripe/webhook";
import { publicProposalRouter } from "../routes/publicProposal";
import { publicInvoiceRouter } from "../routes/publicInvoice";
import { unsubscribeRouter } from "../routes/unsubscribe";
import { deployWebhookRouter } from "../routes/deployWebhook";
import { storeApprovalRouter } from "../routes/storeApproval";
import { storeSsoRouter } from "../routes/storeSsoCallback";
import fileRouter from "../routes/files";
import { logger } from "../utils/logger";
import { csrfProtection } from "../utils/csrf";
import { liveHandler, readyHandler } from "./healthHandlers";
import { buildCorsOptions, buildGlobalApiRateLimit } from "./securityMiddleware";
import { correlationStore } from "../utils/logger";
import { randomUUID, randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";

/** Attach a unique correlation ID to every request for end-to-end log tracing */
function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers["x-correlation-id"] as string) || randomUUID().slice(0, 8);
  res.setHeader("x-correlation-id", correlationId);
  correlationStore.run({ correlationId }, next);
}

const globalApiRateLimit = buildGlobalApiRateLimit();

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();

  // Trust the first proxy (nginx/Caddy) so req.ip, req.protocol, and
  // cookie Secure flags work correctly behind a reverse proxy.
  // Without this, rate limiting buckets all traffic under 127.0.0.1
  // and Secure cookies won't be set.
  app.set("trust proxy", 1);

  // PCI DSS Req 4.1: Enforce TLS 1.2 as the minimum version.
  // In production with TLS_CERT_PATH and TLS_KEY_PATH set, the server runs
  // HTTPS directly. Otherwise (behind a reverse proxy like nginx/Caddy that
  // terminates TLS), it runs HTTP and relies on the proxy for TLS.
  let server;
  if (process.env.TLS_CERT_PATH && process.env.TLS_KEY_PATH) {
    const httpsOpts = {
      cert: fs.readFileSync(process.env.TLS_CERT_PATH),
      key: fs.readFileSync(process.env.TLS_KEY_PATH),
      minVersion: "TLSv1.2" as tls.SecureVersion,
    };
    server = createHttpsServer(httpsOpts, app);
    logger.info("HTTPS server created with TLS 1.2+ enforcement");
  } else {
    server = createServer(app);
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        "Running HTTP without TLS — ensure a reverse proxy (nginx/Caddy) terminates TLS 1.2+ in front of this server"
      );
    }
  }

  //  Security headers via Helmet 
  // Generate a per-request CSP nonce for inline scripts.
  // This replaces 'unsafe-inline' in script-src, which is required for PCI DSS
  // SAQ A eligibility (2025 revision) to confirm the site is not susceptible to
  // script injection attacks on payment pages.
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Generate a cryptographically random nonce for this request
    res.locals.cspNonce = randomBytes(16).toString("base64");
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            // In development, use unsafe-inline so Vite dev server works through
            // reverse proxies (which break nonce matching). Production uses nonce only.
            ...(process.env.NODE_ENV !== "production"
              ? ["'unsafe-inline'"]
              : [((_req: import("http").IncomingMessage, res: import("http").ServerResponse & { locals?: { cspNonce?: string } }) => `'nonce-${res.locals?.cspNonce ?? ""}'`)]
            ),
            "https://js.stripe.com",
          ],
          // 'unsafe-inline' is still needed for styles because many UI libraries
          // inject inline styles. This is acceptable under PCI DSS — the SAQ A
          // eligibility requirement specifically targets script injection.
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          connectSrc: ["'self'", "https://api.stripe.com", "https://sentry.io"],
          frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      // HSTS: 1 year, include subdomains
      hsts: process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    })
  );

  //  CORS 
  // In production, restrict to the configured ALLOWED_ORIGINS env var.
  // In development, allow all origins for convenience.
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
    : [];

  app.use(
    cors(
      buildCorsOptions({
        allowedOrigins,
        isProduction: process.env.NODE_ENV === "production",
      })
    )
  );

  // Stripe webhook needs raw body BEFORE json parser
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

  // GitHub deploy webhook — HMAC is computed over the raw request body, so
  // this must be registered before express.json() replaces req.body.
  app.use("/api/deploy/webhook", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(deployWebhookRouter);

  // Route-specific body parser overrides for file upload endpoints (2MB limit).
  // tRPC routes that accept base64 file data need larger limits than the
  // default 1MB but are capped at 2MB to bound memory use on the Node event
  // loop. Clients should compress/resize images before upload; the base64
  // inflation factor (~1.37x) means a 2MB JSON payload corresponds to roughly
  // 1.46MB of binary, which fits standard branding assets.
  // These must be registered BEFORE the default 1MB parser.
  const uploadParser = express.json({ limit: "2mb" });
  app.use("/api/trpc/products.uploadImage", uploadParser);
  app.use("/api/trpc/stores.uploadBanner", uploadParser);
  app.use("/api/trpc/branding.uploadLogo", uploadParser);
  app.use("/api/trpc/proofing.uploadLogo", uploadParser);
  app.use("/api/trpc/proofing.uploadClientLogo", uploadParser);
  app.use("/api/trpc/clients.uploadAsset", uploadParser);
  app.use("/api/trpc/voice.transcribe", uploadParser);

  // Body parser — default 1MB limit for most routes.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  // Cookie parser — needed for CSRF double-submit cookie validation
  app.use(cookieParser());

  // Ensure uploads directory exists (files are saved here by storagePut)
  const uploadsPath = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
  // P0 FIX: Do NOT serve /uploads/ publicly. All file access goes through
  // the authenticated /api/files/:key route which verifies org ownership.
  // Public store branding is served via /api/files/public/:key.
  app.use("/api/files", fileRouter);
  // Attach correlation ID to every request for end-to-end log tracing
  app.use(correlationMiddleware);
  // ── Webstore subdomain redirect middleware ──────────────────────────────
  // When a request arrives from *.mergetasks.com, nginx sets X-Store-Slug.
  // We redirect to /s/{slug} so the SPA handles the store portal route.
  // This must be registered BEFORE API routes so it fires early.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const storeSlug = req.headers["x-store-slug"] as string | undefined;
    if (storeSlug && /^[a-z0-9-]+$/.test(storeSlug)) {
      // Pass through API calls and static assets unchanged
      if (req.path.startsWith("/api/") || req.path.startsWith("/assets/") || req.path.startsWith("/health")) {
        return next();
      }
      // If already on the correct store path, continue
      if (req.path.startsWith(`/s/${storeSlug}`)) {
        return next();
      }
      // Redirect root and all other paths to the store portal
      const storePath = `/s/${storeSlug}${req.path === "/" ? "" : req.path}`;
      return res.redirect(302, storePath);
    }
    next();
  });
  // ── End webstore subdomain redirect middleware ───────────────────────────

  // Global rate limiting on all API routes
  app.use("/api", globalApiRateLimit);

  // CSRF protection — double-submit cookie pattern
  // Must be after cookie-parser and before route handlers
  app.use("/api", csrfProtection);

  // ── Health check endpoints ─────────────────────────────────────────────────
  // /live  — shallow liveness probe; no DB/Redis traffic. Used by orchestrators
  //          to decide "is the process up at all?". Cheap to call at high QPS.
  // /ready — deep readiness probe (DB + Redis). Cached for 5s so a burst of
  //          probes from load balancers does not amplify into per-probe
  //          backend queries. Used to gate traffic during cold start /
  //          dependency outages.
  // /health (legacy alias) — preserved for existing LB targets; routes to the
  //          cached /ready response so behavior matches what callers expect.
  app.get("/live", liveHandler);
  app.get("/ready", readyHandler);
  app.get("/health", readyHandler);

  // Public API routes (no auth required)
  app.use(publicProposalRouter);
  app.use(publicInvoiceRouter);
  app.use(storeApprovalRouter);
  // CASL-compliant unsubscribe endpoint (GET page + RFC 8058 one-click POST)
  app.use(unsubscribeRouter);
  // SSO callback routes (SAML ACS + OIDC callback — no auth/CSRF required)
  app.use(storeSsoRouter);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Google & Microsoft OAuth callbacks for distributor sign-in
  registerSocialAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Explicit 404 for unused /api/* paths — prevents the SPA catch-all from
  // serving the React app for routes that look like API endpoints to scanners.
  // Any /api/* path not matched above is a genuine 404, not a frontend route.
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Sentry error handler — must be after all routes, before other error handlers
  app.use(sentryErrorHandler as any);

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    logger.warn(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Bind to loopback in production so only the on-host reverse proxy
  // (nginx) can reach the Node process — defense-in-depth alongside the
  // EC2 Security Group. HOST can be overridden for containerized deploys
  // that need an in-cluster bind (e.g. HOST=0.0.0.0 for ECS tasks fronted
  // by an ALB).
  const host = process.env.HOST
    || (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");
  server.listen(port, host, () => {
    logger.info(`Server running on http://${host}:${port}/`);
  });

  //  Redis health check (Decision 27 — shared BullMQ + rate limiter backbone)
  // TODO(Phase 8): once async agent tools depend on BullMQ, promote this to
  // fail-fast (process.exit(1) on !healthy). Phase 1 has no Redis-dependent
  // runtime paths, so a transient outage here must not prevent boot.
  try {
    const { isRedisHealthy, redisConnection } = await import("../queue/redisClient");
    const healthy = await isRedisHealthy();
    if (healthy) {
      logger.info("Redis connection established");
    } else {
      logger.error("Redis connection failed — PING did not return PONG");
    }
    // Warn-only here (worker enforces fatally). Main app can still serve
    // non-queue traffic if the eviction policy drifts; alerting on the warn
    // is enough to drive a parameter-group fix without dropping web traffic.
    if (redisConnection) {
      try {
        const { assertEvictionPolicy } = await import("../queue/assertEvictionPolicy");
        await assertEvictionPolicy(redisConnection);
      } catch (err) {
        logger.warn(`Redis eviction-policy check: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    logger.error("Redis connection failed", err);
  }

  //  Data Retention Cleanup (PCI DSS data minimization)
  // Schedule automatic cleanup of expired codes, tokens, and old notifications.
  const { scheduleDataRetentionCleanup } = await import("../jobs/dataRetentionCleanup");
  scheduleDataRetentionCleanup();

  //  Agent Cron — low-engagement store detection (Guide 3)
  const { scheduleAgentCron } = await import("../jobs/agentCron");
  scheduleAgentCron();

  //  Supplier Sync Cron — pulls PSRESTful pricing + zones every 24h
  const { scheduleSupplierSyncCron } = await import("../jobs/supplierSyncCron");
  scheduleSupplierSyncCron();

  //  Graceful Shutdown 
  // On SIGTERM/SIGINT, stop accepting new connections, drain existing ones, then exit.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — starting graceful shutdown...`);
    server.close(() => {
      logger.info("HTTP server closed. Draining database pool...");
      // Import pool getter lazily to avoid circular deps
      import("../db").then(({ getPool }) => {
        const pool = getPool();
        if (pool) {
          pool.end().then(() => {
            logger.info("Database pool closed. Exiting.");
            process.exit(0);
          }).catch(() => process.exit(1));
        } else {
          process.exit(0);
        }
      }).catch(() => process.exit(1));
    });

    // Force exit after 10 seconds if graceful shutdown stalls
    setTimeout(() => {
      logger.error("Graceful shutdown timed out — forcing exit.");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch(err => logger.error("Failed to start server", err));
