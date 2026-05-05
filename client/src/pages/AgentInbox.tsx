/**
 * AgentInbox — Morning-briefing dashboard for reviewing AI agent proposals.
 *
 * The distributor opens this page once a day to review a small batch of
 * agent-drafted actions (mostly emails). Each card carries enough context
 * to decide in a few seconds, and the drawer lets the user polish the
 * subject or body before firing the underlying tool call.
 *
 * Bulk "Approve All Emails" is restricted to send_custom_email actions —
 * never approves destructive or non-email tools in bulk.
 *
 * The UI never calls anything the Phase 1 server doesn't already expose:
 * actionApproval.listPending / approve / deny / agentStatus.
 */

import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BrainCircuit,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Package,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Store,
  TrendingUp,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import DOMPurify from "dompurify";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types + data shaping                                               */
/* ------------------------------------------------------------------ */

type TriggerType =
  | "proposal_viewed"
  | "proposal_expiring"
  | "proposal_accepted"
  | "new_client"
  | "reorder_window"
  | "invoice_overdue"
  | "client_dormant"
  | "order_delivered"
  | "store_created"
  | "store_low_engagement"
  | "custom_order_request"
  | "predictive_opportunity"
  | "predictive_proposal_draft"
  | "unknown";

type CategoryKey =
  | "predicted_opportunities"
  | "proposal_drafts"
  | "follow_ups"
  | "new_business"
  | "collections"
  | "re_engagement"
  | "order_updates"
  | "store_suggestions"
  | "other";

interface CategoryDef {
  key: CategoryKey;
  label: string;
  icon: LucideIcon;
  accent: string;
  bg: string;
}

const CATEGORIES: Record<CategoryKey, CategoryDef> = {
  predicted_opportunities: { key: "predicted_opportunities", label: "Predicted Opportunities", icon: Sparkles,      accent: "text-fuchsia-600", bg: "bg-fuchsia-50" },
  proposal_drafts:   { key: "proposal_drafts",   label: "Proposal Drafts",   icon: FileText,      accent: "text-indigo-600",  bg: "bg-indigo-50" },
  follow_ups:        { key: "follow_ups",        label: "Follow-ups",        icon: MessageSquare, accent: "text-violet-600",  bg: "bg-violet-50" },
  new_business:      { key: "new_business",      label: "New Business",      icon: TrendingUp,    accent: "text-emerald-600", bg: "bg-emerald-50" },
  collections:       { key: "collections",       label: "Collections",       icon: AlertCircle,   accent: "text-amber-600",   bg: "bg-amber-50" },
  re_engagement:     { key: "re_engagement",     label: "Re-engagement",     icon: RefreshCw,     accent: "text-sky-600",     bg: "bg-sky-50" },
  order_updates:     { key: "order_updates",     label: "Order Updates",     icon: Package,       accent: "text-indigo-600",  bg: "bg-indigo-50" },
  store_suggestions: { key: "store_suggestions", label: "Store Suggestions", icon: Store,         accent: "text-rose-600",    bg: "bg-rose-50" },
  other:             { key: "other",             label: "Other",             icon: Sparkles,      accent: "text-mt-ink-3",    bg: "bg-mt-surface-2" },
};

// Predictions lead the briefing because they surface forward-looking
// revenue signal the distributor won't otherwise see in their day.
// Proposal Drafts sit directly beneath so the "take action" follow-through
// on each predicted opportunity is always one glance away.
const CATEGORY_ORDER: CategoryKey[] = [
  "predicted_opportunities",
  "proposal_drafts",
  "follow_ups",
  "collections",
  "re_engagement",
  "new_business",
  "order_updates",
  "store_suggestions",
  "other",
];

/*  Scan-progress steps. Order matches the briefing cron scans on the
    server, but the steps animate on a client timer (not real progress
    events) — the server doesn't stream per-scan status. The animation
    floors the perceived duration at ~3s so even a fast scan feels
    substantial; a slow scan holds the last step until the server
    actually finishes.                                                   */
const SCAN_STEPS: string[] = [
  "Checking overdue invoices",
  "Scanning dormant clients",
  "Reviewing viewed proposals",
  "Checking expiring proposals",
  "Scanning reorder windows",
  "Checking store engagement",
  "Forecasting reorder patterns",
];

function classifyTrigger(triggerType: TriggerType): CategoryKey {
  switch (triggerType) {
    case "predictive_opportunity":
      return "predicted_opportunities";
    case "predictive_proposal_draft":
      return "proposal_drafts";
    case "proposal_viewed":
    case "proposal_expiring":
    case "proposal_accepted":
      return "follow_ups";
    case "new_client":
    case "reorder_window":
      return "new_business";
    case "invoice_overdue":
      return "collections";
    case "client_dormant":
      return "re_engagement";
    case "order_delivered":
      return "order_updates";
    case "store_created":
    case "store_low_engagement":
      return "store_suggestions";
    default:
      return "other";
  }
}

/** Best-effort client name for the card header. */
function clientNameFromArgs(args: Record<string, unknown>, summary: string): string {
  const to = typeof args.to === "string" ? args.to : "";
  if (to) {
    // Email addresses are the reliable hook — pull the domain's first label
    // only when the local part looks generic (info@, hello@, etc.). Otherwise
    // prefer the local part's humanised form.
    const [local, domain] = to.split("@");
    const GENERIC = new Set(["info", "hello", "contact", "support", "sales", "team", "admin"]);
    if (local && !GENERIC.has(local.toLowerCase())) {
      return humaniseSlug(local);
    }
    if (domain) {
      const base = domain.split(".")[0] ?? domain;
      return humaniseSlug(base);
    }
  }
  // Fall back to the first capitalised phrase in the summary.
  const match = summary.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/);
  return match?.[1] ?? "Client";
}

