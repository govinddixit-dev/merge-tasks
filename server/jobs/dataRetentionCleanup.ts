/**
 * Data Retention Cleanup Job
 *
 * Removes expired/stale data to comply with data minimization principles:
 * - Expired verification codes (login 2FA, signup, password reset)
 * - Expired store verification codes
 * - Expired/used password tokens
 * - Read notifications older than 90 days
 * - Unread notifications older than 365 days
 * - Expired proposal approval tokens
 *
 * Can be run standalone: `npx tsx server/jobs/dataRetentionCleanup.ts`
 * Also wired into server startup via scheduleDataRetentionCleanup().
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { getLogger } from "../utils/logger";
const log = getLogger("dataRetention");

/** Extract affectedRows from a raw MySQL execute() result */
function affectedRows(result: unknown): number {
  return (result as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
}

export async function runCleanup(): Promise<void> {
  const db = await getDb();
  if (!db) {
    log.error("[DataRetention] Database unavailable — skipping cleanup");
    return;
  }

  const results: Record<string, number> = {};

  try {
    // 1. Expired verification codes (login 2FA, signup verify, password reset)
    const expiredCodes = await db.execute(
      sql`DELETE FROM verificationCodes WHERE expiresAt < NOW() OR (used = true AND createdAt < DATE_SUB(NOW(), INTERVAL 7 DAY))`
    );
    results["verificationCodes"] = affectedRows(expiredCodes);

    // 2. Expired store verification codes
    const expiredStoreCodes = await db.execute(
      sql`DELETE FROM storeVerificationCodes WHERE expiresAt < NOW() OR (used = true AND createdAt < DATE_SUB(NOW(), INTERVAL 7 DAY))`
    );
    results["storeVerificationCodes"] = affectedRows(expiredStoreCodes);

    // 3. Expired/used store password tokens
    const expiredTokens = await db.execute(
      sql`DELETE FROM storePasswordTokens WHERE tokenExpiresAt < NOW() OR (tokenUsed = true AND createdAt < DATE_SUB(NOW(), INTERVAL 7 DAY))`
    );
    results["storePasswordTokens"] = affectedRows(expiredTokens);

    // 4. Read notifications older than 90 days
    const oldReadNotifs = await db.execute(
      sql`DELETE FROM notifications WHERE notifRead = true AND notifCreatedAt < DATE_SUB(NOW(), INTERVAL 90 DAY)`
    );
    results["readNotifications_90d"] = affectedRows(oldReadNotifs);

    // 5. Unread notifications older than 365 days
    const oldUnreadNotifs = await db.execute(
      sql`DELETE FROM notifications WHERE notifRead = false AND notifCreatedAt < DATE_SUB(NOW(), INTERVAL 365 DAY)`
    );
    results["unreadNotifications_365d"] = affectedRows(oldUnreadNotifs);

    // 6. Expired proposal approval tokens (clear the token, don't delete the store)
    const expiredApprovals = await db.execute(
      sql`UPDATE stores SET approvalToken = NULL WHERE approvalExpiresAt IS NOT NULL AND approvalExpiresAt < NOW() AND approvalToken IS NOT NULL`
    );
    results["expiredApprovalTokens"] = affectedRows(expiredApprovals);

    // 7. Stale copilot pending actions older than 48 hours
    //    Actions that were never approved or denied accumulate indefinitely without this.
    //    48-hour TTL gives users a reasonable window to review and approve.
    //    Rows with status 'approved' or 'denied' are also cleaned up after 48h
    //    since they are no longer actionable.
    const stalePendingActions = await db.execute(
      sql`DELETE FROM copilotPendingActions WHERE createdAt < DATE_SUB(NOW(), INTERVAL 48 HOUR)`
    );
    results["staleCopilotPendingActions"] = affectedRows(stalePendingActions);

    // 8. AI audit log entries older than 90 days
    //    The migration comment specifies "keep at least 90 days" (PCI DSS Req 10.7 analogue).
    //    Without this, aiAuditLog grows unbounded as it is append-only.
    const oldAuditLogs = await db.execute(
      sql`DELETE FROM aiAuditLog WHERE createdAt < DATE_SUB(NOW(), INTERVAL 90 DAY)`
    );
    results["aiAuditLog_90d"] = affectedRows(oldAuditLogs);

    // Summary
    const totalCleaned = Object.values(results).reduce((a, b) => a + b, 0);
    if (totalCleaned > 0) {
      log.info(`[DataRetention] Cleanup complete — ${totalCleaned} rows affected`, results);
    } else {
      log.info("[DataRetention] Cleanup complete — no stale data found");
    }
  } catch (err) {
    log.error("[DataRetention] Cleanup failed:", err);
  }
}

/**
 * Schedule the data retention cleanup to run every 6 hours.
 * Call this once from server startup.
 * Returns the interval handle for cleanup during graceful shutdown.
 */
export function scheduleDataRetentionCleanup(): NodeJS.Timeout {
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

  // Run once immediately (after a short delay to let DB initialize)
  setTimeout(() => {
    runCleanup().catch((err) => log.error("[DataRetention] Initial cleanup failed:", err));
  }, 30_000); // 30 seconds after startup

  // Then run every 6 hours
  const interval = setInterval(() => {
    runCleanup().catch((err) => log.error("[DataRetention] Scheduled cleanup failed:", err));
  }, SIX_HOURS_MS);

  interval.unref(); // Don't prevent process exit

  log.info("[DataRetention] Scheduled cleanup every 6 hours (first run in 30s)");
  return interval;
}

// Allow standalone execution: `npx tsx server/jobs/dataRetentionCleanup.ts`
const _isStandaloneRun = process.argv[1]?.includes('dataRetentionCleanup');
if (_isStandaloneRun) {
  runCleanup()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
