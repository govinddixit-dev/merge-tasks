import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { RouterOutput } from "@/lib/trpc";

type OrgListItem = RouterOutput["organizations"]["list"][number];

import DashboardLayout from "@/components/DashboardLayout";
import { TabContent } from "@/components/motion";
import { motion } from "framer-motion";
import {
  Shield, Users, Key, Globe, Bell, CreditCard, Copy, Eye, EyeOff,
  Link2, CheckCircle2, Zap,
  Mail, Palette, Loader2, Lock,
  BrainCircuit, Play
} from "lucide-react";
import { toast } from "sonner";
import TeamSettings from "@/components/settings/TeamSettings";
import SupplierIntegrationsPanel from "@/components/settings/SupplierIntegrationsPanel";
import EmailTab from "@/components/settings/EmailTab";
import BillingTab from "@/components/settings/BillingTab";
import BrandingTab from "@/components/settings/BrandingTab";
import QuickBooksPanel from "@/components/settings/QuickBooksPanel";
import StripePaymentsPanel from "@/components/settings/StripePaymentsPanel";

const tabs = [
  { id: "iam", label: "IAM & SSO", icon: Shield },
  { id: "team", label: "Team", icon: Users },
  { id: "email", label: "Email", icon: Mail },
  { id: "integrations", label: "Integrations", icon: Link2 },
  { id: "api", label: "API Keys", icon: Key },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "billing", label: "Billing", icon: CreditCard },
];

/* Static team members removed — Team tab uses TeamSettingsLoader with real DB data */

function MsftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function OktaLogo() {
  return (
    <img
      src="https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/pasted_file_NF4K7T_image_5375dd89.png"
      alt="Okta" width={18} height={18} style={{ objectFit: 'contain' }}
    />
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
      <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
      <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
      <path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
    </svg>
  );
}

function OneLoginLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="#1A1A1A" strokeWidth="2" fill="none" />
      <circle cx="12" cy="12" r="4" fill="#1A1A1A" />
    </svg>
  );
}

const ssoProviders = [
  { name: "Microsoft Entra ID", connected: false, users: 0, logo: MsftLogo },
  { name: "Okta", connected: false, users: 0, logo: OktaLogo },
  { name: "Google Workspace", connected: false, users: 0, logo: GoogleLogo },
  { name: "OneLogin", connected: false, users: 0, logo: OneLoginLogo },
];

/* ─── Integration Types ─────────────────────────────────────────────────────
 * Legacy fake integration data has been REMOVED (Mock-to-Real Guide, Step 2).
 * The Integrations tab now renders:
 *   - SupplierIntegrationsPanel (real ASI + PromoStandards connections:
 *     SanMar, S&S Activewear, alphabroder)
 *   - QuickBooksPanel (real QuickBooks Online connection)
 *   - StripePaymentsPanel (real Stripe Connect onboarding)
 * The SSO (IAM tab) and Custom Domains tabs are flagged as "Planned" —
 * sections stay visible so users can see what's on the roadmap.
 * ──────────────────────────────────────────────────────────────────────────── */





/*  Notification Preferences  */
const notifCategories = [
  { section: "Orders & Revenue", items: [
    { label: "New webstore orders", desc: "Get notified when a client places an order", enabled: true },
    { label: "Large orders (>$1,000)", desc: "Immediate alert for high-value orders", enabled: true },
    { label: "Failed payments", desc: "When a payment attempt fails or is declined", enabled: true },
  ]},
  { section: "Inventory & Products", items: [
    { label: "Low stock alerts", desc: "When a product drops below reorder threshold", enabled: true },
    { label: "Out of stock", desc: "When a product hits zero inventory", enabled: true },
    { label: "AI reorder suggestions", desc: "Predictive stockout and reorder recommendations", enabled: true },
  ]},
  { section: "Proposals & Approvals", items: [
    { label: "Proposal approvals", desc: "When a department approves or rejects", enabled: true },
    { label: "Proposal expiring", desc: "Proposals approaching their validity deadline", enabled: false },
  ]},
  { section: "Stores & Pop-Ups", items: [
    { label: "Pop-up expiring soon", desc: "7-day and 1-day warnings before pop-up shops end", enabled: true },
    { label: "Pop-up expired", desc: "When a pop-up shop campaign has ended", enabled: true },
    { label: "Store health alerts", desc: "Uptime issues or configuration problems", enabled: false },
  ]},
  { section: "System & Team", items: [
    { label: "SCIM sync events", desc: "Employee additions and removals from directory", enabled: false },
    { label: "API integration alerts", desc: "When supplier APIs have connectivity issues", enabled: true },
    { label: "Weekly digest", desc: "Summary of all platform activity", enabled: true },
  ]},
];

