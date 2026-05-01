import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2, AlertTriangle, ChevronDown, Save, Loader2, Users, Percent } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface PriceMatrixModalProps {
  open: boolean;
  onClose: () => void;
  clientId: number;
  productId: number;
  productName: string;
  productImageUrl?: string | null;
}

interface TierDraft {
  minQty: number;
  maxQty: number | null;
  unitPriceCents: number;
}

const dollarsToCents = (s: string) => Math.round((parseFloat(s) || 0) * 100);
const centsToDollarStr = (c: number) => (c / 100).toFixed(2);
const formatDollars = (c: number) => `$${(c / 100).toFixed(2)}`;

const marginColor = (pct: number) =>
  pct >= 20 ? "#16A34A" : pct >= 10 ? "#CA8A04" : "#DC2626";

export default function PriceMatrixModal({
  open, onClose, clientId, productId, productName, productImageUrl,
}: PriceMatrixModalProps) {
  // ── Queries ──────────────────────────────────────────────────────────────
  const configQuery = trpc.clientPricing.getConfig.useQuery(
    { clientId, productId },
    { enabled: open },
  );
  const decorationMethodsQuery = trpc.clientPricing.listDecorationMethods.useQuery(
    undefined,
    { enabled: open },
  );
  const zonesQuery = trpc.imprintZones.listForProduct.useQuery(
    { productId },
    { enabled: !!productId },
  );
  const clientsWithPricingQuery = trpc.clientPricing.listClientsWithPricing.useQuery(
    { productId },
    { enabled: open },
  );

  // ── Local draft state ────────────────────────────────────────────────────
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [decorationMethodId, setDecorationMethodId] = useState<number | null>(null);
  const [setupFeeDollars, setSetupFeeDollars] = useState<string>("0.00");
  const [setupFeeMode, setSetupFeeMode] = useState<"one_time" | "per_order">("one_time");
  const [displayMode, setDisplayMode] = useState<"itemize" | "roll_into_unit">("itemize");
  const [previewQty, setPreviewQty] = useState<number>(100);
  const [defaultZoneId, setDefaultZoneId] = useState<number | null>(null);

  // New other-cost draft row
  const [newCostLabel, setNewCostLabel] = useState("");
  const [newCostAmount, setNewCostAmount] = useState("");
  const [newCostSide, setNewCostSide] = useState<"buying" | "selling">("selling");

  // Batch workflow toolbar state
  const [showCopy, setShowCopy] = useState(false);
  const [showMarkup, setShowMarkup] = useState(false);
  const [copySourceId, setCopySourceId] = useState<number | null>(null);
  const [markupRuleType, setMarkupRuleType] =
    useState<"percentage_markup" | "cost_multiplier" | "fixed_margin">("percentage_markup");
  const [markupRuleValue, setMarkupRuleValue] = useState<string>("40");

  // ── Mutations ────────────────────────────────────────────────────────────
  const saveConfigMutation = trpc.clientPricing.saveConfig.useMutation({
    onSuccess: () => {
      toast.success("Pricing saved");
      configQuery.refetch();
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });
  const addOtherCostMutation = trpc.clientPricing.addOtherCost.useMutation({
    onSuccess: () => {
      setNewCostLabel("");
      setNewCostAmount("");
      configQuery.refetch();
    },
    onError: (err) => toast.error(`Add cost failed: ${err.message}`),
  });
  const removeOtherCostMutation = trpc.clientPricing.removeOtherCost.useMutation({
    onSuccess: () => configQuery.refetch(),
    onError: (err) => toast.error(`Remove failed: ${err.message}`),
  });
  const setDefaultZoneMut = trpc.clientPricing.setDefaultImprintZone.useMutation({
    onSuccess: () => toast.success("Default zone saved"),
    onError: (e) => toast.error(e.message),
  });
  const copyFromClientMut = trpc.clientPricing.copyFromClient.useMutation({
    onSuccess: () => {
      const src = clientsWithPricingQuery.data?.find(c => c.clientId === copySourceId);
      toast.success(`Pricing copied from ${src?.companyName ?? "client"}`);
      setShowCopy(false);
      setCopySourceId(null);
      configQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const applyMarkupMut = trpc.clientPricing.applyMarkupRule.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.tiersGenerated} tier(s) updated`);
      setShowMarkup(false);
      configQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Hydrate local state from query result ────────────────────────────────
  useEffect(() => {
    if (!configQuery.data) return;
    const data = configQuery.data;
    if (data.config) {
      setDisplayMode(data.config.displayMode);
      setDefaultZoneId(data.config.defaultImprintZoneId ?? null);
      setTiers(data.tiers.map((t) => ({
        minQty: t.minQty,
        maxQty: t.maxQty,
        unitPriceCents: t.unitPriceCents,
      })));
      if (data.decoration) {
        setDecorationMethodId(data.decoration.decorationMethodId);
        setSetupFeeDollars(centsToDollarStr(data.decoration.setupFeeCents));
        setSetupFeeMode(data.decoration.setupFeeMode);
      } else {
        setDecorationMethodId(null);
        setSetupFeeDollars("0.00");
        setSetupFeeMode("one_time");
      }
    } else {
      setTiers([]);
      setDecorationMethodId(null);
      setSetupFeeDollars("0.00");
      setSetupFeeMode("one_time");
      setDisplayMode("itemize");
      setDefaultZoneId(null);
    }
  }, [configQuery.data]);

  const supplierCosts = configQuery.data?.supplierCosts ?? [];
  const otherCosts = configQuery.data?.otherCosts ?? [];
  const fallbackUsed = configQuery.data?.fallbackUsed ?? false;

  // Show one empty row if tiers is empty (edit surface)
  const displayedTiers: TierDraft[] =
    tiers.length > 0 ? tiers : [{ minQty: 1, maxQty: null, unitPriceCents: 0 }];

  // ── Tier editing helpers ─────────────────────────────────────────────────
  const updateTier = (idx: number, patch: Partial<TierDraft>) => {
    const src = tiers.length > 0 ? tiers : [{ minQty: 1, maxQty: null, unitPriceCents: 0 }];
    setTiers(src.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };
  const addTier = () => {
    const src = tiers.length > 0 ? tiers : [];
    const last = src[src.length - 1];
    const nextMin = last ? (last.maxQty !== null ? last.maxQty + 1 : last.minQty + 100) : 1;
    setTiers([...src, { minQty: nextMin, maxQty: null, unitPriceCents: 0 }]);
  };
  const removeTier = (idx: number) => {
    setTiers(tiers.filter((_, i) => i !== idx));
  };

  // ── Save handler ─────────────────────────────────────────────────────────
  const handleSave = () => {
    const cleanTiers = tiers.filter((t) => t.minQty > 0);
    if (cleanTiers.length === 0) {
      toast.error("At least one pricing tier is required");
      return;
    }
    const existingUpcharges = configQuery.data?.upcharges ?? [];
    saveConfigMutation.mutate({
      clientId,
      productId,
      displayMode,
      tiers: cleanTiers,
      upcharges: existingUpcharges.map((u) => ({
        variantKey: u.variantKey,
        upchargeCents: u.upchargeCents,
      })),
      decorationMethodId,
      setupFeeCents: dollarsToCents(setupFeeDollars),
      setupFeeMode,
    });
  };

  // ── Margin preview (computed from draft state for immediate feedback) ────
  const preview = useMemo(() => {
    const tier = (tiers.length > 0 ? tiers : []).find(
      (t) => previewQty >= t.minQty && (t.maxQty === null || previewQty <= t.maxQty),
    );
    const unitPriceCents = tier?.unitPriceCents ?? 0;
    const setupFeeCents = dollarsToCents(setupFeeDollars);
    const lineSellCents = unitPriceCents * previewQty;
    const totalSellCents =
      lineSellCents + (setupFeeMode === "one_time" ? setupFeeCents : setupFeeCents * previewQty);

    const supplierTier = supplierCosts.find(
      (sc) => previewQty >= sc.minQty && (sc.maxQty === null || previewQty <= sc.maxQty),
    );
    const supplierCostCents = (supplierTier?.unitCostCents ?? 0) * previewQty;
    const marginCents = totalSellCents - supplierCostCents;
    const marginPct = totalSellCents > 0 ? (marginCents / totalSellCents) * 100 : 0;

    return { unitPriceCents, setupFeeCents, totalSellCents, marginPct, marginCents, supplierCostCents };
  }, [tiers, previewQty, setupFeeDollars, setupFeeMode, supplierCosts]);

  // ── Markup preview (for "Apply Markup" inline form) ──────────────────────
  const primarySupplierId = supplierCosts[0]?.supplierId ?? null;
  const sampleCostCents = supplierCosts[0]?.unitCostCents ?? 0;
  const markupPreviewSellCents = useMemo(() => {
    const val = parseFloat(markupRuleValue) || 0;
    if (!sampleCostCents || !val) return 0;
    if (markupRuleType === "percentage_markup") return Math.round(sampleCostCents * (1 + val / 100));
    if (markupRuleType === "cost_multiplier") return Math.round(sampleCostCents * val);
    if (val >= 100) return 0;
    return Math.round(sampleCostCents / (1 - val / 100));
  }, [markupRuleType, markupRuleValue, sampleCostCents]);
  const markupUnitSuffix: Record<typeof markupRuleType, string> = {
    percentage_markup: "% markup",
    cost_multiplier: "× multiplier",
    fixed_margin: "% margin",
  };

  if (!open) return null;

  const loading = configQuery.isLoading;

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-6xl bg-white rounded-xl shadow-lg flex flex-col overflow-hidden"
        style={{ maxHeight: "92vh" }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-mt-border">
          <div className="flex items-center gap-3">
            {productImageUrl ? (
              <img
                src={productImageUrl}
                alt={productName}
                className="w-10 h-10 rounded-lg object-cover border border-mt-border"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-gray-100 border border-mt-border" />
            )}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Client Pricing</div>
              <div className="font-bold text-[15px] text-gray-900">{productName}</div>
            </div>
            {fallbackUsed && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#FEF3C7] text-[#92400E] text-[11px] font-medium">
                <AlertTriangle size={12} /> Using default pricing
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-6 p-6">
              {/* ─── LEFT: Supplier cost reference ─────────────────────── */}
              <div className="col-span-2">
                <div className="bg-[#F9FAFB] rounded-xl p-5 border border-mt-border h-full">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-3">
                    Supplier Cost (Reference)
                  </div>
                  {supplierCosts.length === 0 ? (
                    <div className="text-[13px] text-gray-400 py-10 text-center">
                      No supplier cost data
                    </div>
                  ) : (
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-left text-gray-500 border-b border-mt-border">
                          <th className="py-2 font-medium">Qty Range</th>
                          <th className="py-2 font-medium">Unit Cost</th>
                          <th className="py-2 font-medium">Variant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierCosts.map((sc, i) => (
                          <tr key={i} className="border-b border-mt-border/50 text-gray-600">
                            <td className="py-2">
                              {sc.minQty}
                              {sc.maxQty !== null ? `–${sc.maxQty}` : "+"}
                            </td>
                            <td className="py-2 font-mono">
                              {(sc.nativeCostCents / 100).toFixed(2)} {sc.nativeCurrency}
                            </td>
                            <td className="py-2 text-gray-500">{sc.variantKey ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* ─── RIGHT: editable panels ────────────────────────────── */}
              <div className="col-span-3 space-y-4">
                {/* Panel 1 — Unit Pricing Tiers */}
                <div className="rounded-xl border border-mt-border p-5">
                  {/* Batch workflow toolbar */}
                  <div className="flex items-center gap-2 pb-3 mb-3 border-b border-mt-border">
                    <button
                      onClick={() => { setShowCopy(v => !v); setShowMarkup(false); }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ${
                        showCopy
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-700 border-mt-border hover:bg-gray-50"
                      }`}
                    >
                      <Users size={13} /> Copy from Client
                    </button>
                    <button
                      onClick={() => { setShowMarkup(v => !v); setShowCopy(false); }}
                      disabled={supplierCosts.length === 0}
                      title={supplierCosts.length === 0 ? "No supplier cost data available" : undefined}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        showMarkup
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-700 border-mt-border hover:bg-gray-50"
                      }`}
                    >
                      <Percent size={13} /> Apply Markup
                    </button>
                  </div>

                  {showCopy && (
                    <div className="mb-3 p-3 rounded-lg bg-[#F9FAFB] border border-mt-border">
                      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">
                        Copy pricing from another client
                      </div>
                      {clientsWithPricingQuery.isLoading ? (
                        <div className="text-[12px] text-gray-400 py-1">Loading…</div>
                      ) : (() => {
                        const available = (clientsWithPricingQuery.data ?? []).filter(c => c.clientId !== clientId);
                        if (available.length === 0) {
                          return <div className="text-[12px] text-gray-500 py-1">No other clients have pricing configured for this product yet.</div>;
                        }
                        return (
                          <div className="flex items-center gap-2">
                            <select
                              value={copySourceId ?? ""}
                              onChange={(e) => setCopySourceId(e.target.value ? parseInt(e.target.value) : null)}
                              className="flex-1 px-3 py-1.5 border border-mt-border rounded-md text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                            >
                              <option value="">— Select client —</option>
                              {available.map(c => (
                                <option key={c.clientId} value={c.clientId}>{c.companyName}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                if (!copySourceId) return;
                                copyFromClientMut.mutate({
                                  sourceClientId: copySourceId,
                                  targetClientId: clientId,
                                  productId,
                                });
                              }}
                              disabled={!copySourceId || copyFromClientMut.isPending}
                              className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 inline-flex items-center gap-1 transition-colors"
                            >
                              {copyFromClientMut.isPending && <Loader2 size={12} className="animate-spin" />} Apply
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {showMarkup && (
                    <div className="mb-3 p-3 rounded-lg bg-[#F9FAFB] border border-mt-border">
                      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">
                        Generate tiers from supplier cost
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="inline-flex rounded-md border border-mt-border overflow-hidden text-[11px]">
                          {([
                            ["percentage_markup", "% Markup"],
                            ["cost_multiplier", "× Multiplier"],
                            ["fixed_margin", "Margin %"],
                          ] as const).map(([val, label]) => (
                            <button
                              key={val}
                              onClick={() => setMarkupRuleType(val)}
                              className={`px-2.5 py-1.5 transition-colors ${
                                markupRuleType === val
                                  ? "bg-gray-700 text-white"
                                  : "bg-white text-gray-700 hover:bg-gray-50"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="number"
                          step="0.1"
                          value={markupRuleValue}
                          onChange={(e) => setMarkupRuleValue(e.target.value)}
                          className="w-24 px-3 py-1.5 border border-mt-border rounded-md text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                        />
                        <button
                          onClick={() => {
                            if (!primarySupplierId) return;
                            applyMarkupMut.mutate({
                              clientId,
                              productId,
                              supplierId: primarySupplierId,
                              ruleType: markupRuleType,
                              ruleValue: parseFloat(markupRuleValue) || 0,
                            });
                          }}
                          disabled={
                            !primarySupplierId ||
                            !(parseFloat(markupRuleValue) > 0) ||
                            applyMarkupMut.isPending
                          }
                          className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 inline-flex items-center gap-1 transition-colors"
                        >
                          {applyMarkupMut.isPending && <Loader2 size={12} className="animate-spin" />} Apply to All Tiers
                        </button>
                      </div>
                      {sampleCostCents > 0 && markupPreviewSellCents > 0 && (
                        <p className="text-[11px] text-gray-500 mt-2">
                          e.g. cost {formatDollars(sampleCostCents)} → sell {formatDollars(markupPreviewSellCents)} at {markupRuleValue}{markupUnitSuffix[markupRuleType]}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-[14px] text-gray-900">Unit Pricing Tiers</div>
                    <button
                      onClick={addTier}
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                    >
                      <Plus size={14} /> Add Tier
                    </button>
                  </div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pb-2 font-medium">Min Qty</th>
                        <th className="pb-2 font-medium">Max Qty</th>
                        <th className="pb-2 font-medium">Unit Price ($)</th>
                        <th className="pb-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedTiers.map((t, i) => (
                        <tr key={i}>
                          <td className="pr-2 pb-2">
                            <input
                              type="number"
                              value={t.minQty}
                              onChange={(e) => updateTier(i, { minQty: parseInt(e.target.value) || 0 })}
                              className="w-full px-2 py-1.5 border border-mt-border rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                            />
                          </td>
                          <td className="pr-2 pb-2">
                            <input
                              type="number"
                              value={t.maxQty ?? ""}
                              placeholder="open"
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                updateTier(i, { maxQty: v === "" ? null : parseInt(v) || null });
                              }}
                              className="w-full px-2 py-1.5 border border-mt-border rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                            />
                          </td>
                          <td className="pr-2 pb-2">
                            <input
                              type="number"
                              step="0.01"
                              value={centsToDollarStr(t.unitPriceCents)}
                              onChange={(e) =>
                                updateTier(i, { unitPriceCents: dollarsToCents(e.target.value) })
                              }
                              onBlur={() => {
                                // Tier edits persist only on explicit Save, but blur
                                // nudges the formatted display back to 2dp.
                                updateTier(i, { unitPriceCents: t.unitPriceCents });
                              }}
                              className="w-full px-2 py-1.5 border border-mt-border rounded-md text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                            />
                          </td>
                          <td className="pb-2">
                            <button
                              onClick={() => removeTier(i)}
                              className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              aria-label="Remove tier"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Panel 2 — Decoration & Setup Fee */}
                <div className="rounded-xl border border-mt-border p-5">
                  <div className="font-semibold text-[14px] text-gray-900 mb-3">
                    Decoration &amp; Setup Fee
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                        Method
                      </label>
                      <div className="relative">
                        <select
                          value={decorationMethodId ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDecorationMethodId(v === "" ? null : parseInt(v));
                          }}
                          className="w-full appearance-none px-3 py-2 pr-8 border border-mt-border rounded-md text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                        >
                          <option value="">— None —</option>
                          {decorationMethodsQuery.data?.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                        Setup Fee ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={setupFeeDollars}
                        onChange={(e) => setSetupFeeDollars(e.target.value)}
                        className="w-full px-3 py-2 border border-mt-border rounded-md text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                        Mode
                      </label>
                      <div className="inline-flex rounded-md border border-mt-border overflow-hidden text-[12px]">
                        <button
                          onClick={() => setSetupFeeMode("one_time")}
                          className={`px-3 py-2 transition-colors ${
                            setupFeeMode === "one_time"
                              ? "bg-[#2563EB] text-white"
                              : "bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          One-time
                        </button>
                        <button
                          onClick={() => setSetupFeeMode("per_order")}
                          className={`px-3 py-2 transition-colors ${
                            setupFeeMode === "per_order"
                              ? "bg-[#2563EB] text-white"
                              : "bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          Per order
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Panel 3 — Default Imprint Zone */}
                <div className="rounded-xl border border-mt-border p-5">
                  <div className="text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wide mb-2">Default Imprint Zone</div>
                  <select
                    className="w-full h-9 px-3 text-[13px] border border-[#E5E5E5] rounded-lg bg-white"
                    value={defaultZoneId ?? ""}
                    onChange={(e) => {
                      const val = e.target.value === "" ? null : parseInt(e.target.value);
                      setDefaultZoneId(val);
                      setDefaultZoneMut.mutate({ clientId, productId, imprintZoneId: val });
                    }}
                  >
                    <option value="">— No default (use product default) —</option>
                    {zonesQuery.data?.map(z => (
                      <option key={z.id} value={z.id}>{z.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-mt-ink-4 mt-1">
                    Pre-selects this zone when a client employee opens this product on the webstore.
                  </p>
                </div>

                {/* Panel 4 — Other Costs */}
                <div className="rounded-xl border border-mt-border p-5">
                  <div className="font-semibold text-[14px] text-gray-900 mb-3">Other Costs</div>
                  <div className="space-y-3">
                    {(["buying", "selling"] as const).map((side) => {
                      const rows = otherCosts.filter((c) => c.side === side);
                      return (
                        <div key={side}>
                          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                            {side === "buying"
                              ? "Buying-side (margin only)"
                              : "Selling-side (invoiced)"}
                          </div>
                          {rows.length === 0 ? (
                            <div className="text-[12px] text-gray-400 py-1">None</div>
                          ) : (
                            <ul className="space-y-1">
                              {rows.map((c) => (
                                <li
                                  key={c.id}
                                  className="flex items-center gap-2 text-[13px] py-1"
                                >
                                  <span className="flex-1 text-gray-800">{c.label}</span>
                                  <span className="font-mono text-gray-700">
                                    {formatDollars(c.amountCents)}
                                  </span>
                                  <button
                                    onClick={() =>
                                      removeOtherCostMutation.mutate({ costId: c.id })
                                    }
                                    disabled={removeOtherCostMutation.isPending}
                                    className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                    aria-label="Remove cost"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 pt-4 border-t border-mt-border flex items-end gap-2">
                    <div className="flex-1">
                      <input
                        type="text"
                        placeholder="Label"
                        value={newCostLabel}
                        onChange={(e) => setNewCostLabel(e.target.value)}
                        className="w-full px-3 py-2 border border-mt-border rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                      />
                    </div>
                    <div className="w-24">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={newCostAmount}
                        onChange={(e) => setNewCostAmount(e.target.value)}
                        className="w-full px-3 py-2 border border-mt-border rounded-md text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                      />
                    </div>
                    <div className="inline-flex rounded-md border border-mt-border overflow-hidden text-[11px]">
                      <button
                        onClick={() => setNewCostSide("buying")}
                        className={`px-2 py-2 transition-colors ${
                          newCostSide === "buying"
                            ? "bg-gray-700 text-white"
                            : "bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Buy
                      </button>
                      <button
                        onClick={() => setNewCostSide("selling")}
                        className={`px-2 py-2 transition-colors ${
                          newCostSide === "selling"
                            ? "bg-gray-700 text-white"
                            : "bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Sell
                      </button>
                    </div>
                    <button
                      onClick={() =>
                        addOtherCostMutation.mutate({
                          clientId,
                          productId,
                          cost: {
                            label: newCostLabel.trim(),
                            amountCents: dollarsToCents(newCostAmount),
                            side: newCostSide,
                            sortOrder: otherCosts.length,
                          },
                        })
                      }
                      disabled={!newCostLabel.trim() || addOtherCostMutation.isPending}
                      className="px-3 py-2 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center gap-1 transition-colors"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>

                {/* Panel 5 — Display Mode */}
                <div className="rounded-xl border border-mt-border p-5">
                  <div className="font-semibold text-[14px] text-gray-900 mb-3">Display Mode</div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="displayMode"
                        checked={displayMode === "itemize"}
                        onChange={() => setDisplayMode("itemize")}
                        className="accent-[#2563EB]"
                      />
                      <span className="text-[13px] text-gray-800">
                        Itemize at checkout (show setup fee &amp; other costs as separate lines)
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="displayMode"
                        checked={displayMode === "roll_into_unit"}
                        onChange={() => setDisplayMode("roll_into_unit")}
                        className="accent-[#2563EB]"
                      />
                      <span className="text-[13px] text-gray-800">
                        Roll into unit price (hide line items, show one unit price)
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer — preview & save ────────────────────────────────────── */}
        <div className="border-t border-mt-border px-6 py-4 bg-[#F9FAFB]">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <label className="text-[11px] uppercase tracking-wider text-gray-500">
                Preview Qty
              </label>
              <input
                type="number"
                min={1}
                value={previewQty}
                onChange={(e) => setPreviewQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 px-2 py-1.5 border border-mt-border rounded-md text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
              />
            </div>
            <div className="flex-1 grid grid-cols-2 gap-4 text-[12px]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Unit Price</div>
                <div className="font-mono text-gray-800">{formatDollars(preview.unitPriceCents)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Setup Fee</div>
                <div className="font-mono text-gray-800">{formatDollars(preview.setupFeeCents)}</div>
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={saveConfigMutation.isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#2563EB] text-white font-semibold text-[13px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors"
            >
              {saveConfigMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save Pricing
            </button>
          </div>

          <div className="rounded-xl border p-4 mt-4" style={{ borderColor: marginColor(preview.marginPct) + "40", backgroundColor: marginColor(preview.marginPct) + "08" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Margin Analysis</span>
              <span className="text-[13px] font-bold font-mono" style={{ color: marginColor(preview.marginPct) }}>
                {preview.marginPct.toFixed(1)}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-3">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.max(0, Math.min(100, preview.marginPct))}%`,
                  backgroundColor: marginColor(preview.marginPct),
                }}
              />
            </div>

            {/* Cost vs Sell breakdown */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Cost</div>
                <div className="text-[12px] font-mono font-semibold text-gray-600">{formatDollars(preview.supplierCostCents)}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Margin $</div>
                <div className="text-[12px] font-mono font-semibold" style={{ color: marginColor(preview.marginPct) }}>{formatDollars(preview.marginCents)}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Sell</div>
                <div className="text-[12px] font-mono font-semibold text-gray-800">{formatDollars(preview.totalSellCents)}</div>
              </div>
            </div>

            {/* Warning when margin is low */}
            {preview.marginPct < 10 && preview.totalSellCents > 0 && (
              <div className="mt-2 text-[11px] text-red-600 font-medium flex items-center gap-1">
                <span>⚠</span>
                <span>Margin below 10% — review pricing before saving.</span>
              </div>
            )}
            {preview.marginPct >= 10 && preview.marginPct < 20 && (
              <div className="mt-2 text-[11px] text-amber-600 font-medium flex items-center gap-1">
                <span>↗</span>
                <span>Margin is thin — consider increasing sell price.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