function humaniseSlug(raw: string): string {
  return raw
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(full: string | undefined | null): string {
  if (!full) return "there";
  const first = full.trim().split(/\s+/)[0];
  return first || "there";
}

/**
 * Lightweight markdown renderer for Copilot-generated summaries.
 *
 * Mirrors the pattern used in DashboardAIChat: sanitize each line through
 * DOMPurify, then handle bold (`**foo**`), bullet lists (`- ` / `• `), and
 * numbered lists. Empty lines collapse into spacing rows. We intentionally
 * avoid pulling in a markdown dependency — the LLM only emits a small
 * subset of syntax in its inbox summaries.
 */
function renderInboxMarkdown(text: string): React.JSX.Element[] {
  return text.split("\n").map((line, i) => {
    const inline = DOMPurify.sanitize(
      line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
      { ALLOWED_TAGS: ["strong", "em", "span"], ALLOWED_ATTR: ["class"] },
    );
    if (line.startsWith("• ") || line.startsWith("- ")) {
      return (
        <div
          key={i}
          className="flex gap-2 ml-1"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(
              `<span class="text-mt-ink-4">•</span><span>${inline.slice(2)}</span>`,
              { ALLOWED_TAGS: ["span", "strong", "em"], ALLOWED_ATTR: ["class"] },
            ),
          }}
        />
      );
    }
    const numMatch = line.match(/^(\d+)\.\s/);
    if (numMatch) {
      return (
        <div
          key={i}
          className="flex gap-2 ml-1"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(
              `<span class="text-mt-ink-4 font-medium">${numMatch[1]}.</span><span>${inline.slice(numMatch[0].length)}</span>`,
              { ALLOWED_TAGS: ["span", "strong", "em"], ALLOWED_ATTR: ["class"] },
            ),
          }}
        />
      );
    }
    if (line === "") return <div key={i} className="h-2" />;
    return <div key={i} dangerouslySetInnerHTML={{ __html: inline }} />;
  });
}

interface PendingItem {
  id: number;
  toolName: string;
  summary: string;
  source: string | null;
  args: Record<string, unknown>;
  createdAt: Date | string;
  triggerType: TriggerType;
  category: CategoryKey;
  isEmail: boolean;
  /** LLM-reported confidence (0..1). Null when the action was created
   *  before V2 added the field — treated as "unknown" by the UI. */
  confidence: number | null;
}

/** Threshold at which a pending action earns the "high confidence" pill. */
const HIGH_CONFIDENCE_THRESHOLD = 0.8;

