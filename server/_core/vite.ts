import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import { randomBytes } from "crypto";
import viteConfig from "../../vite.config";
import { getLogger } from "../utils/logger";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = getLogger("Vite");

/**
 * Set the CSRF cookie on the response so the client has it before making API calls.
 * The csrfProtection middleware only runs on /api routes, so we also need to set
 * the cookie when serving the initial HTML page.
 */
function setCsrfCookieOnHtml(req: Request, res: Response) {
  const token = randomBytes(32).toString("hex");
  const isSecure =
    req.protocol === "https" ||
    (req.headers["x-forwarded-proto"] as string)?.includes("https");
  res.cookie("csrf_token", token, {
    httpOnly: false, // client JS must read this
    secure: isSecure,
    sameSite: isSecure ? "none" : "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
  });
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req: Request, res: Response, next: NextFunction) => {
    const url = req.originalUrl;

    try {
      // Set CSRF cookie so the client can read it before making any API calls
      setCsrfCookieOnHtml(req, res);

      const clientTemplate = path.resolve(
        __dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      // Inject CSP nonce into all <script> tags so they pass the Content-Security-Policy
      const nonce = res.locals?.cspNonce || "";
      if (nonce) {
        template = template.replace(/<script/g, `<script nonce="${nonce}"`);
      }
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(__dirname, "../..", "dist", "public")
      : path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    log.error(`Could not find the build directory: ${distPath}, make sure to build the client first`);
  }

  // NOTE: /uploads/ is NOT served statically here.
  // All file access goes through the authenticated /api/files/:key route (P0 security fix).
  // Public store branding uses /api/files/public/:key.
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  // Inject CSP nonce into the served HTML so inline scripts pass the policy
  app.use("*", (req: Request, res: Response) => {
    // Set CSRF cookie on every HTML page load
    setCsrfCookieOnHtml(req, res);
    const indexPath = path.resolve(distPath, "index.html");
    const nonce = res.locals?.cspNonce || "";
    if (nonce && fs.existsSync(indexPath)) {
      let html = fs.readFileSync(indexPath, "utf-8");
      html = html.replace(/<script/g, `<script nonce="${nonce}"`);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } else {
      res.sendFile(indexPath);
    }
  });
}
