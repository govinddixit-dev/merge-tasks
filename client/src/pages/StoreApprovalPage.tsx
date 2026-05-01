/**
 * StoreApprovalPage — token-gated client approval page.
 * Accessed via /store-approval/:token from the approval email link.
 * No login required — the token itself is the credential.
 *
 * Actions available to the client:
 *  - Approve Store (optional name + optional note)
 *  - Request Changes (required note explaining what needs to change)
 *  - Already-approved / revision-requested / expired states
 */
import { useState, useEffect } from "react";
import { useParams } from "wouter";
import {
  CheckCircle2, Clock, AlertTriangle, Loader2,
  Store, Sparkles, MessageSquare, ChevronRight,
  ShieldCheck, PenLine, X,
} from "lucide-react";

const MT_LOGO = "/logo_clean.png";

interface ApprovalData {
  store: {
    id: number;
    name: string;
    status: string;
    template: string;
    primaryColor: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
    aiHeroHeadline: string | null;
    aiHeroSubtitle: string | null;
    aiTagline: string | null;
    welcomeMessage: string | null;
    approvalClientName: string | null;
    approvalApprovedAt: string | null;
    approvalNotes: string | null;
    approvalExpiresAt: string | null;
  };
  branding: {
    companyName: string;
    primaryColor: string;
    logoUrl: string | null;
  };
  client: {
    companyName: string;
    contactName: string | null;
  };
}

type ActionMode = "idle" | "approve" | "request_changes";
type SubmitResult = "approved" | "changes_requested" | null;

