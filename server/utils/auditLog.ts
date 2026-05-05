/**
 * Audit Logger — PCI DSS Req 10.2
 *
 * Provides structured audit logging for security-sensitive and payment-related
 * actions. Every audit event includes: who, what, when, and from where.
 *
 * Events are written to:
 * 1. Structured JSON on stdout (for log aggregators / SIEM forwarding)
 * 2. A dedicated `audit_log` database table (append-only, no UPDATE/DELETE)
 *
 * The DB table provides queryable, tamper-evident storage with a 90-day
 * minimum retention period as required by PCI DSS Req 10.7.
 *
 * Covered actions (PCI DSS Req 10.2.1–10.2.7):
 * - Access to cardholder data environment (Stripe config changes)
 * - Administrative actions (user role changes, plan changes)
 * - Access to audit trails
 * - Invalid logical access attempts (failed logins)
 * - Use of identification and authentication mechanisms (login, logout, token refresh)
 * - Initialization/stopping of audit logs
 * - Creation/deletion of system-level objects (stores, email connections)
 */

import { getLogger } from "./logger";

const log = getLogger("AUDIT");

export type AuditAction =
  // Authentication events
  | "auth.login.success"
  | "auth.login.failed"
  | "auth.logout"
  | "auth.token.refresh"
  | "auth.2fa.requested"
  | "auth.2fa.verified"
  | "auth.2fa.failed"
  // Payment / Stripe events
  | "stripe.config.viewed"
  | "stripe.config.updated"
  | "stripe.connect.onboarded"
  | "stripe.connect.removed"
  | "stripe.checkout.created"
  | "stripe.webhook.received"
  | "stripe.webhook.failed"
  // Email / OAuth credential events
  | "email.connection.created"
  | "email.connection.updated"
  | "email.connection.deleted"
  | "email.oauth.token.refreshed"
  | "email.oauth.token.viewed"
  // Store management
  | "store.created"
  | "store.deleted"
  | "store.settings.updated"
  | "store.direct_order.created"
  // User / role management
  | "user.role.changed"
  | "user.plan.changed"
  | "user.deleted"
  // SSO events
  | "sso.idp.created"
  | "sso.idp.updated"
  | "sso.idp.deleted"
  | "sso.login.success"
  | "sso.login.failed"
  | "sso.account.linked"
  | "sso.user.provisioned"
  // Refund events
  | "refund.issued"
  | "refund.failed"
  | "refund.requested"
  | "refund.approved"
  | "refund.denied"
  | "refund.webhook.received"
  | "creditnote.issued"
  // Order lifecycle events
  | "order.expired"
  | "order.cancelled"
  | "order.payment_failed"
  // Proposal department approval events
  | "proposal.approval.approved"
  | "proposal.approval.rejected"
  | "proposal.approval.reapproval_requested"
  // Invoice events
  | "invoice.paid"
  | "invoice.payment_failed"
  // Data access
  | "data.export"
  | "data.bulk.delete";

export interface AuditEvent {
  /** The action being performed */
  action: AuditAction;
  /** User ID performing the action (null for unauthenticated events) */
  userId: number | null;
  /** Email or identifier of the actor */
  actorEmail?: string;
  /** IP address of the request */
  ip?: string;
  /** Target resource type (e.g., "store", "emailConnection", "user") */
  resourceType?: string;
  /** Target resource ID */
  resourceId?: string | number;
  /** Human-readable description of what happened */
  description: string;
  /** Additional metadata (e.g., old/new values for config changes) */
  metadata?: Record<string, unknown>;
}

/**
 * Persist an audit event to the audit_log database table.
 * This is fire-and-forget — failures are logged but do not block the request.
 * The table must be created via migration (see 0028_create_audit_log_table.sql).
 *
 * IMPORTANT: The DB user for the audit_log table should ideally have only
 * INSERT and SELECT privileges — no UPDATE or DELETE — to ensure tamper-evidence.
 */
async function persistToDb(entry: Record<string, unknown>): Promise<void> {
  try {
    // Dynamic import to avoid circular dependency with db.ts
    const { getPool } = await import("../db");
    const pool = getPool();
    if (!pool) return; // DB not yet initialized (startup, tests)

    // Use Date object for DATETIME(3) column (migration 0029 changed from VARCHAR)
    const params: (string | number | Date | null)[] = [
      new Date(entry.timestamp as string),
      entry.action as string,
      (entry.userId as number | null) ?? null,
      (entry.actorEmail as string | null) ?? null,
      (entry.ip as string | null) ?? null,
      (entry.resourceType as string | null) ?? null,
      entry.resourceId != null ? String(entry.resourceId) : null,
      entry.description as string,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ];
    await pool.execute(
      `INSERT INTO audit_log (timestamp, action, user_id, actor_email, ip, resource_type, resource_id, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
  } catch (err) {
    // Never let audit persistence failure break the application.
    // Log the error so ops can investigate, but do not throw.
    log.warn("Failed to persist audit event to database", err);
  }
}

/**
 * Write a structured audit log entry.
 *
 * Writes to both stdout (structured JSON) and the audit_log database table.
 * DB persistence is async/fire-and-forget to avoid blocking the request.
 */
export function auditLog(event: AuditEvent): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level: "AUDIT",
    ...event,
  };

  // 1. Always log to stdout as structured JSON for log aggregators
  log.info(JSON.stringify(entry));

  // 2. Persist to database (fire-and-forget, non-blocking)
  persistToDb(entry).catch(() => {
    // Swallowed — persistToDb already logs its own warning
  });
}

/**
 * Create an audit logger bound to a specific user context.
 * Useful in tRPC procedures where ctx.user is available.
 */
export function createUserAuditLogger(userId: number, email?: string, ip?: string) {
  return (action: AuditAction, description: string, extra?: Partial<AuditEvent>) => {
    auditLog({
      action,
      userId,
      actorEmail: email,
      ip,
      description,
      ...extra,
    });
  };
}