/** Loads the user's primary org then renders TeamSettings */
function TeamSettingsLoader() {
  const { data: orgs, isLoading } = trpc.organizations.list.useQuery();
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>;
  if (!orgs || orgs.length === 0) return <p className="text-sm text-gray-500">No organization found. Please contact support.</p>;
  const primaryOrg = orgs.find(o => o.role === "owner") || orgs[0];
  return <TeamSettings organizationId={primaryOrg.id} />;
}

const approvalLevels = [
  {
    value: "review_auto" as const,
    label: "Balanced (Recommended)",
    desc: "AI auto-executes safe reads and searches. Destructive or outbound actions require your approval.",
    icon: Shield,
    iconColor: "text-primary",
    borderColor: "border-primary/40",
    bgColor: "bg-[#F8F7FF]",
  },
  {
    value: "all_auto" as const,
    label: "Full Autonomy",
    desc: "AI executes all actions immediately with no confirmation prompts. Best for trusted, high-volume workflows.",
    icon: Zap,
    iconColor: "text-amber-500",
    borderColor: "border-amber-300",
    bgColor: "bg-amber-50",
  },
  {
    value: "all_review" as const,
    label: "Full Review",
    desc: "Every AI action requires manual approval before execution. Maximum control and oversight.",
    icon: Lock,
    iconColor: "text-mt-ink-3",
    borderColor: "border-mt-border",
    bgColor: "bg-mt-surface",
  },
];

