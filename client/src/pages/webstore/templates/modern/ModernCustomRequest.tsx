/**
 * ModernCustomRequest — wireframe-driven custom request form for the Modern
 * template.
 *
 * Behavior preserved from StoreCustomRequestPage.legacy.tsx:
 *   - Login gate (sign-in required)
 *   - Required fields: title, description (toast on missing)
 *   - Optional: quantity, target date
 *   - Reads `mt_store_${slug}` cookie for storeToken
 *   - Calls trpc.storeCheckout.submitCustomRequest
 *   - Success state replaces form with confirmation + "Continue Shopping"
 *
 * Visual changes:
 *   - Mixed serif italic + sans heading ("Have something *specific* in mind?")
 *   - Hairline-rule fields (no borders, just bottom rule)
 *   - "What happens next" sidebar with 3-step timeline
 *   - Brand-accent submit button
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Check, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../../StoreContext";
import { trpc } from "@/lib/trpc";
import ModernShell from "./ModernShell";

export default function ModernCustomRequest() {
  const { store, isLoggedIn } = useStore();
  const [, navigate] = useLocation();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [budget, setBudget] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitMut = trpc.storeCheckout.submitCustomRequest.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Request submitted");
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't submit the request — please try again");
    },
  });

  // ── Login gate ────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <ModernShell footer="compact">
        <section className="max-w-md mx-auto px-4 sm:px-6 py-24 text-center">
          <LogIn size={36} className="mx-auto mb-6 text-brand" />
          <h1 className="font-serif-display italic text-[40px] text-ink leading-[1.05] mb-3">
            Sign in required.
          </h1>
          <p className="text-[14px] text-ws-muted mb-8">
            You need to be signed in to submit a custom request.
          </p>
          <button
            type="button"
            onClick={() => navigate(`~/s/${store.slug}/login`)}
            className="inline-flex items-center gap-2 px-7 py-3.5 text-[12px] font-bold tracking-[0.12em] uppercase text-paper"
            style={{ backgroundColor: "var(--color-brand)" }}
          >
            Sign In
          </button>
        </section>
      </ModernShell>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <ModernShell footer="compact">
        <section className="max-w-md mx-auto px-4 sm:px-6 py-24 text-center">
          <Check size={40} className="mx-auto mb-6 text-brand" />
          <h1 className="font-serif-display italic text-[44px] sm:text-[56px] text-ink leading-[1.05] mb-3">
            Request submitted.
          </h1>
          <p className="text-[14px] text-ws-muted mb-8">
            Your distributor will respond within one business day with options and pricing.
          </p>
          <button
            type="button"
            onClick={() => navigate(`~/s/${store.slug}`)}
            className="inline-flex items-center gap-2 px-7 py-3.5 text-[12px] font-bold tracking-[0.12em] uppercase text-paper"
            style={{ backgroundColor: "var(--color-brand)" }}
          >
            Continue Shopping
          </button>
        </section>
      </ModernShell>
    );
  }

  // ── Submit handler ────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error("Please enter a title for your request.");
      return;
    }
    if (!description.trim()) {
      toast.error("Please describe what you need.");
      return;
    }
    const cookieName = `mt_store_${store.slug}`;
    const cookies = document.cookie.split(";").reduce((acc, c) => {
      const [k, v] = c.trim().split("=");
      acc[k] = v;
      return acc;
    }, {} as Record<string, string>);

    submitMut.mutate({
      storeSlug: store.slug,
      storeToken: cookies[cookieName] ?? "",
      title: title.trim(),
      description: description.trim(),
      quantity: quantity ? parseInt(quantity) : undefined,
      targetDate: targetDate || undefined,
    });
  };

  // Hairline-rule input — no border-box, just a bottom rule that thickens
  // on focus. Matches the wireframe Modern aesthetic.
  const hairlineInput = "w-full bg-transparent text-[15px] text-ink py-2 border-0 border-b border-rule focus:border-ink outline-none transition-colors placeholder:text-ws-muted-soft";
  const labelClass = "block text-[10px] font-bold tracking-[0.16em] uppercase text-ws-muted mb-2";

  return (
    <ModernShell footer="default">
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-12 pt-12 pb-20">
        <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-brand mb-3">
          Don't see what you need?
        </p>
        <h1 className="text-[44px] sm:text-[64px] font-bold tracking-tight leading-[1.05] text-ink mb-4">
          Have something <em className="font-serif-display font-normal italic">specific</em> in mind?
        </h1>
        <p className="max-w-[580px] text-[15px] text-ws-muted leading-[1.6]">
          Tell us what you're looking for. Your distributor will reach out within one business day with options and pricing.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-12 mt-12">
          {/* Form */}
          <div className="space-y-7">
            <div>
              <label className={labelClass}>
                Project name <span className="text-red-500">*</span>
              </label>
              <input
                placeholder="e.g. Annual sales kickoff merch"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className={hairlineInput}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-7">
              <div>
                <label className={labelClass}>Quantity</label>
                <input
                  type="number"
                  min={1}
                  placeholder="50"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  className={hairlineInput}
                />
              </div>
              <div>
                <label className={labelClass}>Target budget</label>
                <input
                  placeholder="$2,000 – $5,000"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  className={hairlineInput}
                />
              </div>
              <div>
                <label className={labelClass}>Need by</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={e => setTargetDate(e.target.value)}
                  className={hairlineInput}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>
                Describe what you're looking for <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={6}
                placeholder="Product type, materials, decoration, color preferences…"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className={`${hairlineInput} resize-none`}
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitMut.isPending}
              className="inline-flex items-center gap-2 px-7 py-3.5 text-[12px] font-bold tracking-[0.12em] uppercase text-paper disabled:opacity-60"
              style={{ backgroundColor: "var(--color-brand)" }}
            >
              {submitMut.isPending && <Loader2 size={14} className="animate-spin" />}
              {submitMut.isPending ? "Submitting…" : "Send Request →"}
            </button>
          </div>

          {/* Sidebar — what happens next */}
          <aside className="bg-paper-soft p-6 lg:p-8 self-start">
            <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-ws-muted mb-5">
              What happens next
            </p>
            <ol className="space-y-5">
              {[
                { n: "01", t: "Submit your request", d: "We capture your brief and route it to your account team." },
                { n: "02", t: "We respond in 24h", d: "You'll hear back with options, mockups, or clarifying questions." },
                { n: "03", t: "Approve a proposal", d: "Once you're happy, we produce and ship to your team." },
              ].map(s => (
                <li key={s.n}>
                  <div className="text-[10px] font-bold tracking-[0.16em] text-brand mb-1">
                    STEP {s.n}
                  </div>
                  <div className="text-[15px] font-semibold text-ink mb-1">{s.t}</div>
                  <div className="text-[12px] text-ws-muted leading-relaxed">{s.d}</div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </section>
    </ModernShell>
  );
}
