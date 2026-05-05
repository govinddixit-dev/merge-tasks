/**
 * StoreCustomRequestPage — Employee-facing custom order request form.
 * Accessible via /s/:slug/custom-request
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { ClipboardList, Check, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "./StoreContext";
import { trpc } from "../../lib/trpc";

export default function StoreCustomRequestPage() {
  const { store, isDark, isLoggedIn, storeUser } = useStore();
  const [, navigate] = useLocation();

  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const borderColor = isDark ? "#333" : "#E5E5E5";
  const cardBg = isDark ? "#252525" : "#FAFAFA";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [targetDate, setTargetDate] = useState("");
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

  // Login gate
  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: `${store.primaryColor}20` }}
        >
          <LogIn size={28} style={{ color: store.primaryColor }} />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: fg }}>Sign in Required</h2>
        <p className="text-[13px] mb-6" style={{ color: mutedFg }}>
          You need to be signed in to submit a custom order request.
        </p>
        <button
          onClick={() => navigate(`~/s/${store.slug}/login`)}
          className="px-8 py-3 rounded-lg text-[13px] font-semibold text-white"
          style={{ backgroundColor: store.primaryColor }}
        >
          Sign In
        </button>
      </div>
    );
  }

  // Success state
  if (submitted) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: `${store.primaryColor}20` }}
        >
          <Check size={32} style={{ color: store.primaryColor }} />
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: fg }}>Request Submitted!</h2>
        <p className="text-[13px] mb-6" style={{ color: mutedFg }}>
          Your custom order request has been submitted. You'll be notified when it's reviewed.
        </p>
        <button
          onClick={() => navigate(`~/s/${store.slug}`)}
          className="px-8 py-3 rounded-lg text-[13px] font-semibold text-white"
          style={{ backgroundColor: store.primaryColor }}
        >
          Continue Shopping
        </button>
      </div>
    );
  }

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error("Please enter a title for your request.");
      return;
    }
    if (!description.trim()) {
      toast.error("Please describe what you need.");
      return;
    }

    // Get the store token from cookie
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

  const inputClass =
    "w-full px-3 py-2.5 rounded-lg text-[13px] outline-none transition-colors border";
  const inputStyle = {
    backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF",
    borderColor,
    color: fg,
  };

  return (
    <div className="w-full max-w-[640px] mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${store.primaryColor}15` }}
        >
          <ClipboardList size={20} style={{ color: store.primaryColor }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: fg }}>Custom Order Request</h1>
          <p className="text-[12px]" style={{ color: mutedFg }}>
            Need something special? Describe your request below.
          </p>
        </div>
      </div>

      {/* Form */}
      <div
        className="p-6 rounded-xl space-y-5"
        style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
      >
        {/* Title */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
            Title <span className="text-red-400">*</span>
          </label>
          <input
            placeholder="e.g. Custom branded notebooks for Q2 event"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            placeholder="Describe what you need, including any specific requirements, branding guidelines, or preferences..."
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none resize-none border transition-colors"
            style={inputStyle}
          />
        </div>

        {/* Quantity + Target Date row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
              Quantity <span className="text-[10px] font-normal">(optional)</span>
            </label>
            <input
              type="number"
              min={1}
              placeholder="e.g. 500"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
              Target Date <span className="text-[10px] font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitMut.isPending}
          className="w-full py-3 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
          style={{ backgroundColor: store.primaryColor }}
        >
          {submitMut.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Submitting...
            </>
          ) : (
            "Submit Request"
          )}
        </button>
      </div>

      {/* Info note */}
      <p className="text-[11px] mt-4 text-center" style={{ color: mutedFg }}>
        Your request will be reviewed by the store administrator. You'll receive a notification once it's been reviewed.
      </p>
    </div>
  );
}
