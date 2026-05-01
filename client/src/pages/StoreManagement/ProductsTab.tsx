/**
 * ProductsTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Products tab for StoreManagement: searchable product table, inline price
 * editing, per-row action menu (edit price, toggle featured, remove), and
 * the "Add Product" modal for assigning catalog products to this store.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import {
  Search, Package, RefreshCw, MoreHorizontal, Edit, Trash2, Tag, Building2, Loader2, Copy, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
  const [removeTarget, setRemoveTarget] = React.useState<{ id: number; name: string } | null>(null);

  // Load org divisions for the multi-select. These are the int-keyed
  // divisions referenced by storeProducts.divisionIds and storeUsers.divisionId
  // — the same ones SSO group routing maps into.
  const { data: orgs } = trpc.organizations.list.useQuery(undefined, { staleTime: 60_000 });
  const primaryOrgId = React.useMemo(() => {
    if (!orgs || orgs.length === 0) return null;
    const owned = orgs.find((o) => o.role === "owner");
    return (owned || orgs[0]).id;
  }, [orgs]);
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
      if (!created) { toast.error("Couldn't duplicate the product"); return; }
      // Attach the duplicate to the current store so the user sees it in
      // the same list immediately. `assignProducts` here preserves the
      // existing mapping and appends the new product id.
      const existingMappings = (dbStore?.storeProducts || []).map((sp) => ({
        productId: sp.productId,
        customPrice: sp.customPrice ?? undefined,
        featured: sp.featured ?? undefined,
        sortOrder: sp.sortOrder ?? undefined,
        divisionIds: Array.isArray(sp.divisionIds) ? (sp.divisionIds as number[]) : undefined,
      }));
      assignProductsMut.mutate({
        storeId: numericId,
        products: [
          ...existingMappings,
          { productId: created.id },
        ],
      });
      // Open the duplicate in edit mode (matches the existing inline editor
      // pattern — the user can immediately tune price or name).
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

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3 sm:gap-0">
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mt-ink-4" />
          <input
            className="w-full pl-10 pr-4 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-[#C4C4C4]"
            placeholder="Search products..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
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

      <div className="bg-white rounded-lg border border-mt-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
              {["Product", "SKU", "Category", "Price", "Stock", "Status", "Render", ""].map((h) => (
                <th
                  key={h}
                  className="text-left px-5 py-3 text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-16">
                  <div className="flex flex-col items-center justify-center text-center">
                    <Package size={32} className="text-mt-ink-4 mb-4" />
                    <h3 className="text-[14px] font-semibold text-mt-ink mb-1">No products yet</h3>
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
            {filteredProducts.map((product, i) => (
              <tr
                key={product.id}
                className="hover:bg-mt-surface transition-colors cursor-pointer"
                style={{ borderBottom: i < filteredProducts.length - 1 ? "1px solid #F5F5F5" : "none" }}
              >
                <td className="px-5 py-3.5 text-[13px] font-semibold text-mt-ink">{product.name}</td>
                <td className="px-5 py-3.5 text-[12px] text-mt-ink-4 data-mono">{product.sku}</td>
                <td className="px-5 py-3.5">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-mt-surface-2 text-mt-ink-3">
                    {product.category}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-[13px] font-semibold text-mt-ink data-mono">
                  {editingProductPrice?.id === product.id && editingProductPrice ? (
                    <div className="flex items-center gap-1">
                      <input
                        className="w-20 px-2 py-1 text-[12px] border border-primary rounded outline-none"
                        value={editingProductPrice.price}
                        onChange={(e) =>
                          setEditingProductPrice({ id: product.id, price: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (editingProductPrice) updateStoreProductMut.mutate({
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
                          if (editingProductPrice) updateStoreProductMut.mutate({
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
                    product.price
                  )}
                </td>
                <td className="px-5 py-3.5 text-[13px] text-mt-ink-2 data-mono">
                  {product.stock.toLocaleString()}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      product.status === "Active"
                        ? "bg-[#F0FDF4] text-[#16A34A]"
                        : product.status === "Low Stock"
                        ? "bg-[#FEF3C7] text-[#D97706]"
                        : "bg-[#FEF2F2] text-[#EF4444]"
                    }`}
                  >
                    {product.status}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  {(() => {
                    const status = product.effectiveRenderStatus ?? product.webstoreRenderStatus ?? "pending";
                    const styles = {
                      complete:           "bg-[#F0FDF4] text-[#16A34A]",
                      rendering:          "bg-[#EFF6FF] text-[#3B82F6]",
                      pending:            "bg-[#FEF3C7] text-[#D97706]",
                      failed:             "bg-[#FEF2F2] text-[#EF4444]",
                      awaiting_analysis:  "bg-[#F3F4F6] text-[#6B7280]",
                    }[status];
                    const label = {
                      complete: "Ready",
                      rendering: "Rendering",
                      pending: "Pending",
                      failed: "Failed",
                      awaiting_analysis: "Awaiting analysis",
                    }[status];
                    return (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${styles}`}>
                        {label}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-5 py-3.5">
                  <DropdownMenu
                    open={productMenuOpen === product.id}
                    onOpenChange={(o) => setProductMenuOpen(o ? product.id : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-1 rounded hover:bg-mt-surface-2 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal size={14} className="text-mt-ink-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                      <DropdownMenuItem
                        icon={<Edit />}
                        onSelect={() => setEditingProductPrice({ id: product.id, price: product.price })}
                      >
                        Edit Price
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<Copy />}
                        loading={duplicateProductMut.isPending && duplicateProductMut.variables?.id === product.id}
                        onSelect={() => {
                          if (!isNumeric) { toast("Demo store"); return; }
                          duplicateProductMut.mutate({ id: product.id });
                        }}
                      >
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<ExternalLink />}
                        onSelect={() => {
                          const slug = typeof dbStore?.slug === "string" ? dbStore.slug : "";
                          if (!slug) { toast("Storefront slug unavailable"); return; }
                          window.open(`/s/${slug}/product/${product.id}`, "_blank", "noopener,noreferrer");
                        }}
                      >
                        Preview on storefront
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<Tag />}
                        loading={
                          updateStoreProductMut.isPending &&
                          updateStoreProductMut.variables?.productId === product.id
                        }
                        onSelect={() => {
                          if (!isNumeric) { toast("Demo store"); return; }
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
                            if (!isNumeric) { toast("Demo store"); return; }
                            setEditingDivisionIds(currentDivisionsFor(product.id));
                            setEditingDivisionsFor(product.id);
                          }}
                        >
                          Divisions…
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        icon={<RefreshCw size={14} />}
                        onClick={() => retryRenderMut.mutate({ storeId: numericId, productId: product.id })}
                        loading={retryRenderMut.isPending && retryRenderMut.variables?.productId === product.id}
                        disabled={product.effectiveRenderStatus === "awaiting_analysis"}
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
                          if (!isNumeric) { toast("Demo store"); return; }
                          setRemoveTarget({ id: product.id, name: product.name });
                        }}
                      >
                        Remove from Store
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
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
                    onClick={() => setEditingDivisionIds((prev) => toggleInArray(prev, d.id))}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
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
                  <><Loader2 size={11} className="animate-spin" /> Saving…</>
                ) : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddProductModal && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => setShowAddProductModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-lg w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-mt-border">
              <h3 className="text-[16px] font-bold text-mt-ink">Add Products to Store</h3>
              <p className="text-[12px] text-mt-ink-4 mt-1">
                Select products from your catalog to add to this store.
              </p>
            </div>
            <div className="px-6 py-3 border-b border-mt-border">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mt-ink-4" />
                <input
                  className="w-full pl-9 pr-4 py-2 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-[#C4C4C4]"
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
                        onClick={() => setAddDivisionIds((prev) => toggleInArray(prev, d.id))}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
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
            <div className="flex-1 overflow-y-auto px-6 py-2">
              {filteredAvailableProducts.length === 0 ? (
                <p className="text-[13px] text-mt-ink-4 py-8 text-center">
                  {availableProducts.length === 0
                    ? "All products are already assigned to this store."
                    : "No matching products found."}
                </p>
              ) : (
                filteredAvailableProducts.map((p: AvailableProduct) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-mt-surface cursor-pointer transition-colors"
                    style={{ borderBottom: "1px solid #F8F8F8" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProductIds.includes(p.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedProductIds([...selectedProductIds, p.id]);
                        } else {
                          setSelectedProductIds(selectedProductIds.filter((id) => id !== p.id));
                        }
                      }}
                      className="rounded border-mt-border"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-mt-ink truncate">{p.name}</div>
                      <div className="text-[11px] text-mt-ink-4">
                        {p.sku || `ID: ${p.id}`} &middot; {p.category || "General"} &middot; ${p.basePrice || "0.00"}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="px-6 py-4 border-t border-mt-border flex items-center justify-between">
              <span className="text-[12px] text-mt-ink-4">{selectedProductIds.length} selected</span>
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
                  disabled={selectedProductIds.length === 0 || assignProductsMut.isPending}
                  onClick={() => {
                    const existingProducts = (dbStore?.storeProducts || []).map(
                      (sp: { productId: number; customPrice?: string | null; featured?: boolean }, i: number) => ({
                        productId: sp.productId,
                        customPrice: sp.customPrice || undefined,
                        featured: sp.featured || false,
                        sortOrder: i,
                      })
                    );
                    const newProducts = selectedProductIds.map((id, i) => ({
                      productId: id,
                      sortOrder: existingProducts.length + i,
                      divisionIds: addDivisionIds.length > 0 ? addDivisionIds : undefined,
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
                    : `Add ${selectedProductIds.length} Product${selectedProductIds.length !== 1 ? "s" : ""}`}
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
          removeTarget
            ? <>&ldquo;{removeTarget.name}&rdquo; will be unassigned from this store. The catalog record stays intact and you can re-add it later.</>
            : null
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