export default function StoreApprovalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = useState<ApprovalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const [approverName, setApproverName] = useState("");
  const [notes, setNotes] = useState("");
  const [notesError, setNotesError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult>(null);
  const [alreadyApproved, setAlreadyApproved] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>("idle");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/store-approval/${token}`);
        if (res.status === 410) { setExpired(true); setLoading(false); return; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Approval link not found");
        }
        const result: ApprovalData = await res.json();
        setData(result);
        if (result.store.approvalApprovedAt) {
          setAlreadyApproved(true);
          setSubmitResult("approved");
        } else if (result.store.status === "revision_requested") {
          setSubmitResult("changes_requested");
        }
        if (result.store.approvalClientName) {
          setApproverName(result.store.approvalClientName);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load approval page");
      } finally {
        setLoading(false);
      }
    }
    if (token) load();
  }, [token]);

  async function handleApprove() {
    if (!data) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/store-approval/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverName: approverName.trim() || undefined, notes: notes.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to submit approval");
      }
      const result = await res.json();
      setAlreadyApproved(result.alreadyApproved);
      setSubmitResult("approved");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit approval");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestChanges() {
    if (!data) return;
    if (!notes.trim()) {
      setNotesError("Please describe the changes you'd like made.");
      return;
    }
    setNotesError(null);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/store-approval/${token}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverName: approverName.trim() || undefined, notes: notes.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to submit revision request");
      }
      setSubmitResult("changes_requested");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit revision request");
    } finally {
      setSubmitting(false);
    }
  }

  //  Loading 
  if (loading) {
    return (
      <div className="min-h-screen bg-mt-surface-2 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-primary" />
          <p className="text-[14px] text-[#6B7280]">Loading your store preview…</p>
        </div>
      </div>
    );
  }

  //  Expired 
  if (expired) {
    return (
      <div className="min-h-screen bg-mt-surface-2 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-[#FEF2F2] flex items-center justify-center mx-auto mb-4">
            <Clock size={28} className="text-[#EF4444]" />
          </div>
          <h1 className="text-[22px] font-bold text-[#111827] mb-2">This link has expired</h1>
          <p className="text-[14px] text-[#6B7280]">
            This approval link is no longer valid. Please contact your distributor to request a new one.
          </p>
        </div>
      </div>
    );
  }

  //  Error 
  if (error && !data) {
    return (
      <div className="min-h-screen bg-mt-surface-2 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-[#FEF2F2] flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} className="text-[#EF4444]" />
          </div>
          <h1 className="text-[22px] font-bold text-[#111827] mb-2">Link not found</h1>
          <p className="text-[14px] text-[#6B7280]">{error || "This approval link is invalid or has already been used."}</p>
        </div>
      </div>
    );
  }

  const { store, branding, client } = data!;
  const primary = branding.primaryColor || "var(--mt-brand)";
  const heroHeadline = store.aiHeroHeadline || `Welcome to ${store.name}`;
  const heroSubtitle = store.aiHeroSubtitle || store.welcomeMessage || `Your branded store is ready.`;
  const tagline = store.aiTagline || "";

  //  Approved Success 
  if (submitResult === "approved") {
    return (
      <div className="min-h-screen bg-mt-surface-2">
        <header className="bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.companyName} className="h-8 object-contain" />
          ) : (
            <span className="font-bold text-[18px]" style={{ color: primary }}>{branding.companyName}</span>
          )}
          <div className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
            <span>Powered by</span>
            <img src={MT_LOGO} alt="MergeTasks" className="h-4 opacity-60" />
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[calc(100vh-65px)] p-6">
          <div className="bg-white rounded-2xl shadow-lg p-10 max-w-lg w-full text-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{ background: `${primary}15` }}>
              <CheckCircle2 size={36} style={{ color: primary }} />
            </div>
            <div className="inline-block px-3 py-1 rounded-full text-[11px] font-bold mb-4"
              style={{ background: `${primary}15`, color: primary }}>
              {alreadyApproved ? "ALREADY APPROVED" : "APPROVED"}
            </div>
            <h1 className="text-[26px] font-extrabold text-[#111827] mb-3">
              {alreadyApproved ? "You've already approved this store" : "Thank you for your approval!"}
            </h1>
            <p className="text-[15px] text-[#6B7280] leading-relaxed mb-2">
              {alreadyApproved
                ? `The "${store.name}" store was previously approved.`
                : `The "${store.name}" store has been approved. ${branding.companyName} has been notified and will launch it shortly.`}
            </p>
            {notes && !alreadyApproved && (
              <div className="mt-4 bg-[#F9FAFB] rounded-xl p-4 text-left border border-[#E5E7EB]">
                <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wide mb-1">Your note</p>
                <p className="text-[14px] text-[#374151]">{notes}</p>
              </div>
            )}
            <div className="mt-8 pt-6 border-t border-[#F3F4F6]">
              <p className="text-[12px] text-[#9CA3AF]">
                Questions? Contact {branding.companyName} directly.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  //  Changes Requested Success 
  if (submitResult === "changes_requested") {
    return (
      <div className="min-h-screen bg-mt-surface-2">
        <header className="bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.companyName} className="h-8 object-contain" />
          ) : (
            <span className="font-bold text-[18px]" style={{ color: primary }}>{branding.companyName}</span>
          )}
          <div className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
            <span>Powered by</span>
            <img src={MT_LOGO} alt="MergeTasks" className="h-4 opacity-60" />
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[calc(100vh-65px)] p-6">
          <div className="bg-white rounded-2xl shadow-lg p-10 max-w-lg w-full text-center">
            <div className="w-20 h-20 rounded-full bg-[#FFF7ED] flex items-center justify-center mx-auto mb-5">
              <PenLine size={36} className="text-[#F97316]" />
            </div>
            <div className="inline-block px-3 py-1 rounded-full text-[11px] font-bold bg-[#FFF7ED] text-[#9A3412] mb-4">
              CHANGES REQUESTED
            </div>
            <h1 className="text-[26px] font-extrabold text-[#111827] mb-3">
              Your feedback has been sent
            </h1>
            <p className="text-[15px] text-[#6B7280] leading-relaxed mb-2">
              {branding.companyName} has been notified of your requested changes to the <strong>{store.name}</strong> store. They'll update the design and send you a new review link.
            </p>
            {notes && (
              <div className="mt-4 bg-[#FFF7ED] rounded-xl p-4 text-left border border-[#FED7AA]">
                <p className="text-[11px] font-bold text-[#9A3412] uppercase tracking-wide mb-1">Your requested changes</p>
                <p className="text-[14px] text-[#374151]">{notes}</p>
              </div>
            )}
            <div className="mt-8 pt-6 border-t border-[#F3F4F6]">
              <p className="text-[12px] text-[#9CA3AF]">
                Questions? Contact {branding.companyName} directly.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  //  Main Approval Page 
  return (
    <div className="min-h-screen bg-mt-surface-2">
      {/* Branded header */}
      <header className="bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt={branding.companyName} className="h-8 object-contain" />
        ) : (
          <span className="font-bold text-[18px]" style={{ color: primary }}>{branding.companyName}</span>
        )}
        <div className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
          <span>Powered by</span>
          <img src={MT_LOGO} alt="MergeTasks" className="h-4 opacity-60" />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">

        {/* Intro card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-7">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${primary}15` }}>
              <Store size={22} style={{ color: primary }} />
            </div>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-widest mb-1" style={{ color: primary }}>
                Store Review Request
              </p>
              <h1 className="text-[22px] font-extrabold text-[#111827] leading-tight mb-2">
                {branding.companyName} has built your branded store
              </h1>
              <p className="text-[14px] text-[#6B7280] leading-relaxed">
                Hi{store.approvalClientName ? ` ${store.approvalClientName}` : ""},
                please review the store design below. When you're happy with it, click <strong>Approve Store</strong>. If you'd like changes, click <strong>Request Changes</strong> and describe what you need.
              </p>
            </div>
          </div>
        </div>

        {/* Store preview card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] overflow-hidden">
          {/* Hero banner */}
          <div
            className="relative h-48 flex flex-col items-center justify-center text-center px-8"
            style={{
              background: store.bannerUrl
                ? `url(${store.bannerUrl}) center/cover no-repeat`
                : `linear-gradient(135deg, ${primary} 0%, ${primary}99 100%)`,
            }}
          >
            {store.bannerUrl && (
              <div className="absolute inset-0" style={{ background: `${primary}55` }} />
            )}
            <div className="relative z-10">
              {store.logoUrl && (
                <img src={store.logoUrl} alt={store.name} className="h-10 object-contain mx-auto mb-3 drop-shadow-sm" />
              )}
              <h2 className="text-[22px] font-extrabold text-white drop-shadow-sm leading-tight mb-1">
                {heroHeadline}
              </h2>
              {heroSubtitle && (
                <p className="text-[13px] text-white/85 max-w-sm">{heroSubtitle}</p>
              )}
            </div>
          </div>

          {/* Store details */}
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[18px] font-bold text-[#111827]">{store.name}</p>
                <p className="text-[13px] text-[#6B7280]">{client.companyName}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold px-3 py-1 rounded-full capitalize"
                  style={{ background: `${primary}15`, color: primary }}>
                  {store.template} template
                </span>
                <div className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                  style={{ background: primary }} title="Brand color" />
              </div>
            </div>

            {tagline && (
              <div className="flex items-start gap-2 bg-[#F9FAFB] rounded-xl p-3 border border-[#E5E7EB]">
                <Sparkles size={14} className="mt-0.5 flex-shrink-0" style={{ color: primary }} />
                <p className="text-[13px] text-[#374151] italic">"{tagline}"</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Template", value: store.template },
                { label: "Brand Color", value: store.primaryColor || "var(--mt-brand)" },
                { label: "Status", value: "Ready for Review" },
              ].map(item => (
                <div key={item.label} className="bg-[#F9FAFB] rounded-xl p-3 border border-[#E5E7EB]">
                  <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wide mb-1">{item.label}</p>
                  {item.label === "Brand Color" ? (
                    <div className="flex items-center justify-center gap-1.5">
                      <div className="w-4 h-4 rounded-full" style={{ background: item.value }} />
                      <span className="text-[12px] font-semibold text-[#374151]">{item.value}</span>
                    </div>
                  ) : (
                    <p className="text-[13px] font-semibold text-[#374151] capitalize">{item.value}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Action form */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-7 space-y-5">

          {/* Mode selector — idle state shows two action buttons */}
          {actionMode === "idle" && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={18} style={{ color: primary }} />
                <h3 className="text-[16px] font-bold text-[#111827]">What would you like to do?</h3>
              </div>
              <p className="text-[13px] text-[#6B7280]">
                Review the store design above and choose an action below.
              </p>

              {/* Your name — shared across both actions */}
              <div>
                <label className="block text-[12px] font-semibold text-[#374151] mb-1.5">
                  Your name <span className="text-[#9CA3AF] font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={approverName}
                  onChange={e => setApproverName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] text-[14px] text-[#111827] placeholder:text-[#D1D5DB] focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                {/* Approve */}
                <button
                  onClick={() => setActionMode("approve")}
                  className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 transition-all hover:shadow-md active:scale-[0.98]"
                  style={{ borderColor: primary, background: `${primary}08` }}
                >
                  <CheckCircle2 size={28} style={{ color: primary }} />
                  <span className="text-[14px] font-bold" style={{ color: primary }}>Approve Store</span>
                  <span className="text-[11px] text-[#9CA3AF] text-center">The design looks great — go ahead and launch</span>
                </button>
                {/* Request Changes */}
                <button
                  onClick={() => setActionMode("request_changes")}
                  className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-[#E5E7EB] transition-all hover:shadow-md hover:border-[#F97316] active:scale-[0.98] bg-white"
                >
                  <PenLine size={28} className="text-[#F97316]" />
                  <span className="text-[14px] font-bold text-[#374151]">Request Changes</span>
                  <span className="text-[11px] text-[#9CA3AF] text-center">I'd like some adjustments before approving</span>
                </button>
              </div>
            </>
          )}

          {/* Approve mode */}
          {actionMode === "approve" && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} style={{ color: primary }} />
                  <h3 className="text-[16px] font-bold text-[#111827]">Approve this store</h3>
                </div>
                <button onClick={() => { setActionMode("idle"); setError(null); }}
                  className="text-[#9CA3AF] hover:text-[#374151] transition-colors">
                  <X size={18} />
                </button>
              </div>
              <p className="text-[13px] text-[#6B7280]">
                By approving, you confirm the store design looks correct and {branding.companyName} can proceed to launch it.
              </p>

              <div>
                <label className="block text-[12px] font-semibold text-[#374151] mb-1.5 flex items-center gap-1.5">
                  <MessageSquare size={12} />
                  Leave a note <span className="text-[#9CA3AF] font-normal">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any feedback or comments for the distributor…"
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] text-[14px] text-[#111827] placeholder:text-[#D1D5DB] focus:outline-none focus:border-primary transition-colors resize-none"
                />
              </div>

              {error && (
                <p className="text-[13px] text-[#EF4444] bg-[#FEF2F2] rounded-xl px-4 py-3">{error}</p>
              )}

              <button
                onClick={handleApprove}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-white font-bold text-[15px] transition-all active:scale-[0.98] disabled:opacity-60 shadow-sm"
                style={{ background: `linear-gradient(135deg, ${primary} 0%, ${primary}CC 100%)` }}
              >
                {submitting ? (
                  <><Loader2 size={18} className="animate-spin" /> Submitting…</>
                ) : (
                  <><CheckCircle2 size={18} /> Approve Store <ChevronRight size={16} /></>
                )}
              </button>
            </>
          )}

          {/* Request Changes mode */}
          {actionMode === "request_changes" && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PenLine size={18} className="text-[#F97316]" />
                  <h3 className="text-[16px] font-bold text-[#111827]">Request Changes</h3>
                </div>
                <button onClick={() => { setActionMode("idle"); setNotes(""); setNotesError(null); setError(null); }}
                  className="text-[#9CA3AF] hover:text-[#374151] transition-colors">
                  <X size={18} />
                </button>
              </div>
              <p className="text-[13px] text-[#6B7280]">
                Describe what you'd like changed. {branding.companyName} will update the store and send you a new review link.
              </p>

              <div>
                <label className="block text-[12px] font-semibold text-[#374151] mb-1.5 flex items-center gap-1.5">
                  <MessageSquare size={12} />
                  What needs to change? <span className="text-[#EF4444] font-normal">(required)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => { setNotes(e.target.value); if (notesError) setNotesError(null); }}
                  placeholder="e.g. Please update the logo to the new version, change the primary color to navy blue, and add our tagline 'Quality First' to the hero section."
                  rows={4}
                  className={`w-full px-4 py-3 rounded-xl border text-[14px] text-[#111827] placeholder:text-[#D1D5DB] focus:outline-none transition-colors resize-none ${notesError ? "border-[#EF4444] focus:border-[#EF4444]" : "border-[#E5E7EB] focus:border-[#F97316]"}`}
                />
                {notesError && (
                  <p className="text-[12px] text-[#EF4444] mt-1">{notesError}</p>
                )}
              </div>

              {error && (
                <p className="text-[13px] text-[#EF4444] bg-[#FEF2F2] rounded-xl px-4 py-3">{error}</p>
              )}

              <button
                onClick={handleRequestChanges}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-white font-bold text-[15px] transition-all active:scale-[0.98] disabled:opacity-60 shadow-sm bg-[#F97316] hover:bg-[#EA6C0A]"
              >
                {submitting ? (
                  <><Loader2 size={18} className="animate-spin" /> Sending…</>
                ) : (
                  <><PenLine size={18} /> Send Change Request <ChevronRight size={16} /></>
                )}
              </button>
            </>
          )}

          <p className="text-[11px] text-[#9CA3AF] text-center">
            {store.approvalExpiresAt
              ? `This link expires on ${new Date(store.approvalExpiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
              : "This link is valid for 14 days from when it was sent."}
          </p>
        </div>

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-[12px] text-[#9CA3AF]">
            Sent by {branding.companyName} · Powered by{" "}
            <a href="https://mergetasks.com" target="_blank" rel="noopener noreferrer"
              className="text-primary hover:underline">MergeTasks</a>
          </p>
        </div>
      </div>
    </div>
  );
}
