import { useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import StripeStatusPill from "@/components/StripeStatusPill";
import NotificationCenter from "@/components/NotificationCenter";
import { AnimatePresence, motion, useSpring } from "framer-motion";
import {
  Store,
  FileText,
  Sparkles,
  ChevronRight,
  Package,
  AlertTriangle,
  Sun,
  Loader2,
  UserPlus,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import DashboardAIChat from "@/components/dashboard/DashboardAIChat";
import DashboardBanners from "@/components/dashboard/DashboardBanners";
import StripeBalanceWidget from "@/components/dashboard/StripeBalanceWidget";
import { toast } from "sonner";

const DASHBOARD_REFRESH_INTERVAL_MS = 60_000;

/*  Time-of-day greeting — mirrors AgentInbox.tsx so the two surfaces
    stay in sync. Kept local (not shared) because it's trivial and
    introducing a shared helper for 8 lines would be premature.          */
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

/*  Rotating placeholders for the AI search bar. Each one is a realistic
    query a distributor might actually type — steers users toward the
    capabilities they haven't discovered yet.                              */
const AI_PLACEHOLDER_QUERIES: string[] = [
  "Which clients haven't ordered in 30 days?",
  "Draft a follow-up for stale proposals",
  "Show me overdue invoices this week",
  "Create a proposal for a new client",
  "What's my gross margin this quarter?",
  "Who's most likely to reorder soon?",
];

const PLACEHOLDER_ROTATE_MS = 3500;

export default function Dashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [chatOpen, setChatOpen] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { data: stats } = trpc.orders.stats.useQuery();
  const { data: reorderData } = trpc.aiInsights.predictiveReorders.useQuery();
  const { data: churnData } = trpc.aiInsights.churnSignals.useQuery();
  const { data: summaryData } = trpc.aiInsights.dashboardSummary.useQuery();
  /*  Momentum-strip data — all queries already exist elsewhere in the app;
      we're just subscribing to them here. No new server procedures.       */
  const { data: proposalsData } = trpc.proposals.list.useQuery();
  const { data: invoicesData } = trpc.estimatesInvoices.invoices.list.useQuery();
  const { data: agentPendingData } = trpc.actionApproval.listPending.useQuery(
    { source: "agent" },
    { refetchInterval: 30_000, staleTime: 25_000 },
  );
  const briefingMutation = trpc.copilot.dailyBriefing.useMutation();

  /*  Derived counts — memoised so a single data change doesn't recompute
      siblings. Matches the filters the list pages themselves apply so the
      count on the dashboard and the list rows never disagree.             */
  const pendingProposalsCount = useMemo(
    () =>
      (proposalsData?.items ?? []).filter(
        (p) => p.status === "sent" || p.status === "viewed",
      ).length,
    [proposalsData],
  );

  const overdueInvoicesCount = useMemo(() => {
    const list = invoicesData ?? [];
    const now = Date.now();
    return list.filter((i) => {
      if (i.status === "overdue") return true;
      // Belt-and-braces: a "sent" invoice past its due date is effectively
      // overdue even if the nightly status transition hasn't flipped it yet.
      if (i.status === "sent" && i.dueDate) {
        return new Date(i.dueDate).getTime() < now;
      }
      return false;
    }).length;
  }, [invoicesData]);

  const dormantClientsCount = useMemo(
    () =>
      (churnData?.signals ?? []).filter(
        (s) => s.totalOrders === 0 || s.daysSinceLastOrder >= 30,
      ).length,
    [churnData],
  );

  const agentInboxCount = agentPendingData?.length ?? 0;

  const attentionTotal =
    pendingProposalsCount + overdueInvoicesCount + agentInboxCount;

  const playBriefing = async () => {
    try {
      const result = await briefingMutation.mutateAsync();
      const summary = result.summary?.trim();
      if (!summary) {
        toast.error("Couldn't build a briefing — please try again in a moment.");
        return;
      }
      window.dispatchEvent(new CustomEvent("mergetasks:briefing", { detail: { summary } }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Briefing unavailable";
      toast.error(`Briefing failed — ${msg}`);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), DASHBOARD_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const id = setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % AI_PLACEHOLDER_QUERIES.length),
      PLACEHOLDER_ROTATE_MS,
    );
    return () => clearInterval(id);
  }, []);

  const greeting = `${greetingForHour(currentTime.getHours())}, ${firstName(user?.name ?? user?.email)}.`;
  const attentionSubtitle =
    attentionTotal === 0
      ? "You're all caught up — nothing urgent today."
      : `${attentionTotal} thing${attentionTotal === 1 ? "" : "s"} need${
          attentionTotal === 1 ? "s" : ""
        } your attention today.`;

  const placeholder = AI_PLACEHOLDER_QUERIES[placeholderIdx];

  return (
    <DashboardLayout hideHeader>
      <DashboardBanners />

      {/* ─── HERO ────────────────────────────────────────────────── */}
      <section className="relative pt-10 pb-10 sm:pt-14 sm:pb-14">
        <div className="absolute top-0 right-0 flex items-center gap-3 pt-2">
          <StripeStatusPill />
          <NotificationCenter />
        </div>

        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl font-medium text-mt-ink tracking-tight leading-tight">
            {greeting}
          </h1>
          {attentionTotal > 0 ? (
            <button
              onClick={() => navigate("/agent-inbox")}
              className="mt-3 text-[14px] sm:text-[15px] text-mt-ink-3 hover:text-primary transition-colors cursor-pointer underline-offset-2 hover:underline"
            >
              {attentionSubtitle}
            </button>
          ) : (
            <p className="mt-3 text-[14px] sm:text-[15px] text-mt-ink-3">
              {attentionSubtitle}
            </p>
          )}

          {/* AI search bar — bottom-border only, no heavy box. Reads as
             an input but triggers the Dashboard AI chat overlay on click. */}
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="group mt-10 w-full flex items-center gap-3 text-left bg-transparent px-1 py-3 border-b focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 transition-colors"
            style={{ borderBottomColor: "#E5E5E5", borderBottomWidth: "1.5px" }}
            aria-label="Ask MergeTasks AI"
          >
            <Sparkles
              size={18}
              className="text-mt-ink-3 group-hover:text-primary transition-colors"
            />
            <div className="flex-1 min-w-0 overflow-hidden h-6 relative">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={placeholderIdx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  className="absolute inset-0 flex items-center text-[15px] text-mt-ink-3 truncate"
                >
                  {placeholder}
                </motion.span>
              </AnimatePresence>
            </div>
            <kbd className="hidden sm:flex items-center gap-0.5 text-[11px] text-mt-ink-4 px-1.5 py-0.5 rounded border border-mt-border bg-transparent">
              <span className="text-[12px]">⌘</span>K
            </kbd>
          </button>
        </div>
      </section>

      {/* ─── UTILITY BELT ─────────────────────────────────────────────
         Collapsed to just Morning Briefing — the other entry points
         (Create Proposal, Build Webstore, View AI Insights) moved into
         the quick-actions bento below. Morning Briefing stays separate
         because it's an async action, not a navigate. */}
      <div className="flex items-center justify-center mb-14">
        <GhostButton
          onClick={playBriefing}
          icon={briefingMutation.isPending ? Loader2 : Sun}
          label={briefingMutation.isPending ? "Preparing briefing…" : "Morning Briefing"}
          disabled={briefingMutation.isPending}
          spinning={briefingMutation.isPending}
        />
      </div>

      {/* ─── QUICK-ACTIONS ───────────────────────────────────────────
         Horizontal card row: icon chip + title/subtitle pair. Single
         row on xl+, 2×2 below. These are the primary navigation CTAs
         out of the Dashboard; the Morning Briefing above is an async
         action and lives in the belt instead. */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 max-w-2xl mx-auto mb-10">
        {[
          { icon: FileText, label: "Create Proposal", desc: "Start a new proposal", path: "/create-proposal" },
          { icon: Store, label: "Build Webstore", desc: "Launch a branded store", path: "/create-webstore" },
          { icon: UserPlus, label: "Add Client", desc: "Capture a new company", path: "/clients?new=true" },
          { icon: Sparkles, label: "AI Insights", desc: "Reorder & churn signals", path: "/ai-insights" },
        ].map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              className="flex items-center gap-3 bg-white rounded-xl border border-[#EBEBEB] px-4 py-3 hover:border-primary/30 hover:shadow-[0_2px_8px_rgba(99,92,255,0.06)] transition-all group text-left active:scale-[0.98]"
            >
              <div className="w-8 h-8 rounded-lg bg-[#F0EEFF] flex items-center justify-center shrink-0 group-hover:bg-[#E5DCFF] transition-colors">
                <Icon size={15} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-mt-ink leading-tight">{action.label}</p>
                <p className="text-[11px] text-mt-ink-4 leading-tight mt-0.5 truncate">{action.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Live Stripe balance — collapsible, dismissible, persisted in localStorage */}
      <StripeBalanceWidget />

      {/* ─── MOMENTUM STRIP ──────────────────────────────────────── */}
      {/* Borderless horizontal stats. Vertical dividers do the separation
         work that borders used to do. The agent inbox entry carries the
         lone brand-purple live indicator — everything else is neutral. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-mt-border mb-16">
        <MomentumStat
          label="Proposals awaiting response"
          value={pendingProposalsCount}
          onClick={() => navigate("/proposals")}
        />
        <MomentumStat
          label="Invoices past due"
          value={overdueInvoicesCount}
          onClick={() => navigate("/documents/invoices")}
        />
        <MomentumStat
          label="Clients to follow up"
          value={dormantClientsCount}
          onClick={() => navigate("/clients")}
        />
        <MomentumStat
          label="Actions in your inbox"
          value={agentInboxCount}
          live
          onClick={() => navigate("/agent-inbox")}
        />
      </div>

      {/* ─── PO & MARGIN STRIP (borderless, divider-separated) ───── */}
      {summaryData?.purchaseOrders && summaryData.purchaseOrders.costOfGoods > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y divide-mt-border sm:divide-y-0 sm:divide-x sm:divide-mt-border mb-16">
          <div className="px-0 sm:px-5 py-3 sm:py-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-2">
              Cost of Goods
            </p>
            <p className="text-[26px] font-semibold text-mt-ink leading-none tabular-nums">
              ${summaryData.purchaseOrders.costOfGoods >= 1000
                ? `${(summaryData.purchaseOrders.costOfGoods / 1000).toFixed(1)}K`
                : summaryData.purchaseOrders.costOfGoods.toFixed(0)}
            </p>
            <p className="text-[12px] text-mt-ink-3 mt-2">From purchase orders</p>
          </div>
          <div className="px-0 sm:px-5 py-3 sm:py-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-2">
              Gross Margin
            </p>
            <p
              className="text-[26px] font-semibold leading-none tabular-nums"
              style={{ color: summaryData.purchaseOrders.grossMarginPercent >= 30 ? "#16A34A" : summaryData.purchaseOrders.grossMarginPercent >= 20 ? "#F59E0B" : "#EF4444" }}
            >
              {summaryData.purchaseOrders.grossMarginPercent}%
            </p>
            <p
              className="text-[12px] mt-2"
              style={{ color: summaryData.purchaseOrders.grossMarginPercent >= 30 ? "#16A34A" : summaryData.purchaseOrders.grossMarginPercent >= 20 ? "#F59E0B" : "#EF4444" }}
            >
              ${summaryData.purchaseOrders.grossMargin >= 1000
                ? `${(summaryData.purchaseOrders.grossMargin / 1000).toFixed(1)}K`
                : summaryData.purchaseOrders.grossMargin.toFixed(0)} profit
            </p>
          </div>
          <div className="px-0 sm:px-5 py-3 sm:py-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4 mb-2">
              Pending POs
            </p>
            <p className="text-[26px] font-semibold text-mt-ink leading-none tabular-nums">
              {summaryData.purchaseOrders.pending}
            </p>
            <p
              className="text-[12px] mt-2"
              style={{ color: summaryData.purchaseOrders.overdue > 0 ? "#EF4444" : "#16A34A" }}
            >
              {summaryData.purchaseOrders.overdue > 0 ? `${summaryData.purchaseOrders.overdue} overdue` : "On track"}
            </p>
          </div>
        </div>
      )}

      {/* ─── NEEDS YOUR ATTENTION ────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-semibold text-mt-ink">Needs Your Attention</h2>
          <button
            className="text-[12px] font-semibold text-mt-ink-2 hover:text-mt-ink flex items-center gap-1 transition-colors"
            onClick={() => navigate("/ai-insights")}
          >
            View All <ChevronRight size={12} />
          </button>
        </div>
        <div className="divide-y divide-mt-border">
          {/* Overdue/Urgent Reorders */}
          {reorderData?.predictions
            .filter((p) => p.urgency === "overdue" || p.urgency === "urgent")
            .slice(0, 2)
            .map((pred, i) => (
              <div key={`reorder-${i}`} className="flex items-center gap-3 py-3.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: pred.urgency === "overdue" ? "#FEF2F2" : "#FFFBEB" }}
                >
                  <AlertTriangle
                    size={14}
                    style={{ color: pred.urgency === "overdue" ? "#DC2626" : "#F59E0B" }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-mt-ink">
                    {pred.clientName} — {pred.productName} reorder {pred.urgency === "overdue" ? "overdue" : "due soon"}
                  </p>
                  <p className="text-[12px] text-mt-ink-3 mt-0.5">
                    {pred.urgency === "overdue"
                      ? `${Math.abs(pred.daysUntilReorder)} days overdue`
                      : `Due in ${pred.daysUntilReorder} days`}
                    {" · "}Avg {pred.avgQuantityPerOrder} units every {pred.avgIntervalDays} days
                  </p>
                </div>
                <button
                  className="text-[12px] font-semibold text-mt-ink-2 hover:text-mt-ink shrink-0 flex items-center gap-1 transition-colors"
                  onClick={() => navigate("/create-proposal")}
                >
                  Reorder <ChevronRight size={12} />
                </button>
              </div>
            ))}
          {/* High-Risk Churn Clients */}
          {churnData?.signals
            .filter((s) => s.riskLevel === "high")
            .slice(0, 2)
            .map((signal, i) => (
              <div key={`churn-${i}`} className="flex items-center gap-3 py-3.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#FEF2F2" }}
                >
                  <Package size={14} style={{ color: "#DC2626" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-mt-ink">
                    {signal.clientName} — Churn risk detected
                  </p>
                  <p className="text-[12px] text-mt-ink-3 mt-0.5">
                    {signal.daysSinceLastOrder} days since last order · {signal.signals[0]}
                  </p>
                </div>
                <button
                  className="text-[12px] font-semibold text-mt-ink-2 hover:text-mt-ink shrink-0 flex items-center gap-1 transition-colors"
                  onClick={() => navigate("/ai-insights")}
                >
                  View Details <ChevronRight size={12} />
                </button>
              </div>
            ))}
          {/* Pending Proposals */}
          {(stats?.pendingOrders ?? 0) > 0 && (
            <div className="flex items-center gap-3 py-3.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: "#F3F4F6" }}
              >
                <FileText size={14} className="text-mt-ink-3" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-mt-ink">
                  {stats?.pendingOrders} pending orders need attention
                </p>
                <p className="text-[12px] text-mt-ink-3 mt-0.5">{stats?.totalOrders} total orders tracked</p>
              </div>
              <button
                className="text-[12px] font-semibold text-mt-ink-2 hover:text-mt-ink shrink-0 flex items-center gap-1 transition-colors"
                onClick={() => navigate("/proposals")}
              >
                View <ChevronRight size={12} />
              </button>
            </div>
          )}
          {/* Fallback if no alerts */}
          {!reorderData?.predictions.filter((p) => p.urgency === "overdue" || p.urgency === "urgent").length &&
            !churnData?.signals.filter((s) => s.riskLevel === "high").length &&
            !(stats?.pendingOrders) && (
              <div className="py-6 text-center">
                <p className="text-[13px] text-mt-ink-3">All clear — no urgent items right now.</p>
              </div>
            )}
        </div>
      </section>

      {/* AI Chat Overlay */}
      <DashboardAIChat open={chatOpen} onOpenChange={setChatOpen} />
    </DashboardLayout>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

interface MomentumStatProps {
  label: string;
  value: number;
  onClick: () => void;
  /** Show the brand-purple pulsing dot. Reserved for the agent inbox
   *  entry — the one stat representing a live AI stream.               */
  live?: boolean;
}

function MomentumStat({ label, value, onClick, live }: MomentumStatProps) {
  const showLive = live && value > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left px-5 py-4 first:pl-0 last:pr-0 hover:bg-mt-surface-2/40 transition-colors"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-mt-ink-4">
          {label}
        </span>
        {showLive && (
          <span className="relative flex h-1.5 w-1.5" aria-label="Live">
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
              style={{ backgroundColor: "#654BF9" }}
            />
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "#654BF9" }}
            />
          </span>
        )}
      </div>
      <p className="text-[32px] font-semibold text-mt-ink leading-none tabular-nums">
        <AnimatedNumber value={value} />
      </p>
      <div className="flex items-center gap-1 mt-3 text-[11px] font-medium text-mt-ink-4 group-hover:text-mt-ink-2 transition-colors">
        <span>View</span>
        <ChevronRight size={11} />
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */

interface GhostButtonProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
}

function GhostButton({ icon: Icon, label, onClick, disabled, spinning }: GhostButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-mt-border bg-transparent text-[13px] font-medium text-mt-ink-2 hover:bg-mt-surface-2 hover:border-mt-ink-4 hover:text-mt-ink disabled:opacity-60 disabled:cursor-not-allowed transition-colors min-w-0"
    >
      <Icon size={14} className={spinning ? "animate-spin" : undefined} />
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * AnimatedNumber — springs between previous and current value on change.
 *
 * First mount renders the initial value statically (no animation), so
 * the dashboard doesn't count up from 0 on every page load. Subsequent
 * value changes (e.g., a new pending action arrives via 30s polling)
 * animate via framer-motion's useSpring.
 */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState<number>(value);
  const spring = useSpring(value, { stiffness: 80, damping: 20, restDelta: 0.5 });
  const firstRenderRef = useRef(true);

  useEffect(() => {
    return spring.on("change", (v) => setDisplay(Math.round(v)));
  }, [spring]);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      setDisplay(value);
      spring.jump(value);
      return;
    }
    spring.set(value);
  }, [value, spring]);

  return <>{display}</>;
}
