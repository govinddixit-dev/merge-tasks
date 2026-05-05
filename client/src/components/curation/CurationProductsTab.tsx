import { useState } from "react";
import { useLocation } from "wouter";
import { Star, Check, Plus, Trash2, Package, Download, Database, ImageIcon, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import PriceMatrixModal from "./PriceMatrixModal";

type PromoProduct = {
  name: string;
  supplier: string;
  price: string;
  category: string;
  rating: number;
  inStock: boolean;
  type: "promo";
  image: string;
  dbId?: number;
};

interface CurationProductsTabProps {
  promoFiltered: PromoProduct[];
  viewMode: "grid" | "list";
  addedProducts: Set<string>;
  onAddProduct: (key: string, productName: string) => void;
  onDeleteProduct: (id: number, name: string) => void;
  clientId: number | null;
}

/** Reusable image component with graceful onError fallback */
function ProductImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={`flex items-center justify-center ${className || ""}`}>
        <ImageIcon size={24} className="text-[#D4D4D8]" strokeWidth={1.2} />
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setBroken(true)} />;
}

export default function CurationProductsTab({
  promoFiltered,
  viewMode,
  addedProducts,
  onAddProduct,
  onDeleteProduct,
  clientId,
}: CurationProductsTabProps) {
  const [, navigate] = useLocation();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [pricingTarget, setPricingTarget] = useState<{ id: number; name: string } | null>(null);

  if (promoFiltered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-[fadeIn_0.5s_ease-out]">
        <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes pulse-ring{0%{transform:scale(1);opacity:0.3}50%{transform:scale(1.08);opacity:0.15}100%{transform:scale(1);opacity:0.3}}`}</style>
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full bg-primary/10" style={{ animation: 'pulse-ring 3s ease-in-out infinite' }} />
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary/5 to-primary/15 flex items-center justify-center" style={{ animation: 'float 4s ease-in-out infinite' }}>
            <Package size={32} className="text-primary/60" strokeWidth={1.5} />
          </div>
        </div>
        <h3 className="text-[17px] font-bold text-mt-ink mb-2">No products yet</h3>
        <p className="text-[13px] text-mt-ink-3 text-center max-w-sm mb-6 leading-relaxed">Import your first products from a supplier catalog, CSV file, or add them manually to start building your catalog.</p>
        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-sm"
            onClick={() => {
              const btn = document.querySelector('[data-import-trigger]') as HTMLButtonElement;
              if (btn) btn.click();
              else document.dispatchEvent(new CustomEvent('open-import'));
            }}
          >
            <Download size={13} /> Import Products
          </button>
          <button
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface transition-all"
            onClick={() => {
              const btn = document.querySelector('[data-catalog-trigger]') as HTMLButtonElement;
              if (btn) btn.click();
              else document.dispatchEvent(new CustomEvent('open-catalog'));
            }}
          >
            <Database size={13} /> Browse Live Catalog
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" : "space-y-3"}>
      {promoFiltered.map((product, i) => {
        const key = `promo-${product.name}`;
        const isAdded = addedProducts.has(key);
        return viewMode === "grid" ? (
          <div
            key={i}
            className="bg-white rounded-lg border border-mt-border cursor-pointer card-hover overflow-hidden hover:shadow-[0_8px_30px_rgba(0,0,0,0.10)] hover:border-primary/20 hover:-translate-y-0.5 transition-all duration-200"
            onClick={() => { if (product.dbId) navigate(`/curation/product/${product.dbId}`); }}
          >
            <div className="w-full h-44 flex items-center justify-center bg-[#F8F8FA] p-4">
              <ProductImage src={product.image} alt={product.name} className="h-full w-full object-contain" />
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[10px] text-mt-ink-4 uppercase tracking-wider font-medium">{product.supplier}</p>
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">Promo</span>
              </div>
              <h3 className="text-[13px] font-semibold text-mt-ink mb-2">{product.name}</h3>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-bold text-mt-ink">{product.price}</span>
                <div className="flex items-center gap-1">
                  <Star size={10} fill="var(--mt-brand)" className="text-primary" />
                  <span className="text-[11px] font-medium text-primary">{product.rating}</span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className={`flex items-center gap-1 text-[11px] ${product.inStock ? "text-[#16A34A]" : "text-[#EF4444]"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${product.inStock ? "bg-[#16A34A]" : "bg-[#EF4444]"}`} />
                  {product.inStock ? "In Stock" : "Low Stock"}
                </span>
                {isAdded ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-[#16A34A]"><Check size={10} /> Added</span>
                ) : (
                  <button className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:opacity-80 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onAddProduct(key, product.name); }}>
                    <Plus size={10} /> Add
                  </button>
                )}
              </div>
              {product.dbId && (
                <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-[#F0F0F0]">
                  {clientId !== null && (
                    <button
                      className="flex items-center gap-1 text-[11px] font-medium text-primary hover:bg-primary/10 px-2 py-1 rounded transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPricingTarget({ id: product.dbId!, name: product.name });
                      }}
                    >
                      <DollarSign size={10} /> Set Pricing
                    </button>
                  )}
                  <button
                    className="flex items-center gap-1 text-[11px] font-medium text-[#EF4444] hover:text-[#DC2626] hover:bg-[#FEF2F2] px-2 py-1 rounded transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({ id: product.dbId!, name: product.name });
                    }}
                  >
                    <Trash2 size={10} /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            key={i}
            className="flex items-center gap-4 p-4 bg-white rounded-lg border border-mt-border hover:border-primary/30 hover:shadow-md transition-all duration-200 cursor-pointer"
            onClick={() => { if (product.dbId) navigate(`/curation/product/${product.dbId}`); }}
          >
            <div className="w-16 h-16 flex-shrink-0 bg-[#F8F8FA] rounded-lg flex items-center justify-center p-2">
              <ProductImage src={product.image} alt={product.name} className="h-full w-full object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-mt-ink">{product.name}</h3>
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">Promo</span>
              </div>
              <p className="text-[11px] text-mt-ink-3">{product.supplier} · {product.category}</p>
            </div>
            <span className="text-[14px] font-bold text-mt-ink">{product.price}</span>
            <div className="flex items-center gap-1">
              <Star size={10} fill="var(--mt-brand)" className="text-primary" />
              <span className="text-[11px] font-medium text-primary">{product.rating}</span>
            </div>
            {isAdded ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#16A34A]"><Check size={10} /> Added</span>
            ) : (
              <button className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:opacity-80"
                onClick={(e) => { e.stopPropagation(); onAddProduct(key, product.name); }}>
                <Plus size={10} /> Add
              </button>
            )}
            {product.dbId && clientId !== null && (
              <button
                className="flex items-center gap-1 text-[11px] font-medium text-primary hover:bg-primary/10 px-2 py-1 rounded transition-all ml-2"
                onClick={(e) => {
                  e.stopPropagation();
                  setPricingTarget({ id: product.dbId!, name: product.name });
                }}
              >
                <DollarSign size={10} /> Set Pricing
              </button>
            )}
            {product.dbId && (
              <button
                className="flex items-center gap-1 text-[11px] font-medium text-[#EF4444] hover:text-[#DC2626] hover:bg-[#FEF2F2] px-2 py-1 rounded transition-all ml-2"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget({ id: product.dbId!, name: product.name });
                }}
              >
                <Trash2 size={10} /> Delete
              </button>
            )}
          </div>
        );
      })}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this product?"
        description={deleteTarget ? <>&ldquo;{deleteTarget.name}&rdquo; will be removed from your catalog. This cannot be undone.</> : null}
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          onDeleteProduct(deleteTarget.id, deleteTarget.name);
          setDeleteTarget(null);
        }}
      />
      <PriceMatrixModal
        open={pricingTarget !== null && clientId !== null}
        onClose={() => setPricingTarget(null)}
        clientId={clientId ?? 0}
        productId={pricingTarget?.id ?? 0}
        productName={pricingTarget?.name ?? ""}
      />
    </div>
  );
}