function normalize(raw: {
  id: number;
  toolName: string;
  summary: string;
  source: string | null;
  args: Record<string, unknown>;
  createdAt: Date | string;
}): PendingItem {
  const triggerType = (typeof raw.args.triggerType === "string"
    ? raw.args.triggerType
    : "unknown") as TriggerType;
  const rawConfidence = raw.args.confidence;
  const confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : null;
  return {
    ...raw,
    triggerType,
    category: classifyTrigger(triggerType),
    isEmail: raw.toolName === "send_custom_email",
    confidence,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AgentInbox() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();

  const { data: proposals, isLoading } = trpc.actionApproval.listPending.useQuery(
    { source: "agent" },
    { refetchInterval: 30_000, staleTime: 25_000 },
  );
  const { data: agentStatus } = trpc.actionApproval.agentStatus.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const invalidate = () =>
    Promise.all([
      utils.actionApproval.listPending.invalidate(),
      utils.actionApproval.agentStatus.invalidate(),
    ]);

  const approveMutation = trpc.actionApproval.approve.useMutation({ onSuccess: invalidate });
  const denyMutation = trpc.actionApproval.deny.useMutation({ onSuccess: invalidate });

  /* ---- scan-progress modal state ---------------------------------- */
  /*  stepIndex convention:
   *    -1            : modal closed
   *     0..4         : that step is the active (spinner) step
   *     5            : last step active — held here until server responds
   *     6            : all steps done, summary visible
   *  scanServerDone flips when the awaited invalidate() resolves. The
   *  animation effect only promotes 5→6 once scanServerDone is true, so
   *  a fast scan still plays the full 6-step animation and a slow scan
   *  keeps spinning on the last step until the real work finishes.      */
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanStepIndex, setScanStepIndex] = useState(-1);
  const [scanServerDone, setScanServerDone] = useState(false);
  const [newActionsCount, setNewActionsCount] = useState<number | null>(null);
  const countBeforeScanRef = useRef(0);

  const resetScanState = () => {
    setScanModalOpen(false);
    setScanStepIndex(-1);
    setScanServerDone(false);
    setNewActionsCount(null);
  };

  /*  Scan mutation — modal drives the UX; toast only surfaces errors.   */
  const triggerScanMutation = trpc.agent.triggerScan.useMutation({
    onSuccess: async () => {
      await invalidate();
      setScanServerDone(true);
    },
    onError: () => {
      resetScanState();
      toast.error("Scan failed, please try again");
    },
  });

  const rawItems: PendingItem[] = useMemo(
    () => (proposals ?? []).map(normalize),
    [proposals],
  );

  /**
   * Dedupe repeat notifications. The agent can fire the same trigger
   * multiple times for the same entity (e.g. a re-engagement nudge for the
   * same dormant client on consecutive scans). We keep the most recent one
   * per unique (triggerType, entity) pair so the inbox doesn't grow into a
   * queue of near-duplicates. Entity key falls back to the row id when no
   * clientId/proposalId is present, which leaves truly distinct actions
   * untouched.
   */
  const items: PendingItem[] = useMemo(() => {
    const map = new Map<string, PendingItem>();
    for (const item of rawItems) {
      const entityKey =
        typeof item.args.clientId === "number"
          ? `c${item.args.clientId}`
          : typeof item.args.proposalId === "number"
            ? `p${item.args.proposalId}`
            : `i${item.id}`;
      const key = `${item.triggerType}-${entityKey}`;
      const existing = map.get(key);
      if (!existing || new Date(existing.createdAt).getTime() < new Date(item.createdAt).getTime()) {
        map.set(key, item);
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [rawItems]);

  const startScan = () => {
    if (scanModalOpen || triggerScanMutation.isPending) return;
    countBeforeScanRef.current = items.length;
    setScanModalOpen(true);
    setScanStepIndex(0);
    setScanServerDone(false);
    setNewActionsCount(null);
    triggerScanMutation.mutate();
  };

  /*  Step advancement — each tick is 600ms. Stops at step 5 until the
      server finishes, then a short 400ms pause before flipping to 6.     */
  useEffect(() => {
    if (!scanModalOpen || scanStepIndex < 0) return;
    if (scanStepIndex < SCAN_STEPS.length - 1) {
      const t = setTimeout(() => setScanStepIndex(scanStepIndex + 1), 600);
      return () => clearTimeout(t);
    }
    if (scanStepIndex === SCAN_STEPS.length - 1 && scanServerDone) {
      const t = setTimeout(() => setScanStepIndex(SCAN_STEPS.length), 400);
      return () => clearTimeout(t);
    }
  }, [scanModalOpen, scanStepIndex, scanServerDone]);

  /*  Compute new-actions count once all steps are done. Delta of pending
      items (not a timestamp filter) — clamped at 0 so concurrent dismissals
      can't produce a negative count.                                      */
  useEffect(() => {
    if (scanStepIndex !== SCAN_STEPS.length) return;
    const delta = Math.max(0, items.length - countBeforeScanRef.current);
    setNewActionsCount(delta);
  }, [scanStepIndex, items.length]);

  /*  Auto-close 1.5s after reaching the "all done" state. Resets inlined
      so the effect depends only on scanStepIndex and stays stable.        */
  useEffect(() => {
    if (scanStepIndex !== SCAN_STEPS.length) return;
    const t = setTimeout(() => {
      setScanModalOpen(false);
      setScanStepIndex(-1);
      setScanServerDone(false);
      setNewActionsCount(null);
    }, 1500);
    return () => clearTimeout(t);
  }, [scanStepIndex]);

  const emailItems = items.filter((i) => i.isEmail);

  const groupedByCategory = useMemo(() => {
    const map = new Map<CategoryKey, PendingItem[]>();
    for (const it of items) {
      const list = map.get(it.category) ?? [];
      list.push(it);
      map.set(it.category, list);
    }
    return map;
  }, [items]);

  /* ---- drawer state ---- */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const openDrawer = (item: PendingItem) => {
    setSelectedId(item.id);
    setEditedSubject(typeof item.args.subject === "string" ? item.args.subject : "");
    setEditedBody(
      typeof item.args.body === "string"
        ? item.args.body
        : typeof item.args.draft === "string"
          ? item.args.draft
          : "",
    );
  };
  const closeDrawer = () => setSelectedId(null);

  /* ---- detail dialog state (click-through view) ---- */
  // Card-body click opens this dialog. It shows the agent's full reasoning,
  // affected business records with deep-links, and a recommended-action set
  // tailored to the trigger type. The legacy email-editor drawer is still
  // reachable via the dialog's "Edit & Approve" recommended action so we
  // don't duplicate the editing surface.
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailItem = items.find((i) => i.id === detailId) ?? null;
  const closeDetail = () => setDetailId(null);
  const openDetail = (item: PendingItem) => setDetailId(item.id);

  /* ---- bulk approve state ---- */
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkInFlight, setBulkInFlight] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ succeeded: number; failed: number; firstError?: string } | null>(null);

  /* ---- multi-select state (checkbox bulk actions) ---- */
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActionInFlight, setBulkActionInFlight] = useState(false);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectAll = () => setSelectedIds(new Set(items.map((i) => i.id)));
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const selectedEmailItems = selectedItems.filter((i) => i.isEmail);

  const runBulkDismiss = async () => {
    setBulkActionInFlight(true);
    let ok = 0;
    for (const it of selectedItems) {
      try {
        await denyMutation.mutateAsync({ pendingActionId: it.id });
        ok++;
      } catch { /* continue on failure */ }
    }
    setBulkActionInFlight(false);
    clearSelection();
    toast.success(`Dismissed ${ok} item${ok === 1 ? "" : "s"}`);
  };

  const runBulkApproveSelected = async () => {
    setBulkActionInFlight(true);
    let ok = 0;
    for (const it of selectedEmailItems) {
      try {
        await approveMutation.mutateAsync({ pendingActionId: it.id });
        ok++;
      } catch { /* continue on failure */ }
    }
    setBulkActionInFlight(false);
    clearSelection();
    toast.success(`Approved ${ok} email${ok === 1 ? "" : "s"}`);
  };

  /* ---- "Summarize inbox" state ---- */
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const summaryMutation = trpc.copilot.chat.useMutation();

  const runSummarize = async () => {
    if (items.length === 0 || summaryMutation.isPending) return;
    const summaryPrompt = `Summarize my agent inbox and tell me what needs my attention most urgently. Here are my ${items.length} pending actions:\n\n${items.slice(0, 15).map((item, i) => `${i + 1}. ${item.summary}`).join('\n')}\n\nGive me a concise 3-4 sentence summary of the most urgent items and what I should do first. Be specific — use the actual client names and details from the list above.`;
    setSummaryOpen(true);
    setSummaryText(null);
    try {
      const result = await summaryMutation.mutateAsync({
        message: summaryPrompt,
        conversationHistory: [],
        context: { page: "/agent-inbox" },
      });
      setSummaryText(result.reply);
    } catch (err: unknown) {
      setSummaryText(err instanceof Error ? err.message : "Summary failed");
    }
  };

  const runBulkApproveEmails = async () => {
    setBulkInFlight(true);
    setBulkResult(null);
    let succeeded = 0;
    let failed = 0;
    let firstError: string | undefined;
    // Serialised to stay within the 10-emails/hour org-level rate limit and
    // to keep the in-flight mutation queue predictable (and cancelable, if
    // the user closes the tab mid-run — each call is already idempotent).
    for (const it of emailItems) {
      try {
        await approveMutation.mutateAsync({ pendingActionId: it.id });
        succeeded += 1;
      } catch (err: unknown) {
        failed += 1;
        if (!firstError) {
          firstError = err instanceof Error ? err.message : String(err);
        }
      }
    }
    setBulkInFlight(false);
    setBulkConfirmOpen(false);
    setBulkResult({ succeeded, failed, firstError });
  };

  /* ---- approve / edit&approve / dismiss handlers ---- */

  const approveDirect = (item: PendingItem) => {
    approveMutation.mutate({ pendingActionId: item.id });
  };

  const approveWithEdits = () => {
    if (!selected) return;
    const originalSubject = typeof selected.args.subject === "string" ? selected.args.subject : "";
    const originalBody =
      typeof selected.args.body === "string"
        ? selected.args.body
        : typeof selected.args.draft === "string"
          ? selected.args.draft
          : "";
    const subjectChanged = editedSubject.trim() !== originalSubject.trim();
    const bodyChanged = editedBody.trim() !== originalBody.trim();

    // Preserve every field on args and only overwrite subject/body so
    // executeSendCustomEmail still gets {to, subject, body, ...} intact.
    const editedArgs: Record<string, unknown> = { ...selected.args };
    if (selected.isEmail) {
      editedArgs.subject = editedSubject;
      editedArgs.body = editedBody;
    } else {
      // Non-email pending actions store the body under `draft`.
      editedArgs.draft = editedBody;
    }

    const anythingEdited = subjectChanged || bodyChanged;
    approveMutation.mutate(
      anythingEdited
        ? { pendingActionId: selected.id, editedArgs }
        : { pendingActionId: selected.id },
    );
    closeDrawer();
  };

  const denyAction = (item: PendingItem) => {
    denyMutation.mutate({ pendingActionId: item.id });
  };

  const denyFromDrawer = () => {
    if (!selected) return;
    denyMutation.mutate({ pendingActionId: selected.id });
    closeDrawer();
  };

  /* ---- derived header values ---- */

  const now = new Date();
  const greeting = `${greetingForHour(now.getHours())}, ${firstName(user?.name ?? user?.email)}`;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Sidebar offset is applied by AppShell's motion wrapper (reacts to collapse
         state); this main column just handles its own top padding for the mobile
         header bar. */}
      <main className="pt-14 xl:pt-0">
        <div className="max-w-[960px] mx-auto px-4 sm:px-6 py-10">
          {/* ── Morning briefing header ─────────────────────────── */}
          <div className="flex items-start gap-4 mb-10">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
              <BrainCircuit size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[22px] font-semibold text-mt-ink tracking-tight">
                {greeting}
              </h1>
              <p className="text-[13px] text-mt-ink-3 mt-0.5">
                {items.length === 0
                  ? "Your agent is watching. New actions will appear here."
                  : `${items.length} action${items.length === 1 ? "" : "s"} ready for review`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <button
                  onClick={runSummarize}
                  disabled={summaryMutation.isPending}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold text-mt-ink-2 bg-mt-surface-2 hover:bg-mt-border disabled:opacity-50 transition-colors"
                >
                  {summaryMutation.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  Summarize
                </button>
              )}
              {items.length > 0 && (
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-mt-ink-3 cursor-pointer select-none hover:bg-mt-surface-2 transition-colors">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => (allSelected ? clearSelection() : selectAll())}
                    className="h-3.5 w-3.5 rounded border-mt-border accent-violet-600"
                  />
                  Select all
                </label>
              )}
              {emailItems.length >= 1 && (
                <button
                  onClick={() => setBulkConfirmOpen(true)}
                  disabled={bulkInFlight}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 shadow-sm transition-colors"
                >
                  <Check size={14} />
                  {bulkInFlight ? "Approving…" : `Approve All Emails (${emailItems.length})`}
                </button>
              )}
            </div>
          </div>

          {/* ── Bulk result banner ──────────────────────────────── */}
          <AnimatePresence>
            {bulkResult && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className={`mb-6 rounded-xl border px-4 py-3 text-[13px] flex items-start gap-3 ${
                  bulkResult.failed === 0
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-amber-50 border-amber-200 text-amber-900"
                }`}
              >
                <div className="flex-1">
                  {bulkResult.failed === 0 ? (
                    <span>
                      <strong>{bulkResult.succeeded}</strong>{" "}
                      email{bulkResult.succeeded === 1 ? "" : "s"} sent.
                    </span>
                  ) : (
                    <>
                      <div>
                        <strong>{bulkResult.succeeded}</strong> sent,{" "}
                        <strong>{bulkResult.failed}</strong> failed.
                      </div>
                      {bulkResult.firstError && (
                        <div className="text-[12px] mt-0.5 text-amber-800/80">
                          {bulkResult.firstError}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <button
                  onClick={() => setBulkResult(null)}
                  className="text-current opacity-60 hover:opacity-100"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Loading skeleton ────────────────────────────────── */}
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl animate-pulse bg-white border border-mt-border"
                />
              ))}
            </div>
          )}

          {/* ── Empty state ─────────────────────────────────────── */}
          {!isLoading && items.length === 0 && (
            <EmptyState
              lastAgentActivityAt={agentStatus?.lastAgentActivityAt ?? null}
              onRunScan={startScan}
              scanInFlight={triggerScanMutation.isPending || scanModalOpen}
            />
          )}

          {/* ── Categorised sections ────────────────────────────── */}
          {!isLoading && items.length > 0 && (
            <div className="space-y-8">
              {CATEGORY_ORDER.map((catKey) => {
                const list = groupedByCategory.get(catKey);
                if (!list || list.length === 0) return null;
                const cat = CATEGORIES[catKey];
                const Icon = cat.icon;
                return (
                  <section key={catKey}>
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className={`w-7 h-7 rounded-lg ${cat.bg} flex items-center justify-center`}>
                        <Icon size={14} className={cat.accent} />
                      </div>
                      <h2 className="text-[13px] font-semibold text-mt-ink tracking-tight">
                        {cat.label}
                      </h2>
                      <span className="text-[11px] text-mt-ink-4 font-medium">
                        {list.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      <AnimatePresence>
                        {list.map((item) => {
                          const checkbox = (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelected(item.id)}
                              aria-label="Select action"
                              className="mt-5 h-4 w-4 rounded border-mt-border accent-violet-600 shrink-0 cursor-pointer"
                            />
                          );
                          return (
                            <div key={item.id} className="flex items-start gap-3">
                              {checkbox}
                              <div className="flex-1 min-w-0">
                                {item.triggerType === "predictive_proposal_draft" ? (
                                  <ProposalDraftCard
                                    item={item}
                                    onOpenDetail={() => openDetail(item)}
                                    onReview={() => {
                                      const pid = item.args.proposalId;
                                      if (typeof pid === "number" && pid > 0) {
                                        navigate(`/edit-proposal/${pid}`);
                                      } else {
                                        toast.error("Proposal reference is missing");
                                      }
                                    }}
                                    onDismiss={() => denyAction(item)}
                                    denying={denyMutation.isPending}
                                  />
                                ) : (
                                  <ActionCard
                                    item={item}
                                    onOpenDetail={() => openDetail(item)}
                                    onReview={() => openDrawer(item)}
                                    onApprove={() => approveDirect(item)}
                                    onDismiss={() => denyAction(item)}
                                    approving={approveMutation.isPending}
                                    denying={denyMutation.isPending}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ── Detail dialog (click-through view) ─────────────────── */}
      <AnimatePresence>
        {detailItem && (
          <DetailDialog
            item={detailItem}
            onClose={closeDetail}
            onApprove={() => {
              approveDirect(detailItem);
              closeDetail();
            }}
            onDismiss={() => {
              denyAction(detailItem);
              closeDetail();
            }}
            onEditEmail={() => {
              closeDetail();
              openDrawer(detailItem);
            }}
            onNavigate={(href) => {
              closeDetail();
              navigate(href);
            }}
            approving={approveMutation.isPending}
            denying={denyMutation.isPending}
          />
        )}
      </AnimatePresence>

      {/* ── Drawer ───────────────────────────────────────────── */}
      <AnimatePresence>
        {selected && (
          <Drawer
            item={selected}
            editedSubject={editedSubject}
            editedBody={editedBody}
            onSubjectChange={setEditedSubject}
            onBodyChange={setEditedBody}
            onClose={closeDrawer}
            onApprove={approveWithEdits}
            onDeny={denyFromDrawer}
            approving={approveMutation.isPending}
            denying={denyMutation.isPending}
          />
        )}
      </AnimatePresence>

      {/* ── Bulk approve confirmation ───────────────────────── */}
      <ConfirmDialog
        open={bulkConfirmOpen}
        title={`Send ${emailItems.length} email${emailItems.length === 1 ? "" : "s"}?`}
        description="Each email will be sent to its recipient using your connected account or the platform fallback. Only email actions are approved — other pending items are left untouched."
        confirmLabel={bulkInFlight ? "Sending…" : `Send ${emailItems.length}`}
        confirmVariant="primary"
        loading={bulkInFlight}
        onCancel={() => setBulkConfirmOpen(false)}
        onConfirm={runBulkApproveEmails}
      />

      {/* ── Scan-progress modal ─────────────────────────────── */}
      <AnimatePresence>
        {scanModalOpen && (
          <ScanProgressModal
            stepIndex={scanStepIndex}
            newActionsCount={newActionsCount}
          />
        )}
      </AnimatePresence>

      {/* ── Floating multi-select action bar ─────────────────── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white border border-[#E5E5E5] rounded-2xl px-4 py-2.5 shadow-[0_4px_20px_rgba(0,0,0,0.12)] z-[10005]"
          >
            <span className="text-[12px] font-semibold text-mt-ink px-1">
              {selectedIds.size} selected
            </span>
            <button
              onClick={runBulkDismiss}
              disabled={bulkActionInFlight}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-mt-ink-2 bg-mt-surface-2 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              Dismiss Selected ({selectedIds.size})
            </button>
            {selectedEmailItems.length > 0 && (
              <button
                onClick={runBulkApproveSelected}
                disabled={bulkActionInFlight}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircle size={13} />
                Approve Selected ({selectedEmailItems.length})
              </button>
            )}
            <button
              onClick={clearSelection}
              disabled={bulkActionInFlight}
              className="w-7 h-7 rounded-lg hover:bg-mt-surface-2 flex items-center justify-center text-mt-ink-4 disabled:opacity-50"
              aria-label="Clear selection"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Inbox summary modal (AI-generated) ──────────────── */}
      {/* `flex items-center justify-center` centers the inner card both
         vertically and horizontally inside the full-viewport overlay.
         An earlier version of this modal rendered at the bottom of the
         viewport because the flex container was missing those classes. */}
      <AnimatePresence>
        {summaryOpen && (
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[10002] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSummaryOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[85vh] overflow-y-auto p-6 z-[10003]"
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
                  <Sparkles size={16} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[15px] font-semibold text-mt-ink">Inbox summary</h2>
                  <p className="text-[11.5px] text-mt-ink-4">AI-generated overview</p>
                </div>
                <button
                  onClick={() => setSummaryOpen(false)}
                  className="w-7 h-7 rounded-lg hover:bg-mt-surface-2 flex items-center justify-center text-mt-ink-4"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
              {summaryText === null ? (
                <div className="flex items-center gap-2 py-4 text-[13px] text-mt-ink-3">
                  <Loader2 size={14} className="animate-spin" /> Generating summary…
                </div>
              ) : (
                <div className="text-[13.5px] text-mt-ink-2 leading-relaxed space-y-1">
                  {renderInboxMarkdown(summaryText)}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

interface ActionCardProps {
  item: PendingItem;
  onOpenDetail: () => void;
  onReview: () => void;
  onApprove: () => void;
  onDismiss: () => void;
  approving: boolean;
  denying: boolean;
}

function ActionCard({ item, onOpenDetail, onReview, onApprove, onDismiss, approving, denying }: ActionCardProps) {
  const cat = CATEGORIES[item.category];
  const Icon = cat.icon;
  const client = clientNameFromArgs(item.args, item.summary);
  const subject = typeof item.args.subject === "string" ? item.args.subject : null;
  const body =
    typeof item.args.body === "string"
      ? item.args.body
      : typeof item.args.draft === "string"
        ? item.args.draft
        : "";

  // Predicted opportunities carry the detected ordering pattern; rendering
  // it under the body preview makes the forward-looking reasoning visible
  // without forcing the distributor to open the drawer.
  const isPredictive = item.triggerType === "predictive_opportunity";
  const patternSummary =
    isPredictive && typeof item.args.patternSummary === "string"
      ? item.args.patternSummary
      : null;

  // Confidence pill:
  //   • Predicted opportunities always show a pill — the confidence score
  //     is the core signal for this category. Green "High confidence" when
  //     >= 0.8, grey "Pattern confidence N%" otherwise.
  //   • Every other category only shows the green high-confidence pill
  //     when the score clears the threshold (legacy behaviour preserved).
  const isHighConfidence =
    item.confidence !== null && item.confidence >= HIGH_CONFIDENCE_THRESHOLD;
  const showLowConfidencePatternPill = isPredictive && !isHighConfidence;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="bg-white rounded-xl border border-mt-border p-5 hover:shadow-sm transition-shadow group"
    >
      <div className="flex flex-col sm:flex-row items-start gap-4">
        <button
          type="button"
          onClick={onOpenDetail}
          aria-label="View action details"
          className="flex-1 flex flex-col sm:flex-row items-start gap-4 text-left min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 rounded-lg"
        >
        <div className={`w-9 h-9 rounded-lg ${cat.bg} flex items-center justify-center flex-shrink-0`}>
          <Icon size={16} className={cat.accent} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[13.5px] font-semibold text-mt-ink truncate">{client}</span>
            <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full ${cat.bg} ${cat.accent}`}>
              {cat.label}
            </span>
            {isHighConfidence && (
              <span
                className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"
                title={`Agent confidence: ${Math.round((item.confidence ?? 0) * 100)}%`}
              >
                <Check size={10} strokeWidth={3} />
                High confidence
              </span>
            )}
            {showLowConfidencePatternPill && (
              <span
                className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-mt-surface-2 text-mt-ink-3"
                title={
                  item.confidence !== null
                    ? `Pattern confidence: ${Math.round(item.confidence * 100)}%`
                    : "Pattern confidence unavailable"
                }
              >
                {item.confidence !== null
                  ? `Pattern confidence ${Math.round(item.confidence * 100)}%`
                  : "Pattern confidence"}
              </span>
            )}
          </div>
          {subject && (
            <p className="text-[13px] text-mt-ink-2 font-medium truncate mb-1">
              {subject}
            </p>
          )}
          <p className="text-[12.5px] text-mt-ink-3 line-clamp-2 leading-relaxed">
            {body || item.summary}
          </p>
          {patternSummary && (
            <p className="text-[11.5px] text-fuchsia-700 mt-2 leading-snug">
              {patternSummary}
            </p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <span className="flex items-center gap-1 text-[11px] text-mt-ink-4">
              <Clock size={11} />
              {timeAgo(item.createdAt)}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-violet-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowUpRight size={11} />
              View details
            </span>
          </div>
        </div>
        </button>
        <div className="flex flex-col gap-2 flex-shrink-0 items-stretch w-full sm:w-auto sm:min-w-[126px]">
          <button
            onClick={onApprove}
            disabled={approving}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            <CheckCircle size={13} />
            Approve
          </button>
          <button
            onClick={onReview}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-mt-ink-2 bg-mt-surface-2 hover:bg-mt-border transition-colors"
          >
            <Pencil size={12} />
            Edit &amp; Approve
          </button>
          <button
            onClick={onDismiss}
            disabled={denying}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-mt-ink-3 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
          >
            Dismiss
          </button>
        </div>
        <ChevronRight size={15} className="text-mt-ink-4 opacity-0 group-hover:opacity-100 transition-opacity self-center" />
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

interface ProposalDraftCardProps {
  item: PendingItem;
  onOpenDetail: () => void;
  onReview: () => void;
  onDismiss: () => void;
  denying: boolean;
}

/**
 * Card for `predictive_proposal_draft` actions — a draft proposal has
 * already been persisted, so this card is a navigation surface, not an
 * LLM-draft review. "Review Draft" routes to the proposal editor;
 * "Dismiss" marks the pending action denied without touching the
 * underlying proposal (the distributor can still find the draft under
 * Proposals).
 */
function ProposalDraftCard({ item, onOpenDetail, onReview, onDismiss, denying }: ProposalDraftCardProps) {
  const cat = CATEGORIES.proposal_drafts;
  const Icon = cat.icon;
  const clientName =
    typeof item.args.clientName === "string" && item.args.clientName.length > 0
      ? item.args.clientName
      : clientNameFromArgs(item.args, item.summary);
  const proposalTitle =
    typeof item.args.proposalTitle === "string" ? item.args.proposalTitle : item.summary;
  const estimatedValueRaw = item.args.estimatedValue;
  const estimatedValue =
    typeof estimatedValueRaw === "string" || typeof estimatedValueRaw === "number"
      ? formatCurrency(estimatedValueRaw)
      : "—";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="bg-white rounded-xl border border-mt-border p-5 hover:shadow-sm transition-shadow group"
    >
      <div className="flex flex-col sm:flex-row items-start gap-4">
        <button
          type="button"
          onClick={onOpenDetail}
          aria-label="View proposal draft details"
          className="flex-1 flex flex-col sm:flex-row items-start gap-4 text-left min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 rounded-lg"
        >
        <div className={`w-9 h-9 rounded-lg ${cat.bg} flex items-center justify-center flex-shrink-0`}>
          <Icon size={16} className={cat.accent} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[13.5px] font-semibold text-mt-ink truncate">{clientName}</span>
            <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full ${cat.bg} ${cat.accent}`}>
              {cat.label}
            </span>
          </div>
          <p className="text-[13px] text-mt-ink-2 font-medium truncate mb-1">
            {proposalTitle}
          </p>
          <p className="text-[12.5px] text-mt-ink-3 leading-relaxed">
            Estimated value <span className="font-semibold text-mt-ink-2">{estimatedValue}</span>
          </p>
          <div className="flex items-center gap-2 mt-3">
            <span className="flex items-center gap-1 text-[11px] text-mt-ink-4">
              <Clock size={11} />
              {timeAgo(item.createdAt)}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-violet-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowUpRight size={11} />
              View details
            </span>
          </div>
        </div>
        </button>
        <div className="flex flex-col gap-2 flex-shrink-0 items-stretch w-full sm:w-auto sm:min-w-[126px]">
          <button
            onClick={onReview}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            <FileText size={12} />
            Review Draft
          </button>
          <button
            onClick={onDismiss}
            disabled={denying}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-mt-ink-3 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
          >
            Dismiss
          </button>
        </div>
        <ChevronRight size={15} className="text-mt-ink-4 opacity-0 group-hover:opacity-100 transition-opacity self-center" />
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

interface DrawerProps {
  item: PendingItem;
  editedSubject: string;
  editedBody: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onClose: () => void;
  onApprove: () => void;
  onDeny: () => void;
  approving: boolean;
  denying: boolean;
}

function Drawer({
  item,
  editedSubject,
  editedBody,
  onSubjectChange,
  onBodyChange,
  onClose,
  onApprove,
  onDeny,
  approving,
  denying,
}: DrawerProps) {
  const cat = CATEGORIES[item.category];
  const Icon = cat.icon;
  const recipient = typeof item.args.to === "string" ? item.args.to : null;
  const originalSubject = typeof item.args.subject === "string" ? item.args.subject : "";
  const originalBody =
    typeof item.args.body === "string"
      ? item.args.body
      : typeof item.args.draft === "string"
        ? item.args.draft
        : "";
  const edited =
    (item.isEmail && editedSubject.trim() !== originalSubject.trim()) ||
    editedBody.trim() !== originalBody.trim();

  return (
    <>
      <motion.div
        className="fixed inset-0 bg-black/25 z-[60]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed right-0 top-0 bottom-0 w-full max-w-[560px] bg-white shadow-2xl z-[61] flex flex-col"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-mt-border">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg ${cat.bg} flex items-center justify-center`}>
              <Icon size={16} className={cat.accent} />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-mt-ink">{cat.label}</p>
              <p className="text-[11px] text-mt-ink-4">{timeAgo(item.createdAt)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-mt-surface-2 flex items-center justify-center text-mt-ink-4"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-1.5 block">
              Summary
            </label>
            <p className="text-[13.5px] text-mt-ink leading-relaxed">{item.summary}</p>
          </div>

          {recipient && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-1.5 block">
                Recipient
              </label>
              <p className="text-[13px] text-mt-ink-2">{recipient}</p>
            </div>
          )}

          {item.isEmail && (
            <div>
              <label
                htmlFor="agent-inbox-subject"
                className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-1.5 block"
              >
                Subject
              </label>
              <input
                id="agent-inbox-subject"
                type="text"
                value={editedSubject}
                onChange={(e) => onSubjectChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13.5px] text-mt-ink focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                placeholder="Email subject"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="agent-inbox-body"
              className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-1.5 block"
            >
              {item.isEmail ? "Email body" : "Proposed action"}
            </label>
            <textarea
              id="agent-inbox-body"
              value={editedBody}
              onChange={(e) => onBodyChange(e.target.value)}
              rows={14}
              className="w-full px-3 py-2.5 rounded-lg border border-mt-border text-[13px] text-mt-ink focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 leading-relaxed resize-none font-mono"
              placeholder="Draft content"
            />
          </div>

          {edited && (
            <div className="text-[11.5px] text-violet-700 bg-violet-50 px-3 py-2 rounded-lg border border-violet-100">
              Your edits will be saved and flagged so the agent learns from them.
            </div>
          )}
        </div>

        {/* Drawer footer */}
        <div className="px-6 py-4 border-t border-mt-border flex items-center gap-3">
          <button
            onClick={onApprove}
            disabled={approving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold text-white bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            <CheckCircle size={15} />
            {approving
              ? "Sending…"
              : edited
                ? "Save Edits & Approve"
                : "Approve & Send"}
          </button>
          <button
            onClick={onDeny}
            disabled={denying}
            className="px-5 py-2.5 rounded-lg text-[13px] font-semibold text-mt-ink-3 border border-mt-border hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-50"
          >
            <XCircle size={15} className="inline mr-1.5" />
            Dismiss
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ------------------------------------------------------------------ */

interface DetailDialogProps {
  item: PendingItem;
  onClose: () => void;
  onApprove: () => void;
  onDismiss: () => void;
  onEditEmail: () => void;
  onNavigate: (href: string) => void;
  approving: boolean;
  denying: boolean;
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  client: "Client",
  proposal: "Proposal",
  invoice: "Invoice",
  order: "Order",
  store: "Store",
  supplier: "Supplier",
  product: "Product",
  custom_order_request: "Custom order request",
  purchase_order: "Purchase order",
};

const RECORD_TYPE_ICON: Record<string, LucideIcon> = {
  client: TrendingUp,
  proposal: FileText,
  invoice: AlertCircle,
  order: Package,
  store: Store,
  supplier: Package,
  product: Sparkles,
  custom_order_request: MessageSquare,
  purchase_order: Package,
};

/**
 * DetailDialog — full-context view for a pending agent action.
 *
 * Rendered when the user clicks the body of an inbox card. Loads
 * `actionApproval.getDetails` to get the resolver-built explanation,
 * affected records, and recommended actions.
 *
 * The dialog itself is presentational — it dispatches user intent back
 * to the parent (approve / dismiss / edit email / navigate) so the
 * existing tRPC mutations and edit-drawer continue to be the single
 * source of truth.
 */
function DetailDialog({
  item,
  onClose,
  onApprove,
  onDismiss,
  onEditEmail,
  onNavigate,
  approving,
  denying,
}: DetailDialogProps) {
  const cat = CATEGORIES[item.category];
  const Icon = cat.icon;
  const recipient = typeof item.args.to === "string" ? item.args.to : null;

  const { data, isLoading, error } = trpc.actionApproval.getDetails.useQuery(
    { pendingActionId: item.id },
    { staleTime: 30_000 },
  );

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Action details"
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[640px] max-h-[88vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-6 pb-4 border-b border-mt-border">
          <div className={`w-10 h-10 rounded-xl ${cat.bg} flex items-center justify-center shrink-0`}>
            <Icon size={18} className={cat.accent} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15.5px] font-semibold text-mt-ink tracking-tight">
              {cat.label}
            </h2>
            <p className="text-[12px] text-mt-ink-4 mt-0.5">
              {timeAgo(item.createdAt)}
              {recipient ? ` · to ${recipient}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-mt-surface-2 flex items-center justify-center text-mt-ink-4"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-[13px] text-mt-ink-3">
              <Loader2 size={14} className="animate-spin" /> Loading details…
            </div>
          )}

          {error && (
            <div className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {error.message || "Could not load details — falling back to summary."}
            </div>
          )}

          {/* Summary line is always available — render it even before the
              query resolves so the dialog isn't empty mid-fetch. */}
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-2">
              Summary
            </p>
            <p className="text-[14px] text-mt-ink leading-relaxed">{item.summary}</p>
          </section>

          {data && (
            <>
              <section>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-2">
                  Why the agent flagged this
                </p>
                <p className="text-[13.5px] text-mt-ink-2 leading-relaxed">{data.explanation}</p>
              </section>

              {data.affectedRecords.length > 0 && (
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-2">
                    Affected records
                  </p>
                  <ul className="space-y-2">
                    {data.affectedRecords.map((rec, idx) => {
                      const RecIcon = RECORD_TYPE_ICON[rec.type] ?? Sparkles;
                      const typeLabel = RECORD_TYPE_LABELS[rec.type] ?? rec.type;
                      const linkable = !!rec.href;
                      return (
                        <li
                          key={`${rec.type}-${rec.id}-${idx}`}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border border-mt-border ${linkable ? "hover:bg-mt-surface-2/60 cursor-pointer transition-colors" : ""}`}
                          onClick={() => {
                            if (rec.href) onNavigate(rec.href);
                          }}
                        >
                          <div className="w-8 h-8 rounded-lg bg-mt-surface-2 flex items-center justify-center shrink-0">
                            <RecIcon size={14} className="text-mt-ink-3" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] text-mt-ink-4 leading-tight">{typeLabel}</p>
                            <p className="text-[13px] font-semibold text-mt-ink truncate">
                              {rec.label}
                            </p>
                            {rec.sublabel && (
                              <p className="text-[11.5px] text-mt-ink-3 truncate">{rec.sublabel}</p>
                            )}
                          </div>
                          {linkable && (
                            <ExternalLink size={14} className="text-mt-ink-4 shrink-0" />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Email preview — only for send_custom_email actions; gives
                  the user a read-only glance before they choose Edit & Approve.
                  The full editor still lives in the existing Drawer. */}
              {item.isEmail && (typeof item.args.subject === "string" || typeof item.args.body === "string") && (
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-2">
                    Email draft
                  </p>
                  <div className="rounded-lg border border-mt-border bg-mt-surface-2/40 px-4 py-3">
                    {typeof item.args.subject === "string" && (
                      <p className="text-[13px] font-semibold text-mt-ink mb-1.5">
                        {item.args.subject}
                      </p>
                    )}
                    {typeof item.args.body === "string" && (
                      <p className="text-[12.5px] text-mt-ink-2 whitespace-pre-line leading-relaxed line-clamp-[12]">
                        {item.args.body}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer — recommended actions */}
        <div className="px-6 py-4 border-t border-mt-border bg-mt-surface-2/40 flex flex-wrap gap-2 justify-end">
          {(data?.recommendedActions ?? []).map((rec, idx) => {
            const key = `${rec.kind}-${idx}`;
            switch (rec.kind) {
              case "approve":
                return (
                  <button
                    key={key}
                    onClick={onApprove}
                    disabled={approving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle size={14} />
                    {rec.label}
                  </button>
                );
              case "edit_email":
                return (
                  <button
                    key={key}
                    onClick={onEditEmail}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-mt-ink-2 bg-mt-surface-2 hover:bg-mt-border transition-colors"
                  >
                    <Pencil size={13} />
                    {rec.label}
                  </button>
                );
              case "review_proposal":
              case "navigate":
                return rec.href ? (
                  <button
                    key={key}
                    onClick={() => onNavigate(rec.href!)}
                    className={
                      rec.tone === "primary"
                        ? "flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                        : "flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-mt-ink-2 bg-mt-surface-2 hover:bg-mt-border transition-colors"
                    }
                  >
                    {rec.kind === "review_proposal" ? (
                      <FileText size={13} />
                    ) : (
                      <ArrowUpRight size={13} />
                    )}
                    {rec.label}
                  </button>
                ) : null;
              case "dismiss":
                return (
                  <button
                    key={key}
                    onClick={onDismiss}
                    disabled={denying}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-medium text-mt-ink-3 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                  >
                    <XCircle size={13} />
                    {rec.label}
                  </button>
                );
              default:
                return null;
            }
          })}
          {/* Fallback when details haven't loaded yet — let the user dismiss. */}
          {!data && !isLoading && (
            <button
              onClick={onDismiss}
              disabled={denying}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-medium text-mt-ink-3 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              <XCircle size={13} />
              Dismiss
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  lastAgentActivityAt: Date | string | null;
  onRunScan: () => void;
  scanInFlight: boolean;
}

function EmptyState({
  lastAgentActivityAt,
  onRunScan,
  scanInFlight,
}: EmptyStateProps) {
  const monitoring: Array<{ label: string; icon: LucideIcon; tint: string }> = [
    { label: "Reorder forecasts",      icon: Sparkles,      tint: "text-fuchsia-600" },
    { label: "Proposal follow-ups",    icon: MessageSquare, tint: "text-violet-600" },
    { label: "Overdue invoices",       icon: AlertCircle,   tint: "text-amber-600" },
    { label: "Dormant clients",        icon: RefreshCw,     tint: "text-sky-600" },
    { label: "Re-order opportunities", icon: TrendingUp,    tint: "text-emerald-600" },
    { label: "Order check-ins",        icon: Package,       tint: "text-indigo-600" },
    { label: "Store engagement",       icon: Store,         tint: "text-rose-600" },
  ];

  return (
    <motion.div
      className="bg-white rounded-2xl border border-mt-border p-10 text-center"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-sm">
        <Sparkles size={20} className="text-white" />
      </div>
      <h2 className="text-[16px] font-semibold text-mt-ink mb-1.5">
        Your business is running smoothly.
      </h2>
      <p className="text-[13px] text-mt-ink-3 max-w-md mx-auto mb-6">
        I'll notify you when something needs attention.
      </p>

      <button
        onClick={onRunScan}
        disabled={scanInFlight}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm transition-colors mb-2"
      >
        {scanInFlight ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Play size={13} />
        )}
        {scanInFlight ? "Scanning…" : "Run Agent Scan Now"}
      </button>
      <p className="text-[11px] text-mt-ink-4 mb-8">
        Runs the same scan as the daily cron on-demand.
      </p>

      <div className="max-w-[520px] mx-auto bg-mt-surface-2/60 rounded-xl p-5 border border-mt-border/80 text-left">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4">
            Monitoring
          </p>
          <p className="text-[11px] text-mt-ink-4">
            {lastAgentActivityAt
              ? `Last scan ${timeAgo(lastAgentActivityAt)}`
              : "Scans run every 24h"}
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
          {monitoring.map((m) => {
            const Icon = m.icon;
            return (
              <li key={m.label} className="flex items-center gap-2">
                <Icon size={13} className={m.tint} />
                <span className="text-[12.5px] text-mt-ink-2">{m.label}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

interface ScanProgressModalProps {
  stepIndex: number;
  newActionsCount: number | null;
}

/**
 * ScanProgressModal — blocking progress overlay while the agent scans.
 *
 * Steps animate sequentially; the current step shows a spinner and earlier
 * steps show a green check. The modal is intentionally not dismissable —
 * the parent auto-closes it 1.5s after all steps complete (see the
 * `scanStepIndex` effects in AgentInbox).
 *
 * `stepIndex` semantics mirror the parent: 0..(len-1) is the active step,
 * `len` means everything is done and the summary is visible.
 */
function ScanProgressModal({ stepIndex, newActionsCount }: ScanProgressModalProps) {
  const allDone = stepIndex >= SCAN_STEPS.length;
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Agent scan in progress"
      className="fixed inset-0 z-[10002] flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[460px] p-7"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
      >
        {/* Header */}
        <div className="flex items-start gap-3.5 mb-6">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
            <BrainCircuit size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-semibold text-mt-ink tracking-tight">
              Your AI is scanning your business
            </h2>
            <p className="text-[12.5px] text-mt-ink-3 mt-0.5">
              Preparing your morning briefing…
            </p>
          </div>
        </div>

        {/* Steps */}
        <ul className="space-y-2.5">
          {SCAN_STEPS.map((label, i) => {
            const visible = i <= stepIndex;
            const done = allDone || i < stepIndex;
            const active = !allDone && i === stepIndex;
            return (
              <motion.li
                key={label}
                initial={{ opacity: 0, x: -6 }}
                animate={{
                  opacity: visible ? 1 : 0.35,
                  x: visible ? 0 : -6,
                }}
                transition={{ duration: 0.22 }}
                className="flex items-center gap-3"
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  {done ? (
                    <CheckCircle size={16} className="text-emerald-600" />
                  ) : active ? (
                    <Loader2 size={15} className="animate-spin text-violet-600" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-mt-border" />
                  )}
                </div>
                <span
                  className={
                    active
                      ? "text-[13px] font-medium text-mt-ink"
                      : done
                        ? "text-[13px] text-mt-ink-2"
                        : "text-[13px] text-mt-ink-4"
                  }
                >
                  {label}
                </span>
              </motion.li>
            );
          })}
        </ul>

        {/* Summary — appears only once the count is known */}
        <AnimatePresence>
          {newActionsCount !== null && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-2.5 mt-6 pt-5 border-t border-mt-border"
            >
              <CheckCircle size={17} className="text-emerald-600 shrink-0" />
              <span className="text-[13.5px] font-semibold text-mt-ink">
                {newActionsCount} action{newActionsCount === 1 ? "" : "s"} prepared for your review
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
