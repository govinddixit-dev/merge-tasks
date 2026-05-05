/**
 * PrintProductsTab — distributor-facing management for print products,
 * variants, and quantity pricing tiers.
 *
 * Progressive form: basic product info first, variants + tiers once the
 * name/type are filled in. Bulk CSV upload lives alongside the list.
 */
import React, { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Upload, Download, Loader2, ChevronDown, ChevronUp, Link2,
} from "lucide-react";

type ProductType = "business_cards" | "flyers" | "banners" | "posters";
const PRODUCT_TYPES: { id: ProductType; label: string }[] = [
  { id: "business_cards", label: "Business Cards" },
  { id: "flyers", label: "Flyers" },
  { id: "banners", label: "Banners" },
  { id: "posters", label: "Posters" },
];

interface PricingTierDraft { quantity: string; priceDollars: string }
interface VariantDraft { size: string; stock: string; tiers: PricingTierDraft[] }
interface PrintProductDraft {
  name: string;
  description: string;
  productType: ProductType;
  variants: VariantDraft[];
}

const emptyDraft = (): PrintProductDraft => ({
  name: "",
  description: "",
  productType: "business_cards",
  variants: [{ size: "", stock: "", tiers: [{ quantity: "", priceDollars: "" }] }],
});

export function PrintProductsTab({ storeId }: { storeId: number }) {
  const list = trpc.printProducts.list.useQuery({ storeId });
  const createMut = trpc.printProducts.create.useMutation();
  const deleteMut = trpc.printProducts.delete.useMutation();
  const bulkImportMut = trpc.printProducts.bulkImport.useMutation();
  const templateQuery = trpc.printProducts.bulkImportTemplate.useQuery(undefined, { enabled: false });

  const supplierList = trpc.printSupplier.list.useQuery({ storeId });
  const supplierConnect = trpc.printSupplier.connect.useMutation();
  const supplierSync = trpc.printSupplier.sync.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<PrintProductDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [showSupplier, setShowSupplier] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ supplierName: "", apiEndpoint: "", apiKey: "" });
  const fileInput = useRef<HTMLInputElement | null>(null);

  type ListItem = NonNullable<typeof list.data>[number];
  const productsByType: Record<string, ListItem[]> = {};
  for (const p of list.data ?? []) {
    (productsByType[p.productType] ??= []).push(p);
  }

  async function onCreate() {
    if (!draft.name.trim()) { toast.error("Name is required"); return; }
    if (draft.variants.length === 0 || !draft.variants[0].size) {
      toast.error("At least one variant with size and stock is required"); return;
    }
    setSaving(true);
    try {
      await createMut.mutateAsync({
        storeId,
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        productType: draft.productType,
        imageUrls: [],
        divisionIds: [],
        variants: draft.variants.map((v) => ({
          size: v.size.trim(),
          stock: v.stock.trim(),
          sortOrder: 0,
          pricingTiers: v.tiers
            .filter((t) => t.quantity && t.priceDollars)
            .map((t) => ({
              quantity: parseInt(t.quantity, 10),
              priceInCents: Math.round(parseFloat(t.priceDollars) * 100),
            })),
        })),
      });
      toast.success("Print product created");
      setShowForm(false);
      setDraft(emptyDraft());
      list.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the print product");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await deleteMut.mutateAsync({ id });
      toast.success("Product deactivated");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the product");
    }
  }

  async function onUploadCsv(file: File) {
    const text = await file.text();
    try {
      const r = await bulkImportMut.mutateAsync({ storeId, csv: text });
      toast.success(`${r.created} print product${r.created === 1 ? "" : "s"} imported`);
      list.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Print product import failed");
    }
  }

  async function onDownloadTemplate() {
    const r = await templateQuery.refetch();
    if (!r.data) return;
    const blob = new Blob([r.data.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "print-products-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onConnectSupplier() {
    if (!supplierDraft.supplierName.trim()) { toast.error("Supplier name is required"); return; }
    try {
      await supplierConnect.mutateAsync({
        storeId,
        supplierName: supplierDraft.supplierName.trim(),
        apiEndpoint: supplierDraft.apiEndpoint.trim() || undefined,
        apiKey: supplierDraft.apiKey.trim() || undefined,
      });
      toast.success("Supplier connected");
      setSupplierDraft({ supplierName: "", apiEndpoint: "", apiKey: "" });
      supplierList.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't connect the supplier");
    }
  }

  async function onSyncSupplier(id: number) {
    try {
      const r = await supplierSync.mutateAsync({ connectionId: id });
      if (r.status === "pending") {
        toast.info(r.message);
      } else {
        toast.success("Supplier sync complete");
      }
      supplierList.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Supplier sync failed");
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] text-mt-ink-3">Manage the print catalog this store can order from.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadCsv(f); e.target.value = ""; }}
          />
          <button
            onClick={onDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-mt-border text-[12px] font-semibold text-mt-ink-2 hover:bg-mt-surface transition-colors"
          >
            <Download size={13} /> CSV Template
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={bulkImportMut.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-mt-border text-[12px] font-semibold text-mt-ink-2 hover:bg-mt-surface transition-colors disabled:opacity-60"
          >
            {bulkImportMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Bulk Import
          </button>
          <button
            onClick={() => { setShowForm(true); setDraft(emptyDraft()); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "#654BF9" }}
          >
            <Plus size={13} /> New Print Product
          </button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl border border-mt-border bg-white p-5">
          <h3 className="text-[14px] font-bold text-mt-ink mb-4">New Print Product</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-mt-ink mb-1">Product Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Standard Business Card"
                className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-mt-ink mb-1">Product Type</label>
              <select
                value={draft.productType}
                onChange={(e) => setDraft({ ...draft, productType: e.target.value as ProductType })}
                className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary bg-white"
              >
                {PRODUCT_TYPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] font-semibold text-mt-ink mb-1">Description</label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={2}
                placeholder="Short description shown to customers."
                className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary resize-none"
              />
            </div>
          </div>

          {/* Variants (progressive: shown once name is filled) */}
          {draft.name.trim().length > 0 && (
            <div className="mt-6 pt-6 border-t border-mt-border">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[13px] font-bold text-mt-ink">Variants & Pricing</h4>
                <button
                  onClick={() => setDraft({ ...draft, variants: [...draft.variants, { size: "", stock: "", tiers: [{ quantity: "", priceDollars: "" }] }] })}
                  className="text-[12px] font-semibold text-primary hover:underline"
                >+ Add variant</button>
              </div>
              <div className="space-y-4">
                {draft.variants.map((v, vi) => (
                  <div key={vi} className="rounded-lg border border-mt-border p-4 bg-mt-surface/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                      <input
                        placeholder='Size (e.g. 3.5 x 2 in)'
                        value={v.size}
                        onChange={(e) => {
                          const next = [...draft.variants]; next[vi] = { ...v, size: e.target.value }; setDraft({ ...draft, variants: next });
                        }}
                        className="px-3 py-2 border border-mt-border rounded-lg text-[13px] bg-white outline-none focus:border-primary"
                      />
                      <input
                        placeholder='Stock / Material (e.g. 14pt Matte)'
                        value={v.stock}
                        onChange={(e) => {
                          const next = [...draft.variants]; next[vi] = { ...v, stock: e.target.value }; setDraft({ ...draft, variants: next });
                        }}
                        className="px-3 py-2 border border-mt-border rounded-lg text-[13px] bg-white outline-none focus:border-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-mt-ink-3">Pricing Tiers</p>
                      {v.tiers.map((t, ti) => (
                        <div key={ti} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                          <input
                            type="number"
                            min={1}
                            placeholder="Quantity"
                            value={t.quantity}
                            onChange={(e) => {
                              const next = [...draft.variants]; next[vi] = { ...v, tiers: v.tiers.map((tt, j) => j === ti ? { ...tt, quantity: e.target.value } : tt) }; setDraft({ ...draft, variants: next });
                            }}
                            className="px-3 py-2 border border-mt-border rounded-lg text-[13px] bg-white outline-none focus:border-primary"
                          />
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Price per unit (USD)"
                            value={t.priceDollars}
                            onChange={(e) => {
                              const next = [...draft.variants]; next[vi] = { ...v, tiers: v.tiers.map((tt, j) => j === ti ? { ...tt, priceDollars: e.target.value } : tt) }; setDraft({ ...draft, variants: next });
                            }}
                            className="px-3 py-2 border border-mt-border rounded-lg text-[13px] bg-white outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => {
                              const next = [...draft.variants]; next[vi] = { ...v, tiers: v.tiers.filter((_, j) => j !== ti) }; setDraft({ ...draft, variants: next });
                            }}
                            disabled={v.tiers.length <= 1}
                            className="p-2 text-mt-ink-4 hover:text-red-500 disabled:opacity-30"
                            aria-label="Remove tier"
                          ><Trash2 size={14} /></button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const next = [...draft.variants]; next[vi] = { ...v, tiers: [...v.tiers, { quantity: "", priceDollars: "" }] }; setDraft({ ...draft, variants: next });
                        }}
                        className="text-[11px] font-semibold text-primary hover:underline mt-1"
                      >+ Add tier</button>
                    </div>
                    {draft.variants.length > 1 && (
                      <button
                        onClick={() => setDraft({ ...draft, variants: draft.variants.filter((_, j) => j !== vi) })}
                        className="mt-3 text-[11px] font-semibold text-mt-ink-4 hover:text-red-500"
                      >Remove variant</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={() => { setShowForm(false); setDraft(emptyDraft()); }}
              className="px-4 py-2 rounded-lg border border-mt-border text-[12px] font-semibold text-mt-ink-2 hover:bg-mt-surface transition-colors"
            >Cancel</button>
            <button
              onClick={onCreate}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60 transition-opacity"
              style={{ backgroundColor: "#654BF9" }}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : "Create Product"}
            </button>
          </div>
        </div>
      )}

      {/* Grouped product list */}
      {list.isLoading ? (
        <div className="space-y-2">
          {[0,1,2].map((i) => <div key={i} className="h-16 rounded-lg bg-mt-surface animate-pulse" />)}
        </div>
      ) : (list.data ?? []).length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed border-mt-border">
          <p className="text-[13px] font-semibold text-mt-ink">No print products yet</p>
          <p className="text-[12px] text-mt-ink-3 mt-1">Add your first print product to get started. You can also import a CSV.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#654BF9" }}
          >
            <Plus size={13} /> New Print Product
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {PRODUCT_TYPES.map((pt) => {
            const group = productsByType[pt.id];
            if (!group || group.length === 0) return null;
            return (
              <div key={pt.id}>
                <h3 className="text-[13px] font-bold text-mt-ink mb-3 uppercase tracking-wide">{pt.label}</h3>
                <div className="rounded-lg border border-mt-border divide-y divide-mt-border bg-white">
                  {group.map((p) => (
                    <div key={p.id} className={`flex items-center justify-between px-4 py-3 ${!p.isActive ? "opacity-60" : ""}`}>
                      <div>
                        <div className="text-[13px] font-semibold text-mt-ink">{p.name} {!p.isActive && <span className="text-[10px] ml-2 uppercase text-mt-ink-3">inactive</span>}</div>
                        <div className="text-[11px] text-mt-ink-3 mt-0.5">{p.variants.length} variant{p.variants.length === 1 ? "" : "s"}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onDelete(p.id)}
                          className="p-2 rounded-md hover:bg-red-50 text-mt-ink-3 hover:text-red-500"
                          aria-label="Deactivate"
                        ><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Supplier integrations */}
      <div className="rounded-xl border border-mt-border bg-white">
        <button
          onClick={() => setShowSupplier((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4"
        >
          <div className="flex items-center gap-2">
            <Link2 size={14} className="text-mt-ink-3" />
            <span className="text-[13px] font-bold text-mt-ink">Supplier Integrations</span>
            {(supplierList.data ?? []).length > 0 && (
              <span className="text-[11px] text-mt-ink-3">{supplierList.data?.length} connected</span>
            )}
          </div>
          {showSupplier ? <ChevronUp size={14} className="text-mt-ink-4" /> : <ChevronDown size={14} className="text-mt-ink-4" />}
        </button>
        {showSupplier && (
          <div className="px-5 pb-5 border-t border-mt-border pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input
                value={supplierDraft.supplierName}
                onChange={(e) => setSupplierDraft({ ...supplierDraft, supplierName: e.target.value })}
                placeholder="Supplier name"
                className="px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
              />
              <input
                value={supplierDraft.apiEndpoint}
                onChange={(e) => setSupplierDraft({ ...supplierDraft, apiEndpoint: e.target.value })}
                placeholder="API endpoint (optional)"
                className="px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
              />
              <input
                type="password"
                value={supplierDraft.apiKey}
                onChange={(e) => setSupplierDraft({ ...supplierDraft, apiKey: e.target.value })}
                placeholder="API key (optional, encrypted)"
                className="px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={onConnectSupplier}
              disabled={supplierConnect.isPending}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: "#654BF9" }}
            >
              {supplierConnect.isPending ? <Loader2 size={13} className="animate-spin" /> : "Connect Supplier"}
            </button>

            {(supplierList.data ?? []).length > 0 && (
              <div className="mt-4 space-y-2">
                {(supplierList.data ?? []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-mt-border px-4 py-3">
                    <div>
                      <div className="text-[13px] font-semibold text-mt-ink">{c.supplierName}</div>
                      <div className="text-[11px] text-mt-ink-3 mt-0.5">
                        {c.apiEndpoint ? c.apiEndpoint : "No endpoint configured"}
                        {c.lastSyncedAt && <> · Last synced {new Date(c.lastSyncedAt).toLocaleDateString()}</>}
                      </div>
                    </div>
                    <button
                      onClick={() => onSyncSupplier(c.id)}
                      disabled={supplierSync.isPending}
                      className="px-3 py-1.5 rounded-md border border-mt-border text-[11px] font-semibold text-mt-ink-2 hover:bg-mt-surface disabled:opacity-60"
                    >
                      {supplierSync.isPending ? <Loader2 size={11} className="animate-spin" /> : "Sync Now"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
