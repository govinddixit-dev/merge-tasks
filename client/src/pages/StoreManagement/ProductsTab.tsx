/**
 * ProductsTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 — grouped product table for the Store Management Products tab.
 * One row per styleGroup with a 40px thumbnail, color-count pill, aggregate
 * render approval count, primary-variant SKU/category/price, and a clickable
 * row that navigates to the per-store Product Detail page.
 *
 * Per-row actions (edit price, duplicate, toggle featured, divisions, retry
 * render, remove) operate on the primary variant for backwards compatibility;
 * deeper per-variant tuning lives on the detail page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import {
  Search, Package, RefreshCw, MoreHorizontal, Edit, Trash2, Tag, Building2,
  Loader2, Copy, ExternalLink, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { colorNameToHex } from "@/lib/colorMap";
import type { StoreProduct, AvailableProduct, DbStore } from "./StoreManagementTypes";

interface ProductsTabProps {
  effectiveProducts: StoreProduct[];
  filteredProducts: StoreProduct[];
  productSearch: string;
  setProductSearch: (v: string) => void;
  isNumeric: boolean;
  numericId: number;
  dbStore: DbStore | null | undefined;
  dbProducts: Array<Record<string, unknown>>;
  productMenuOpen: number | null;
  setProductMenuOpen: (id: number | null) => void;
  editingProductPrice: { id: number; price: string } | null;
  setEditingProductPrice: (v: { id: number; price: string } | null) => void;
  showAddProductModal: boolean;
  setShowAddProductModal: (v: boolean) => void;
  addProductSearch: string;
  setAddProductSearch: (v: string) => void;
  selectedProductIds: number[];
  setSelectedProductIds: (ids: number[]) => void;
  filteredAvailableProducts: AvailableProduct[];
  availableProducts: AvailableProduct[];
  onProductsChanged: () => void;
}

// ─── Variant-aware product row shape ──────────────────────────────────────────
// effectiveProducts already carries styleGroup/colorName/colorHex/swatchUrl/
// isVariantPrimary/renderApproved (added in storesCrud projection). We collapse
// per-variant rows here for the table; the detail page does the same on its
// own data fetch keyed by styleGroup.
interface VariantRow extends StoreProduct {
  styleGroup?: string | null;
  colorName?: string | null;
  colorHex?: string | null;
  swatchUrl?: string | null;
  isVariantPrimary?: boolean;
  renderApproved?: boolean;
  imageUrl?: string | null;
  basePrice?: string | null;
}

interface ProductGroup {
  styleGroup: string;
  primary: VariantRow;
  variants: VariantRow[];
  variantCount: number;
  approvedCount: number;
}

function groupByStyle(rows: VariantRow[]): ProductGroup[] {
  const buckets = new Map<string, VariantRow[]>();
  for (const r of rows) {
    const key = r.styleGroup || `__solo_${r.id}`;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries()).map(([styleGroup, variants]) => {
    const primary =
      variants.find((v) => v.isVariantPrimary) ?? variants[0];
    return {
      styleGroup,
      primary,
      variants,
      variantCount: variants.length,
      approvedCount: variants.filter((v) => v.renderApproved).length,
    };
  });
}

// Compact, low-saturation thumbnail with subtle border. Falls back to a
// neutral package glyph when the product has no imageUrl.
function ProductThumb({
  src,
  alt,
}: {
  src: string | null | undefined;
  alt: string;
}) {
  if (!src) {
    return (
      <div className="h-10 w-10 rounded-md border border-mt-border bg-mt-surface-2 flex items-center justify-center shrink-0">
        <Package size={14} className="text-mt-ink-4" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className="h-10 w-10 rounded-md border border-mt-border object-cover bg-mt-surface-2 shrink-0"
    />
  );
}

// Status pill compact and consistent with the rest of the platform.
function StatusPill({ status }: { status: string }) {
  const styles =
    status === "Active"
      ? "bg-[#F0FDF4] text-[#16A34A]"
      : status === "Low Stock"
      ? "bg-[#FEF3C7] text-[#D97706]"
      : "bg-[#FEF2F2] text-[#EF4444]";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${styles}`}
    >
      {status}
    </span>
  );
}

function RenderAggregatePill({
  approved,
  total,
}: {
  approved: number;
  total: number;
}) {
  const allApproved = approved === total && total > 0;
  const someApproved = approved > 0 && approved < total;
  const styles = allApproved
    ? "bg-[#F0FDF4] text-[#16A34A]"
    : someApproved
    ? "bg-[#FEF3C7] text-[#D97706]"
    : "bg-mt-surface-2 text-mt-ink-3";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${styles}`}
    >
      {approved}/{total} approved
    </span>
  );
}

// Up to 5 16px swatches inline. Overflow becomes "+N".
function VariantSwatches({ variants }: { variants: VariantRow[] }) {
  const visible = variants.slice(0, 5);
  const overflow = Math.max(0, variants.length - visible.length);
  return (
    <div className="flex items-center gap-1">
      {visible.map((v) => {
        const hex = v.colorHex ?? colorNameToHex(v.colorName ?? null);
        return (
          <span
            key={v.id}
            title={v.colorName ?? "Variant"}
            aria-label={v.colorName ?? "Variant"}
            style={
              hex
                ? { backgroundColor: hex }
                : v.swatchUrl
                ? {
                    backgroundImage: `url(${v.swatchUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : { backgroundColor: "#D4D4D4" }
            }
            className="h-3 w-3 rounded-full ring-1 ring-mt-border"
          />
        );
      })}
      {overflow > 0 && (
        <span className="text-[10px] font-semibold text-mt-ink-4 ml-0.5">
          +{overflow}
        </span>
      )}
    </div>
  );
}

export function ProductsTab({
  filteredProducts,
  productSearch,
  setProductSearch,
  isNumeric,
  numericId,
  dbStore,
  productMenuOpen,
  setProductMenuOpen,
  editingProductPrice,
  setEditingProductPrice,
  showAddProductModal,
  setShowAddProductModal,
  addProductSearch,
  setAddProductSearch,
  selectedProductIds,
  setSelectedProductIds,
  filteredAvailableProducts,
  availableProducts,
  onProductsChanged,
}: ProductsTabProps) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [removeTarget, setRemoveTarget] = React.useState<{ id: number; name: string } | null>(null);

  // Org divisions for the multi-select.
  const { data: orgs } = trpc.organizations.list.useQuery(undefined, { staleTime: 60_000 });
  const primaryOrgId = React.useMemo(() => {
    if (!orgs || orgs.length === 0) return null;
    const owned = orgs.find((o) => o.role === "owner");
    return (owned || orgs[0]).id;
  }, [orgs]);
  void primaryOrgId;
  // TODO(phase-1.5): reintroduce the divisions list from an org-level
  // locations/divisions endpoint. The `trpc.divisions.list` query was
  // removed when the divisions table was dropped in migration 0082.
  type OrgDivision = { id: number; name: string; isActive?: boolean };
  const availableDivisions = React.useMemo<OrgDivision[]>(() => [], []);
  const hasDivisions = availableDivisions.length > 0;

  const [addDivisionIds, setAddDivisionIds] = React.useState<number[]>([]);
  const [editingDivisionsFor, setEditingDivisionsFor] = React.useState<number | null>(null);
  const [editingDivisionIds, setEditingDivisionIds] = React.useState<number[]>([]);

  const toggleInArray = (arr: number[], id: number) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  const currentDivisionsFor = (productId: number): number[] => {
    const sp = (dbStore?.storeProducts || []).find((p) => p.productId === productId);
    return Array.isArray(sp?.divisionIds) ? (sp!.divisionIds as number[]) : [];
  };

  // Phase 8 — collapse the flat per-variant array into one row per styleGroup.
  // The "available products" picker stays grouped too, so distributors don't
  // see 8 dupes of the same product when adding to the store.
  const productGroups = React.useMemo(
    () => groupByStyle(filteredProducts as VariantRow[]),
    [filteredProducts],
  );
  const availableGroups = React.useMemo(
    () => groupByStyle(filteredAvailableProducts as unknown as VariantRow[]),
    [filteredAvailableProducts],
  );
  const totalAvailableGroups = React.useMemo(
    () => groupByStyle(availableProducts as unknown as VariantRow[]).length,
    [availableProducts],
  );

  const removeProductMut = trpc.stores.removeProduct.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
      toast.success("Product removed from store");
      onProductsChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const retryRenderMut = trpc.stores.retryRender.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.action === "analyzing"
          ? "Analyzing first — render will queue automatically"
          : "Render queued",
      );
      utils.stores.getById.invalidate({ id: numericId });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateStoreProductMut = trpc.stores.updateStoreProduct.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
      setEditingProductPrice(null);
      toast.success("Product updated");
      onProductsChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const duplicateProductMut = trpc.products.duplicate.useMutation({
    onSuccess: (created) => {
      if (!created) {
        toast.error("Couldn't duplicate the product");
        return;
      }
      const existingMappings = (dbStore?.storeProducts || []).map((sp) => ({
        productId: sp.productId,
        customPrice: sp.customPrice ?? undefined,
        featured: sp.featured ?? undefined,
        sortOrder: sp.sortOrder ?? undefined,
        divisionIds: Array.isArray(sp.divisionIds) ? (sp.divisionIds as number[]) : undefined,
      }));
      assignProductsMut.mutate({
        storeId: numericId,
        products: [...existingMappings, { productId: created.id }],
      });
      setEditingProductPrice({ id: created.id, price: created.basePrice ?? "0" });
      toast.success("Product duplicated");
    },
    onError: (e) => toast.error(e.message),
  });

  const assignProductsMut = trpc.stores.assignProducts.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
      setShowAddProductModal(false);
      setSelectedProductIds([]);
      setAddProductSearch("");
      toast.success("Products added to store");
      onProductsChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  // Selecting a styleGroup card in the Add Products modal selects ALL its
  // variant productIds, mirroring the Curation "Add Product" flow.
  const isGroupSelected = (g: ProductGroup) =>
    g.variants.every((v) => selectedProductIds.includes(v.id));
  const toggleGroupSelected = (g: ProductGroup) => {
    if (isGroupSelected(g)) {
      const ids = new Set(g.variants.map((v) => v.id));
      setSelectedProductIds(selectedProductIds.filter((id) => !ids.has(id)));
    } else {
      const next = new Set(selectedProductIds);
      g.variants.forEach((v) => next.add(v.id));
      setSelectedProductIds(Array.from(next));
    }
  };

  const navigateToDetail = (g: ProductGroup) => {
    if (!isNumeric) return;
    navigate(
      `/store-management/${numericId}/product/${encodeURIComponent(g.styleGroup)}`,
    );
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3 sm:gap-0">
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mt-ink-4" />
          <input
            className="w-full pl-10 pr-4 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150 placeholder:text-[#C4C4C4]"
            placeholder="Search products..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-mt-ink-4 mr-1">
            {productGroups.length} product{productGroups.length === 1 ? "" : "s"}
          </span>
          <button
            className="sq-action-btn flex items-center gap-1.5 text-[12px] opacity-50 cursor-not-allowed"
            disabled
            title="Requires supplier API connection"
          >
            <RefreshCw size={13} /> Sync Catalog
          </button>
          <button
            className="sq-action-btn primary flex items-center gap-1.5 text-[12px]"
            onClick={() => {
              if (!isNumeric) {
                toast("Demo store — add products from a real store");
                return;
              }
              setShowAddProductModal(true);
            }}
          >
            <Package size={13} /> Add Product
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-mt-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-mt-border">
                {[
                  { label: "Product", w: "" },
                  { label: "SKU", w: "" },
                  { label: "Category", w: "" },
                  { label: "Price", w: "" },
                  { label: "Stock", w: "" },
                  { label: "Status", w: "" },
                  { label: "Render", w: "" },
                  { label: "", w: "w-12" },
                ].map((h) => (
                  <th
                    key={h.label || "actions"}
                    className={`text-left px-5 py-3 text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider ${h.w}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productGroups.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-16">
                    <div className="flex flex-col items-center justify-center text-center">
                      <div className="h-12 w-12 rounded-full bg-mt-surface-2 flex items-center justify-center mb-4">
                        <Package size={20} className="text-mt-ink-4" />
                      </div>
                      <h3 className="text-[14px] font-semibold text-mt-ink mb-1">
                        No products yet
                      </h3>
                      <p className="text-[12px] text-mt-ink-3 mb-4 max-w-xs">
                        Add products from your catalog to get this store up and running.
                      </p>
                      {isNumeric && (
                        <button
                          onClick={() => setShowAddProductModal(true)}
                          className="sq-action-btn primary flex items-center gap-1.5 text-[12px]"
                        >
                          <Package size={13} /> Add your first product
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {productGroups.map((g, i) => {
                const product = g.primary;
                // Aggregate stock across variants when trackInventory is on.
                const aggregateStock = g.variants.reduce(
                  (sum, v) => sum + (typeof v.stock === "number" ? v.stock : 0),
                  0,
                );
                const customPriceVaries = g.variants.some(
                  (v) => v.price !== g.primary.price,
                );

                return (
                  <tr
                    key={g.styleGroup}
                    onClick={() => navigateToDetail(g)}
                    className={`hover:bg-mt-surface-1 transition-colors duration-150 cursor-pointer ${
                      i < productGroups.length - 1 ? "border-b border-mt-border" : ""
                    }`}
                  >
                    {/* Product cell — thumbnail + name + variant pill */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <ProductThumb src={product.imageUrl} alt={product.name} />
                        <div className="min-w-0 flex flex-col">
                          <span className="text-[13px] font-semibold text-mt-ink truncate">
                            {product.name}
                          </span>
                          {g.variantCount > 1 ? (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-mt-ink-3">
                                {g.variantCount} colors
                              </span>
                              <VariantSwatches variants={g.variants} />
                            </div>
                          ) : (
                            <span className="text-[11px] text-mt-ink-4 mt-0.5">
                              {product.colorName ?? "Single variant"}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-mt-ink-3 font-mono whitespace-nowrap">
                      {product.sku ?? "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-mt-surface-2 text-mt-ink-3 whitespace-nowrap">
                        {product.category}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-mt-ink font-mono whitespace-nowrap">
                      {editingProductPrice?.id === product.id && editingProductPrice ? (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            className="w-20 px-2 py-1 text-[12px] border border-primary rounded outline-none"
                            value={editingProductPrice.price}
                            onChange={(e) =>
                              setEditingProductPrice({
                                id: product.id,
                                price: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                if (editingProductPrice)
                                  updateStoreProductMut.mutate({
                                    storeId: numericId,
                                    productId: product.id,
                                    customPrice: editingProductPrice.price,
                                  });
                              } else if (e.key === "Escape") {
                                setEditingProductPrice(null);
                              }
                            }}
                            autoFocus
                          />
                          <button
                            className="text-[11px] text-primary font-semibold"
                            onClick={() => {
                              if (editingProductPrice)
                                updateStoreProductMut.mutate({
                                  storeId: numericId,
                                  productId: product.id,
                                  customPrice: editingProductPrice.price,
                                });
                            }}
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <span>
                          {product.price}
                          {customPriceVaries && (
                            <span className="ml-1 text-[10px] font-normal text-mt-ink-4">
                              (varies)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-mt-ink-2 font-mono whitespace-nowrap">
                      {aggregateStock.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={product.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      <RenderAggregatePill
                        approved={g.approvedCount}
                        total={g.variantCount}
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu
                          open={productMenuOpen === product.id}
                          onOpenChange={(o) => setProductMenuOpen(o ? product.id : null)}
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              className="p-1.5 rounded-md hover:bg-mt-surface-2 transition-colors duration-150"
                              aria-label="Product actions"
                            >
                              <MoreHorizontal size={14} className="text-mt-ink-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[200px]">
                            <DropdownMenuItem
                              icon={<Edit />}
                              onSelect={() =>
                                setEditingProductPrice({
                                  id: product.id,
                                  price: product.price,
                                })
                              }
                            >
                              Edit Price
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={<Copy />}
                              loading={
                                duplicateProductMut.isPending &&
                                duplicateProductMut.variables?.id === product.id
                              }
                              onSelect={() => {
                                if (!isNumeric) {
                                  toast("Demo store");
                                  return;
                                }
                                duplicateProductMut.mutate({ id: product.id });
                              }}
                            >
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={<ExternalLink />}
                              onSelect={() => {
                                const slug =
                                  typeof dbStore?.slug === "string" ? dbStore.slug : "";
                                if (!slug) {
                                  toast("Storefront slug unavailable");
                                  return;
                                }
                                window.open(
                                  `/s/${slug}/product/${product.id}`,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              }}
                            >
                              Preview on storefront
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={<Tag />}
                              loading={
                                updateStoreProductMut.isPending &&
                                updateStoreProductMut.variables?.productId ===
                                  product.id
                              }
                              onSelect={() => {
                                if (!isNumeric) {
                                  toast("Demo store");
                                  return;
                                }
                                updateStoreProductMut.mutate({
                                  storeId: numericId,
                                  productId: product.id,
                                  featured: true,
                                });
                              }}
                            >
                              Toggle Featured
                            </DropdownMenuItem>
                            {hasDivisions && (
                              <DropdownMenuItem
                                icon={<Building2 />}
                                onSelect={() => {
                                  if (!isNumeric) {
                                    toast("Demo store");
                                    return;
                                  }
                                  setEditingDivisionIds(currentDivisionsFor(product.id));
                                  setEditingDivisionsFor(product.id);
                                }}
                              >
                                Divisions…
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              icon={<RefreshCw size={14} />}
                              onClick={() =>
                                retryRenderMut.mutate({
                                  storeId: numericId,
                                  productId: product.id,
                                })
                              }
                              loading={
                                retryRenderMut.isPending &&
                                retryRenderMut.variables?.productId === product.id
                              }
                              disabled={
                                product.effectiveRenderStatus === "awaiting_analysis"
                              }
                            >
                              Retry render
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              icon={<Trash2 />}
                              loading={
                                removeProductMut.isPending &&
                                removeProductMut.variables?.productId === product.id
                              }
                              onSelect={() => {
                                if (!isNumeric) {
                                  toast("Demo store");
                                  return;
                                }
                                setRemoveTarget({
                                  id: product.id,
                                  name: product.name,
                                });
                              }}
                            >
                              Remove from Store
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <ChevronRight size={14} className="text-mt-ink-4" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-product divisions editor */}
      {editingDivisionsFor != null && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => setEditingDivisionsFor(null)}
        >
          <div
            className="bg-white rounded-xl shadow-lg w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-mt-border">
              <h3 className="text-[14px] font-bold text-mt-ink flex items-center gap-2">
                <Building2 size={14} className="text-primary" /> Divisions
              </h3>
              <p className="text-[11px] text-mt-ink-4 mt-1">
                Choose which divisions can see this product. Leave empty to show to all.
              </p>
            </div>
            <div className="px-5 py-3 flex flex-wrap gap-1.5">
              {availableDivisions.map((d) => {
                const active = editingDivisionIds.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() =>
                      setEditingDivisionIds((prev) => toggleInArray(prev, d.id))
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors duration-150 ${
                      active
                        ? "bg-mt-brand-light text-primary border-primary/40"
                        : "bg-white text-mt-ink-3 border-mt-border hover:border-primary/30"
                    }`}
                  >
                    {d.name}
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-mt-border flex items-center justify-end gap-2">
              <button
                className="sq-action-btn text-[12px]"
                onClick={() => setEditingDivisionsFor(null)}
              >
                Cancel
              </button>
              <button
                className="sq-action-btn primary text-[12px] flex items-center gap-1"
                disabled={updateStoreProductMut.isPending}
                onClick={() => {
                  updateStoreProductMut.mutate(
                    {
                      storeId: numericId,
                      productId: editingDivisionsFor,
                      divisionIds: editingDivisionIds,
                    },
                    { onSuccess: () => setEditingDivisionsFor(null) },
                  );
                }}
              >
                {updateStoreProductMut.isPending ? (
                  <>
                    <Loader2 size={11} className="animate-spin" /> Saving…
                  </>
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal — grouped picker. Selecting a card adds ALL its
          variants to the store. */}
      {showAddProductModal && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => setShowAddProductModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-mt-border">
              <h3 className="text-[16px] font-bold text-mt-ink">Add Products to Store</h3>
              <p className="text-[12px] text-mt-ink-4 mt-1">
                Select products from your catalog. Choosing a product adds all its color variants.
              </p>
            </div>
            <div className="px-6 py-3 border-b border-mt-border">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mt-ink-4" />
                <input
                  className="w-full pl-9 pr-4 py-2 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150 placeholder:text-[#C4C4C4]"
                  placeholder="Search products..."
                  value={addProductSearch}
                  onChange={(e) => setAddProductSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            {hasDivisions && (
              <div className="px-6 py-3 border-b border-mt-border">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Building2 size={12} className="text-primary" />
                  <span className="text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wide">
                    Visible to divisions
                  </span>
                </div>
                <p className="text-[11px] text-mt-ink-4 mb-2">
                  Leave empty to make these products visible to all divisions.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {availableDivisions.map((d) => {
                    const active = addDivisionIds.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() =>
                          setAddDivisionIds((prev) => toggleInArray(prev, d.id))
                        }
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors duration-150 ${
                          active
                            ? "bg-mt-brand-light text-primary border-primary/40"
                            : "bg-white text-mt-ink-3 border-mt-border hover:border-primary/30"
                        }`}
                      >
                        {d.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {availableGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="h-12 w-12 rounded-full bg-mt-surface-2 flex items-center justify-center mb-3">
                    <Package size={18} className="text-mt-ink-4" />
                  </div>
                  <p className="text-[13px] font-semibold text-mt-ink-2 mb-1">
                    {totalAvailableGroups === 0
                      ? "All products are already assigned"
                      : "No matching products"}
                  </p>
                  <p className="text-[11px] text-mt-ink-4">
                    {totalAvailableGroups === 0
                      ? "Every product in your catalog is already in this store."
                      : "Try a different search term."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {availableGroups.map((g) => {
                    const selected = isGroupSelected(g);
                    return (
                      <button
                        key={g.styleGroup}
                        type="button"
                        onClick={() => toggleGroupSelected(g)}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-150 ${
                          selected
                            ? "border-primary bg-mt-brand-light"
                            : "border-mt-border bg-white hover:border-primary/40 hover:shadow-sm"
                        }`}
                      >
                        <ProductThumb
                          src={g.primary.imageUrl}
                          alt={g.primary.name}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-mt-ink truncate">
                            {g.primary.name}
                          </div>
                          <div className="text-[11px] text-mt-ink-4 flex items-center gap-2">
                            <span>{g.primary.sku || `ID: ${g.primary.id}`}</span>
                            {g.variantCount > 1 && (
                              <>
                                <span>·</span>
                                <span>{g.variantCount} colors</span>
                              </>
                            )}
                          </div>
                          {g.variantCount > 1 && (
                            <div className="mt-1">
                              <VariantSwatches variants={g.variants} />
                            </div>
                          )}
                        </div>
                        <span
                          className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors duration-150 ${
                            selected
                              ? "border-primary bg-primary"
                              : "border-mt-border"
                          }`}
                        >
                          {selected && (
                            <span className="h-2 w-2 rounded-full bg-white" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-mt-border flex items-center justify-between">
              <span className="text-[12px] text-mt-ink-4">
                {selectedProductIds.length} variant
                {selectedProductIds.length === 1 ? "" : "s"} selected
              </span>
              <div className="flex gap-2">
                <button
                  className="sq-action-btn text-[12px]"
                  onClick={() => {
                    setShowAddProductModal(false);
                    setSelectedProductIds([]);
                    setAddProductSearch("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="sq-action-btn primary text-[12px]"
                  disabled={
                    selectedProductIds.length === 0 || assignProductsMut.isPending
                  }
                  onClick={() => {
                    const existingProducts = (dbStore?.storeProducts || []).map(
                      (
                        sp: {
                          productId: number;
                          customPrice?: string | null;
                          featured?: boolean;
                        },
                        i: number,
                      ) => ({
                        productId: sp.productId,
                        customPrice: sp.customPrice || undefined,
                        featured: sp.featured || false,
                        sortOrder: i,
                      }),
                    );
                    const newProducts = selectedProductIds.map((id, i) => ({
                      productId: id,
                      sortOrder: existingProducts.length + i,
                      divisionIds:
                        addDivisionIds.length > 0 ? addDivisionIds : undefined,
                    }));
                    assignProductsMut.mutate({
                      storeId: numericId,
                      products: [...existingProducts, ...newProducts],
                    });
                    setAddDivisionIds([]);
                  }}
                >
                  {assignProductsMut.isPending
                    ? "Adding..."
                    : `Add ${selectedProductIds.length} Variant${
                        selectedProductIds.length === 1 ? "" : "s"
                      }`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove this product from the store?"
        description={
          removeTarget ? (
            <>
              &ldquo;{removeTarget.name}&rdquo; will be unassigned from this store. The
              catalog record stays intact and you can re-add it later.
            </>
          ) : null
        }
        confirmLabel="Remove"
        loading={removeProductMut.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (!removeTarget) return;
          removeProductMut.mutate(
            { storeId: numericId, productId: removeTarget.id },
            { onSettled: () => setRemoveTarget(null) },
          );
        }}
      />
    </>
  );
}
