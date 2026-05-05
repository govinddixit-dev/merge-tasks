/**
 * deployWebhook — GitHub push-event receiver that invokes deploy.sh.
 *
 * Flow:
 *   1. GitHub POSTs to /api/deploy/webhook with a JSON push payload and
 *      `X-Hub-Signature-256: sha256=<hex-hmac-of-raw-body>`.
 *   2. We verify the signature using DEPLOY_WEBHOOK_SECRET (shared with
 *      GitHub's webhook config) via timing-safe comparison.
 *   3. Only `push` events on refs/heads/main trigger a deploy.
 *   4. deploy.sh is spawned fully detached — we respond 202 immediately
 *      so GitHub's 10s delivery timeout doesn't kill the deploy.
 *
 * Requests are only ever accepted when DEPLOY_WEBHOOK_SECRET is set; if
 * it's missing the handler returns 503 so nothing can trigger a deploy
 * with an unconfigured secret. This is the "fail closed" default.
 *
 * The raw-body middleware is registered on this exact path in
 * server/_core/index.ts, BEFORE express.json(), so req.body is a Buffer
 * here and we can HMAC it byte-for-byte.
 */
import { type Request, type Response, Router } from "express";
import crypto from "crypto";
import { spawn } from "child_process";
import path from "path";
import { getLogger } from "../utils/logger";

const log = getLogger("deployWebhook");

// One invocation at a time. If a deploy is in flight, queue the next
// trigger implicitly (deploy.sh is re-entrant and will pick up whatever
// HEAD is on origin/main at invocation time).
let deployRunning = false;

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function verifyGithubSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqHex(signatureHeader.slice(prefix.length), expected);
}

function runDeploy(deployId: string) {
  if (deployRunning) {
    log.info(`[${deployId}] deploy already running — skipping spawn`);
    return;
  }
  deployRunning = true;
  const deployScript = path.resolve(process.cwd(), "deploy.sh");
  log.info(`[${deployId}] spawning deploy.sh`);
  const child = spawn("setsid", ["--fork", "bash", deployScript], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.on("exit", (code) => {
    deployRunning = false;
    log.info(`[${deployId}] deploy.sh exited with code ${code ?? "null"}`);
  });
  child.on("error", (err) => {
    deployRunning = false;
    log.error(`[${deployId}] failed to spawn deploy.sh:`, err);
  });
  // We use setsid --fork to double-fork the deploy script: the immediate
  // child exits, and the grandchild reparents to init (PID 1) before pm2's
  // reload phase begins. This is required because pm2 reload mergetasks
  // signals the entire mergetasks process tree, and a single Node detach
  // (detached: true + unref) leaves a parent-PID linkage that gets chased
  // during reload — killing deploy.sh between step 6/7 and step 7/7,
  // preventing the DEPLOY COMPLETE banner from emitting. With setsid
  // --fork, deploy.sh's ppid is 1 by the time pm2 reload runs.
  child.unref();
}

export const deployWebhookRouter = Router();

/**
 * GitHub sends POST with application/json and raw body. Signature header:
 * X-Hub-Signature-256: sha256=<hex>.
 */
deployWebhookRouter.post("/api/deploy/webhook", (req: Request, res: Response) => {
  const secret = process.env.DEPLOY_WEBHOOK_SECRET;
  if (!secret) {
    log.warn("refused deploy webhook — DEPLOY_WEBHOOK_SECRET not configured");
    res.status(503).json({ error: "deploy webhook not configured" });
    return;
  }

  const signature = req.header("X-Hub-Signature-256");
  if (!signature) {
    log.warn("refused deploy webhook — missing X-Hub-Signature-256");
    res.status(401).json({ error: "missing signature" });
    return;
  }

  // When routed through express.raw() above, req.body is a Buffer.
  const rawBody: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

  if (!verifyGithubSignature(rawBody, signature, secret)) {
    log.warn("refused deploy webhook — signature mismatch");
    res.status(401).json({ error: "signature mismatch" });
    return;
  }

  const event = req.header("X-GitHub-Event") ?? "";
  if (event === "ping") {
    res.status(200).json({ pong: true });
    return;
  }
  if (event !== "push") {
    res.status(202).json({ ignored: event });
    return;
  }

  let payload: { ref?: string; after?: string } = {};
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }

  if (payload.ref !== "refs/heads/main") {
    log.info(`ignored push on ref=${payload.ref ?? "?"}`);
    res.status(202).json({ ignored: payload.ref });
    return;
  }

  const deployId = payload.after ? payload.after.slice(0, 12) : Date.now().toString();
  log.info(`webhook verified — triggering deploy for ${deployId}`);
  runDeploy(deployId);

  res.status(202).json({ accepted: true, commit: payload.after ?? null });
});
