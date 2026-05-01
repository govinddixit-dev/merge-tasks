/**
 * /api/unsubscribe — CASL-compliant one-click unsubscribe endpoint.
 *
 * GET  shows a clean confirmation page (what the user lands on from the
 *      email link). Records the suppression on load because the signed
 *      token is all the authorization we need — the act of clicking the
 *      link from an email that is provably addressed to the recipient
 *      is the consent signal required by RFC 8058.
 *
 * POST handles the RFC 8058 "List-Unsubscribe=One-Click" mailbox-provider
 *      callback. Returns 204 on success so Gmail/Outlook can suppress
 *      without rendering the HTML page.
 */

import { Router, type Request, type Response } from "express";
import { getDb } from "../db";
import { verifyUnsubscribeToken, recordUnsubscribe } from "../email/unsubscribe";
import { getLogger } from "../utils/logger";

const log = getLogger("route:unsubscribe");

export const unsubscribeRouter = Router();

const PURPLE = "#654BF9";
const PURPLE_DARK = "#4C35D9";
const GRAY_500 = "#6B7280";
const GRAY_900 = "#111827";

function renderPage(opts: {
  title: string;
  heading: string;
  body: string;
  success: boolean;
}): string {
  const accent = opts.success ? PURPLE : "#B91C1C";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${opts.title}</title>
<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    font-family: 'Albert Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: linear-gradient(180deg, #FAFAFB 0%, #F3F0FF 100%);
    color: ${GRAY_900};
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    max-width: 440px;
    width: 100%;
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 16px;
    box-shadow: 0 1px 2px rgba(17,24,39,0.04), 0 12px 40px rgba(101,75,249,0.08);
    padding: 40px 36px 32px;
    text-align: center;
  }
  .mark {
    width: 56px; height: 56px;
    margin: 0 auto 20px;
    border-radius: 14px;
    background: ${opts.success ? "rgba(101,75,249,0.08)" : "rgba(185,28,28,0.08)"};
    display: flex; align-items: center; justify-content: center;
  }
  .mark svg { width: 28px; height: 28px; }
  h1 {
    margin: 0 0 12px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: ${GRAY_900};
  }
  p {
    margin: 0 0 20px;
    font-size: 15px;
    line-height: 1.55;
    color: ${GRAY_500};
  }
  .meta {
    font-size: 13px;
    color: ${GRAY_500};
    padding: 12px 14px;
    background: #F9FAFB;
    border-radius: 10px;
    word-break: break-all;
    margin-bottom: 20px;
  }
  a.home {
    display: inline-block;
    margin-top: 8px;
    font-size: 14px;
    font-weight: 600;
    color: ${PURPLE};
    text-decoration: none;
  }
  a.home:hover { color: ${PURPLE_DARK}; }
  footer {
    margin-top: 24px;
    font-size: 12px;
    color: #9CA3AF;
  }
</style>
</head>
<body>
  <main class="card" role="status" aria-live="polite">
    <div class="mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        ${opts.success
          ? `<polyline points="20 6 9 17 4 12" />`
          : `<circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12" y2="16.5" />`}
      </svg>
    </div>
    <h1>${opts.heading}</h1>
    ${opts.body}
    <a class="home" href="https://mergetasks.com">Back to MergeTasks</a>
    <footer>&copy; ${new Date().getFullYear()} MergeTasks</footer>
  </main>
</body>
</html>`;
}

function successHtml(email: string, type: string): string {
  return renderPage({
    title: "Unsubscribed · MergeTasks",
    heading: "You have been unsubscribed successfully.",
    body: `
      <p>We won't send further ${type === "all" ? "commercial emails" : type + " emails"} to this address.</p>
      <div class="meta">${email}</div>
      <p style="margin-bottom:0;">Transactional emails related to your account (login codes, order receipts, and approvals you've requested) will continue so you can keep using your account.</p>
    `,
    success: true,
  });
}

function errorHtml(): string {
  return renderPage({
    title: "Unsubscribe link invalid · MergeTasks",
    heading: "This unsubscribe link is no longer valid.",
    body: `
      <p>The link may have been copied incorrectly, or it has been tampered with. Please use the unsubscribe link from the most recent email you received.</p>
    `,
    success: false,
  });
}

async function processUnsubscribe(
  req: Request,
  res: Response,
  respondWithHtml: boolean,
): Promise<void> {
  const rawToken = typeof req.query.token === "string" ? req.query.token : "";
  const ctx = verifyUnsubscribeToken(rawToken);
  if (!ctx) {
    log.warn(`Rejected unsubscribe attempt with invalid token from ${req.ip}`);
    if (respondWithHtml) {
      res.status(400).type("html").send(errorHtml());
    } else {
      res.status(400).end();
    }
    return;
  }

  try {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await recordUnsubscribe(db, ctx);
  } catch (err) {
    log.error(
      `Failed to record unsubscribe for ${ctx.email} (type=${ctx.type}, storeId=${ctx.storeId ?? "null"}):`,
      err,
    );
    if (respondWithHtml) {
      res.status(500).type("html").send(errorHtml());
    } else {
      res.status(500).end();
    }
    return;
  }

  if (respondWithHtml) {
    res.status(200).type("html").send(successHtml(ctx.email, ctx.type));
  } else {
    res.status(204).end();
  }
}

// GET — user-facing confirmation page
unsubscribeRouter.get("/api/unsubscribe", async (req, res) => {
  await processUnsubscribe(req, res, true);
});

// POST — RFC 8058 one-click callback from inbox providers
unsubscribeRouter.post("/api/unsubscribe", async (req, res) => {
  await processUnsubscribe(req, res, false);
});
