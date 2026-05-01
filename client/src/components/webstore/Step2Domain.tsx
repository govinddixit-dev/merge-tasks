import { useEffect, useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { useWebstore } from "./WebstoreContext";
import { trpc } from "@/lib/trpc";

interface Props {
  companyName: string;
  displayDomain: string;
}

type AvailabilityState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; reason: string };

const REASON_COPY: Record<string, string> = {
  empty: "Enter a subdomain to check availability.",
  too_short: "Subdomain must be at least 3 characters.",
  invalid_chars: "Only lowercase letters, numbers, and hyphens are allowed.",
  reserved: "This subdomain is reserved.",
  taken: "This subdomain is already in use.",
  db_unavailable: "Couldn't check availability — try again in a moment.",
};

export default function Step2Domain({ companyName, displayDomain }: Props) {
  const { state, set } = useWebstore();
  const { subdomain, useCustomDomain, customDomain } = state;

  const [availability, setAvailability] = useState<AvailabilityState>({ kind: "idle" });
  const [debouncedSlug, setDebouncedSlug] = useState("");

  const candidateSlug = (subdomain || "").trim().toLowerCase();

  useEffect(() => {
    if (!candidateSlug) {
      setAvailability({ kind: "idle" });
      return;
    }
    setAvailability({ kind: "checking" });
    const t = setTimeout(() => setDebouncedSlug(candidateSlug), 500);
    return () => clearTimeout(t);
  }, [candidateSlug]);

  const check = trpc.stores.checkSlugAvailability.useQuery(
    { slug: debouncedSlug },
    { enabled: debouncedSlug.length > 0, staleTime: 30_000, retry: false }
  );

  useEffect(() => {
    if (!debouncedSlug) {
      set("subdomainAvailable", null);
      return;
    }
    if (check.isLoading) {
      setAvailability({ kind: "checking" });
      set("subdomainAvailable", null);
      return;
    }
    if (check.data) {
      if (check.data.available) {
        setAvailability({ kind: "available" });
        set("subdomainAvailable", true);
      } else {
        setAvailability({ kind: "taken", reason: check.data.reason });
        set("subdomainAvailable", false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.data, check.isLoading, debouncedSlug]);

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">Domain Setup</h2>
      <p className="text-[13px] text-mt-ink-3 mb-7">Choose a subdomain for your client's store</p>

      <div className="space-y-5">
        <div>
          <label className="block text-[12px] font-semibold text-mt-ink-2 mb-2">Subdomain</label>
          <div className="flex">
            <input
              className="flex-1 px-4 py-2.5 text-[13px] border border-mt-border rounded-l-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              placeholder={companyName ? companyName.toLowerCase().replace(/\s+/g, "-") : "client-name"}
              value={subdomain}
              onChange={(e) => set("subdomain", e.target.value)}
            />
            <span className="px-4 py-2.5 text-[13px] bg-mt-surface-2 border border-l-0 border-mt-border rounded-r-lg text-mt-ink-3 font-medium">
              .mergetasks.com
            </span>
          </div>
          {/* Availability indicator */}
          <div className="mt-2 min-h-[18px] flex items-center gap-1.5 text-[12px]">
            {availability.kind === "checking" && (
              <>
                <Loader2 size={12} className="animate-spin text-mt-ink-4" />
                <span className="text-mt-ink-4">Checking availability…</span>
              </>
            )}
            {availability.kind === "available" && (
              <>
                <Check size={12} className="text-[#16A34A]" />
                <span className="text-[#16A34A] font-medium">Available — this subdomain is free to use.</span>
              </>
            )}
            {availability.kind === "taken" && (
              <>
                <X size={12} className="text-[#DC2626]" />
                <span className="text-[#DC2626] font-medium">
                  {REASON_COPY[availability.reason] ?? "Not available."}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="bg-mt-surface rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <input
              type="checkbox"
              checked={useCustomDomain}
              onChange={() => set("useCustomDomain", !useCustomDomain)}
              style={{ accentColor: "var(--mt-brand)" }}
            />
            <label className="text-[13px] font-semibold text-mt-ink">Use custom domain (add-on: $29/mo)</label>
          </div>
          {useCustomDomain && (
            <div className="mt-3">
              <input
                className="w-full px-4 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="e.g., store.brightlabs.com"
                value={customDomain}
                onChange={(e) => set("customDomain", e.target.value)}
              />
              <p className="text-[11px] text-mt-ink-4 mt-2">
                Client IT will need to add a CNAME record pointing to edge.mergetasks.com
              </p>
            </div>
          )}
        </div>

        <div className="bg-white border border-mt-border rounded-lg p-5">
          <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-2">Preview URL</p>
          <p className="text-[16px] font-bold text-primary">{displayDomain}</p>
        </div>
      </div>
    </div>
  );
}