function AIApprovalLevelSelector() {
  const utils = trpc.useUtils();
  const { data: orgs } = trpc.organizations.list.useQuery();
  const { data: me } = trpc.auth.me.useQuery();
  const primaryOrg = orgs?.find((o: OrgListItem) => o.role === "owner") || orgs?.[0];
  // Audit fix #21: invalidate the organizations.list cache after a successful
  // settings update so the UI reflects the new aiApprovalLevel immediately
  // instead of showing a stale value until the next page refresh.
  const orgUpdateMutation = trpc.organizations.updateSettings.useMutation({
    onSuccess: () => {
      utils.organizations.list.invalidate();
    },
  });
  // Solo path (no org). Writes to users.aiApprovalLevel and invalidates
  // auth.me so the selector re-reads the new value immediately.
  const userUpdateMutation = trpc.auth.updateAiApprovalLevel.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
    },
  });
  const isPending = orgUpdateMutation.isPending || userUpdateMutation.isPending;
  // Org-level setting always wins when the user belongs to one; solo users
  // read their own column off the auth.me payload.
  const currentLevel = primaryOrg
    ? primaryOrg.aiApprovalLevel ?? "review_auto"
    : (me as { aiApprovalLevel?: "all_auto" | "review_auto" | "all_review" } | null | undefined)?.aiApprovalLevel ?? "review_auto";

  const handleSelect = async (value: string) => {
    if (value === currentLevel) return;
    const level = value as "all_auto" | "review_auto" | "all_review";
    try {
      if (primaryOrg) {
        await orgUpdateMutation.mutateAsync({ organizationId: primaryOrg.id, aiApprovalLevel: level });
      } else {
        await userUpdateMutation.mutateAsync({ aiApprovalLevel: level });
      }
      toast.success("AI approval level updated");
    } catch (err: unknown) {
      toast.error(`Failed to update${err instanceof Error ? ` — ${err.message}` : ""}`);
    }
  };

  return (
    <div className="space-y-2">
      {approvalLevels.map((level) => {
        const isSelected = currentLevel === level.value;
        const Icon = level.icon;
        return (
          <button
            key={level.value}
            onClick={() => handleSelect(level.value)}
            disabled={isPending}
            className={`w-full text-left flex items-start gap-3.5 p-4 rounded-lg border-2 transition-all duration-150 ${
              isSelected
                ? `${level.borderColor} ${level.bgColor}`
                : "border-transparent bg-mt-surface hover:bg-mt-surface-2"
            } disabled:opacity-50`}
          >
            <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              isSelected ? level.bgColor : "bg-white"
            }`}>
              <Icon size={16} className={isSelected ? level.iconColor : "text-mt-ink-4"} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={`text-[13px] font-semibold ${isSelected ? "text-mt-ink" : "text-mt-ink-3"}`}>
                  {level.label}
                </p>
                {isSelected && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-mt-brand-light px-2 py-0.5 rounded">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[12px] text-mt-ink-3 mt-0.5 leading-relaxed">{level.desc}</p>
            </div>
            <div className={`mt-1 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
              isSelected ? "border-primary" : "border-mt-border"
            }`}>
              {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * AiAgentPanel — manual scan control for the proactive agent.
 *
 * Rendered in the Notifications tab alongside other automation settings.
 * The same button also lives on the Agent Inbox empty state, but surfacing
 * it in Settings gives operators a stable home even when the inbox isn't
 * empty.
 */
function AiAgentPanel() {
  const utils = trpc.useUtils();
  const { data: agentStatus } = trpc.actionApproval.agentStatus.useQuery(undefined, {
    staleTime: 25_000,
  });
  const triggerScanMutation = trpc.agent.triggerScan.useMutation({
    onSuccess: () => {
      toast.success("Agent scan triggered", {
        description: "New actions will appear in the Agent Inbox.",
      });
      void utils.actionApproval.listPending.invalidate();
      void utils.actionApproval.agentStatus.invalidate();
    },
    onError: (err) => {
      toast.error(`Scan failed — ${err.message}`);
    },
  });

  const lastScan = agentStatus?.lastAgentActivityAt
    ? new Date(agentStatus.lastAgentActivityAt).toLocaleString()
    : "Never — runs daily automatically";

  return (
    <div className="bg-white rounded-lg border border-mt-border p-7 mb-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
          <BrainCircuit size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-mt-ink mb-1">Proactive AI Agent</h3>
          <p className="text-[12px] text-mt-ink-3 mb-3 leading-relaxed">
            The agent scans your business every 24 hours and drafts actions for
            your morning review. Use the button below to run a scan on demand —
            useful after onboarding clients or importing new data.
          </p>
          <p className="text-[11.5px] text-mt-ink-4">
            Last scan: <span className="text-mt-ink-2">{lastScan}</span>
          </p>
        </div>
        <button
          onClick={() => triggerScanMutation.mutate()}
          disabled={triggerScanMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 shadow-sm transition-colors shrink-0"
        >
          <Play size={13} />
          {triggerScanMutation.isPending ? "Scanning…" : "Run Agent Scan Now"}
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState("iam");
  /*  Deep-link support: /settings?tab=billing preselects the tab on
      first render. Used by the header Stripe pill when Stripe isn't
      connected yet. Runs once on mount and silently ignores unknown
      tab ids so URL typos fall back to the default tab.                 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");
    if (requested && tabs.some((t) => t.id === requested)) {
      setActiveTab(requested);
    }
  }, []);
  const [showApiKey, setShowApiKey] = useState(false);
  // expandedIntegration / syncingId state removed — legacy integration cards deleted
  const [notifToggles, setNotifToggles] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    notifCategories.forEach(cat => cat.items.forEach(item => { map[item.label] = item.enabled; }));
    return map;
  });
  const [notifChannels, setNotifChannels] = useState({ email: true, inApp: true, slack: false, sms: false });

  // NOTE: handleSync mock and fake aggregate stats REMOVED (Mock-to-Real Guide, Step 2).
  // The Integrations tab now uses SupplierIntegrationsPanel + QuickBooksPanel
  // which have their own real tRPC-backed sync/status logic.

  return (
    <DashboardLayout title="Settings" subtitle="Platform configuration and access management">
      <div className="flex flex-col sm:flex-row gap-6">
        {/* Left Tab Nav */}
        <div className="w-full sm:w-[200px] flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0 flex-shrink-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium text-left rounded-lg transition-all duration-150 whitespace-nowrap relative ${
                  isActive ? "text-primary" : "text-mt-ink-3 hover:bg-mt-surface"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {isActive && (
                  <motion.div
                    layoutId="settingsTabs"
                    className="absolute inset-0 bg-mt-brand-light rounded-lg"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <Icon size={15} strokeWidth={1.5} className={`relative z-10 ${isActive ? "text-primary" : "text-mt-ink-4"}`} />
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
        <TabContent tabKey={activeTab}>
          {/*  IAM & SSO  */}
          {activeTab === "iam" && (
            <div>
              <div className="bg-white rounded-lg border border-mt-border p-7 mb-4 opacity-60">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-[15px] font-semibold text-mt-ink">Single Sign-On (SSO)</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Planned</span>
                </div>
                <p className="text-[13px] text-mt-ink-3 mb-5">Identity-provider integrations for automatic employee provisioning — not yet available.</p>
                <div className="space-y-2">
                  {ssoProviders.map((provider, i) => (
                    <div key={i} className="flex items-center justify-between py-3.5 px-4 rounded-lg border border-mt-border">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-mt-surface-2">
                          {provider.logo ? <provider.logo /> : <Shield size={14} className="text-mt-ink-4" />}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-mt-ink">{provider.name}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Planned</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-lg border border-mt-border p-7">
                <h3 className="text-[15px] font-semibold text-mt-ink mb-1">SCIM Auto-Provisioning</h3>
                <p className="text-[13px] text-mt-ink-3 mb-5">Automatically sync employee directories. When HR fires someone, access is revoked instantly.</p>
                <div className="flex flex-col items-center justify-center py-10">
                  <div className="w-12 h-12 rounded-full bg-mt-surface-2 flex items-center justify-center mb-3">
                    <Users size={20} className="text-mt-ink-4" />
                  </div>
                  <p className="text-[13px] font-semibold text-mt-ink mb-1">No SCIM connections configured</p>
                  <p className="text-[12px] text-mt-ink-3">Connect an SSO provider above to enable automatic employee sync</p>
                </div>
              </div>

              {/* AI Approval Level */}
              <div className="bg-white rounded-lg border border-mt-border p-7 mt-4">
                <h3 className="text-[15px] font-semibold text-mt-ink mb-1">AI Action Approval Level</h3>
                <p className="text-[13px] text-mt-ink-3 mb-5">Control how the AI copilot handles sensitive actions like sending proposals, deleting records, or sending emails.</p>
                <AIApprovalLevelSelector />
              </div>
            </div>
          )}

          {/*  Team  */}
          {activeTab === "team" && (
            <div className="bg-white rounded-lg border border-mt-border p-7">
              <TeamSettingsLoader />
            </div>
          )}

          {/*  Integrations  */}
          {activeTab === "integrations" && (
            <div className="space-y-4">
              <SupplierIntegrationsPanel />
              <QuickBooksPanel />
              <StripePaymentsPanel />
            </div>
          )}



          {/*  API Keys  */}
          {activeTab === "api" && (
            <div className="bg-white rounded-lg border border-mt-border p-7">
              <h3 className="text-[15px] font-semibold text-mt-ink mb-1">API Configuration</h3>
              <p className="text-[13px] text-mt-ink-3 mb-5">Manage API keys for integrations</p>
              <div className="space-y-4">
                <div className="p-5 bg-mt-surface rounded-lg border border-mt-border">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[12px] font-medium text-mt-ink-4">Production Key</span>
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded bg-[#F0FDF4] text-[#16A34A]">Active</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[12px] px-4 py-2.5 bg-white rounded-lg border border-mt-border text-mt-ink-2">
                      {showApiKey ? "mt_live_sk_7f3a9b2c4d5e6f8a1b2c3d4e5f6a7b8c" : "mt_live_sk_••••••••••••••••••••••••"}
                    </code>
                    <button className="p-2.5 rounded-lg border border-mt-border hover:bg-mt-surface transition-colors" onClick={() => setShowApiKey(!showApiKey)}>
                      {showApiKey ? <EyeOff size={14} className="text-mt-ink-4" /> : <Eye size={14} className="text-mt-ink-4" />}
                    </button>
                    <button className="p-2.5 rounded-lg border border-mt-border hover:bg-mt-surface transition-colors"
                      onClick={() => { navigator.clipboard.writeText("mt_live_sk_7f3a9b2c4d5e6f8a1b2c3d4e5f6a7b8c"); toast("API key copied"); }}>
                      <Copy size={14} className="text-mt-ink-4" />
                    </button>
                  </div>
                </div>
                <div className="p-5 bg-mt-surface rounded-lg border border-mt-border">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[12px] font-medium text-mt-ink-4">Webhook URL</span>
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded bg-[#F0FDF4] text-[#16A34A]">Verified</span>
                  </div>
                  <code className="block text-[12px] px-4 py-2.5 bg-white rounded-lg border border-mt-border text-mt-ink-2">
                    https://api.yourdomain.com/webhooks/mergetasks
                  </code>
                </div>
              </div>
            </div>
          )}

          {/*  Domains  */}
          {activeTab === "domains" && (
            <div className="bg-white rounded-lg border border-mt-border p-7 opacity-60">
              <div className="flex items-center gap-2 mb-5">
                <h3 className="text-[15px] font-semibold text-mt-ink">Custom Domains</h3>
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Planned</span>
              </div>
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-12 h-12 rounded-full bg-mt-surface-2 flex items-center justify-center mb-3">
                  <Globe size={20} className="text-mt-ink-4" />
                </div>
                <p className="text-[13px] font-semibold text-mt-ink mb-1">Custom domains not yet available</p>
                <p className="text-[12px] text-mt-ink-3">Branded client-facing domains are on the roadmap — no action required today.</p>
              </div>
            </div>
          )}

          {/*  Notifications  */}
          {activeTab === "notifications" && (
            <div>
              {/* Proactive AI Agent — manual scan control */}
              <AiAgentPanel />

              {/* Delivery Channels */}
              <div className="bg-white rounded-lg border border-mt-border p-7 mb-4">
                <h3 className="text-[15px] font-semibold text-mt-ink mb-1">Delivery Channels</h3>
                <p className="text-[12px] text-mt-ink-3 mb-5">Choose how you receive notifications</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { key: "email" as const, label: "Email", desc: "john@distributor.com" },
                    { key: "inApp" as const, label: "In-App", desc: "Bell icon notifications" },
                    { key: "slack" as const, label: "Slack", desc: "Connect workspace" },
                    { key: "sms" as const, label: "SMS", desc: "Critical alerts only" },
                  ].map((ch) => (
                    <div key={ch.key} className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      notifChannels[ch.key] ? "border-primary bg-mt-brand-light" : "border-mt-border bg-white"
                    }`} onClick={() => setNotifChannels(prev => ({ ...prev, [ch.key]: !prev[ch.key] }))}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[13px] font-semibold text-mt-ink">{ch.label}</span>
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                          notifChannels[ch.key] ? "bg-primary" : "border border-mt-border-2"
                        }`}>
                          {notifChannels[ch.key] && <CheckCircle2 size={10} className="text-white" />}
                        </div>
                      </div>
                      <p className="text-[11px] text-mt-ink-4">{ch.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notification Preferences by Category */}
              <div className="bg-white rounded-lg border border-mt-border p-7">
                <h3 className="text-[15px] font-semibold text-mt-ink mb-5">Notification Preferences</h3>
                <div className="space-y-6">
                  {notifCategories.map((cat) => (
                    <div key={cat.section}>
                      <h4 className="text-[11px] font-bold text-mt-ink-4 uppercase tracking-wider mb-3">{cat.section}</h4>
                      <div className="space-y-0">
                        {cat.items.map((item) => (
                          <div key={item.label} className="flex items-center justify-between py-3.5" style={{ borderBottom: "1px solid #F5F5F5" }}>
                            <div>
                              <p className="text-[13px] font-medium text-mt-ink">{item.label}</p>
                              <p className="text-[11px] mt-0.5 text-mt-ink-4">{item.desc}</p>
                            </div>
                            <div
                              className="w-10 h-5 flex items-center px-0.5 rounded-full cursor-pointer transition-colors duration-200"
                              style={{ backgroundColor: notifToggles[item.label] ? "var(--mt-brand)" : "#D4D4D4" }}
                              onClick={() => {
                                setNotifToggles(prev => ({ ...prev, [item.label]: !prev[item.label] }));
                                toast("Preference updated");
                              }}
                            >
                              <div className="w-4 h-4 rounded-full bg-white transition-transform duration-200" style={{
                                transform: notifToggles[item.label] ? "translateX(20px)" : "translateX(0)",
                              }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/*  Email  */}
          {activeTab === "email" && <EmailTab />}

          {/*  Branding  */}
          {activeTab === "branding" && <BrandingTab />}

          {/*  Billing  */}
          {activeTab === "billing" && <BillingTab />}
        </TabContent>

        {/* Settings-wide footer with the privacy link the spec requires */}
        <div className="mt-8 pt-6 border-t border-mt-border text-center text-[11px] text-mt-ink-4">
          <a href="/privacy" className="hover:text-mt-ink-2">Privacy Policy</a>
          <span className="mx-2" aria-hidden>·</span>
          <a href="/legal/terms" className="hover:text-mt-ink-2">Terms of Service</a>
          <span className="mx-2" aria-hidden>·</span>
          <a href="mailto:privacy@mergetasks.com" className="hover:text-mt-ink-2">privacy@mergetasks.com</a>
        </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
