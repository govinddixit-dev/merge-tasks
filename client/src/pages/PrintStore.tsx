/**
 * PrintStore — Print Products storefront rendered inside LiveStore
 * (nested subpath "print"). Sits under the LiveStore context so it
 * shares the same cart, header count, and division-scoping as the
 * promotional storefront. Two top-of-page tabs switch between
 * Promotional and Print.
 *
 * Product cards open a detail sheet with size/stock selectors and a
 * quantity tier table; tapping Add to Cart dispatches the shared
 * webstore:add-print-to-cart event so the same cart in the header
 * updates instantly. The user stays on this page.
 */
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { Printer } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useStore } from "./webstore/StoreContext";

type PT = "business_cards" | "flyers" | "banners" | "posters";

const TYPE_LABEL: Record<PT, string> = {
  business_cards: "Business Cards",
  flyers: "Flyers",
  banners: "Banners",
  posters: "Posters",
};

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function PrintStore() {
  const { store } = useStore();
  const storeSlug = store.slug;

  const { data: products, isLoading } = trpc.printProducts.listPublic.useQuery(
    { storeSlug },
    { enabled: !!storeSlug },
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const grouped = useMemo(() => {
    const acc: Record<string, NonNullable<typeof products>> = {};
    for (const p of products ?? []) {
      (acc[p.productType] ??= []).push(p);
    }
    return acc;
  }, [products]);

  const selected = (products ?? []).find((p) => p.id === selectedId) ?? null;

  return (
    <div className="min-h-screen">
      {/* Top-of-store tab navigation — matches LiveStore conventions */}
      <div className="border-b border-mt-border bg-white">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link
            href={`~/s/${storeSlug}/products`}
            className="text-[13px] font-semibold text-mt-ink-3 hover:text-mt-ink pb-1 border-b-2 border-transparent"
          >
            Promotional Products
          </Link>
          <span
            className="text-[13px] font-semibold pb-1 border-b-2"
            style={{ color: store.primaryColor, borderColor: store.primaryColor }}
          >
            Print Products
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0,1,2,3,4,5].map((i) => (
              <div key={i} className="rounded-xl border border-mt-border bg-white overflow-hidden animate-pulse">
                <div className="h-48 bg-mt-surface" />
                <div className="p-4 space-y-2">
                  <div className="h-3 rounded bg-mt-surface w-3/4" />
                  <div className="h-2 rounded bg-mt-surface w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (products ?? []).length === 0 ? (
          <div className="text-center py-20 rounded-xl border border-dashed border-mt-border bg-white">
            <Printer size={28} className="mx-auto mb-3 text-mt-ink-4" />
            <p className="text-[14px] font-semibold text-mt-ink">No print products yet</p>
            <p className="text-[13px] text-mt-ink-3 mt-1.5 max-w-md mx-auto">
              Your distributor hasn&rsquo;t added any print products to this store yet. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {(Object.keys(TYPE_LABEL) as PT[]).map((type) => {
              const group = grouped[type];
              if (!group || group.length === 0) return null;
              return (
                <section key={type}>
                  <h2 className="text-[18px] font-bold text-mt-ink mb-4">{TYPE_LABEL[type]}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {group.map((p) => {
                      const lowTier = p.variants[0]?.pricingTiers[0];
                      return (
                        <button
                          key={p.id}
                          onClick={() => setSelectedId(p.id)}
                          className="rounded-xl border border-mt-border bg-white overflow-hidden text-left transition-all hover:shadow-md hover:-translate-y-0.5"
                          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                        >
                          <div className="h-48 bg-mt-surface flex items-center justify-center overflow-hidden">
                            {p.imageUrls[0] ? (
                              <img src={p.imageUrls[0]} alt={p.name} className="w-full h-full object-cover" />
                            ) : (
                              <Printer size={28} className="text-mt-ink-4 opacity-40" />
                            )}
                          </div>
                          <div className="p-4">
                            <p className="text-[14px] font-semibold text-mt-ink truncate">{p.name}</p>
                            {p.description && (
                              <p className="text-[12px] text-mt-ink-3 mt-1 line-clamp-2">{p.description}</p>
                            )}
                            {lowTier && (
                              <p className="text-[12px] text-mt-ink-2 mt-2">
                                From <span className="font-semibold" style={{ color: store.primaryColor }}>{formatUsd(lowTier.priceInCents)}</span>
                                <span className="text-mt-ink-3"> / unit</span>
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <PrintProductDetail product={selected} onClose={() => setSelectedId(null)} primaryColor={store.primaryColor} />
      )}
    </div>
  );
}

function PrintProductDetail({
  product,
  onClose,
  primaryColor,
}: {
  product: {
    id: number;
    productType: "business_cards" | "flyers" | "banners" | "posters";
    name: string;
    description: string | null;
    imageUrls: string[];
    variants: {
      id: number;
      size: string;
      stock: string;
      pricingTiers: { quantity: number; priceInCents: number }[];
    }[];
  };
  onClose: () => void;
  primaryColor: string;
}) {
  const sizes = Array.from(new Set(product.variants.map((v) => v.size)));
  const [size, setSize] = useState<string>(sizes[0] ?? "");
  const stocks = product.variants.filter((v) => v.size === size).map((v) => v.stock);
  const [stock, setStock] = useState<string>(stocks[0] ?? "");
  const current = product.variants.find((v) => v.size === size && v.stock === stock);
  const tiers = current?.pricingTiers ?? [];
  const [tierQty, setTierQty] = useState<number | null>(tiers[0]?.quantity ?? null);
  const tier = tiers.find((t) => t.quantity === tierQty);
  const bestValueQty = tiers.length > 0
    ? tiers.reduce((a, b) => (a.priceInCents / a.quantity <= b.priceInCents / b.quantity ? a : b)).quantity
    : null;

  React.useEffect(() => {
    const stocksForSize = product.variants.filter((v) => v.size === size).map((v) => v.stock);
    if (stocksForSize.length > 0 && !stocksForSize.includes(stock)) {
      setStock(stocksForSize[0]);
    }
  }, [size, product.variants, stock]);

  React.useEffect(() => {
    if (tiers.length > 0 && !tiers.find((t) => t.quantity === tierQty)) {
      setTierQty(tiers[0].quantity);
    }
  }, [tiers, tierQty]);

  function onAddToCart() {
    if (!tier || !tierQty) return;
    const detail = {
      printProductId: product.id,
      variantId: current?.id,
      productType: product.productType,
      name: product.name,
      size,
      stock,
      tierQuantity: tierQty,
      unitPriceCents: tier.priceInCents,
      image: product.imageUrls[0] ?? null,
    };
    // Stay on the print products page. LiveStore listens for this event
    // and updates the shared cart/count in place.
    window.dispatchEvent(new CustomEvent("webstore:add-print-to-cart", { detail }));
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4 sm:p-8" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-[18px] font-bold text-mt-ink">{product.name}</h2>
              {product.description && <p className="text-[13px] text-mt-ink-3 mt-1">{product.description}</p>}
            </div>
            <button onClick={onClose} className="text-[20px] text-mt-ink-4 hover:text-mt-ink-2 leading-none">×</button>
          </div>

          {sizes.length > 0 && (
            <div className="mb-4">
              <p className="text-[12px] font-semibold text-mt-ink-2 mb-2">Size</p>
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border transition-colors ${size === s ? "text-white" : "text-mt-ink-2 hover:bg-mt-surface"}`}
                    style={{
                      backgroundColor: size === s ? primaryColor : "white",
                      borderColor: size === s ? primaryColor : "#E5E7EB",
                    }}
                  >{s}</button>
                ))}
              </div>
            </div>
          )}

          {stocks.length > 0 && (
            <div className="mb-4">
              <p className="text-[12px] font-semibold text-mt-ink-2 mb-2">Material / Stock</p>
              <div className="flex flex-wrap gap-2">
                {stocks.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStock(s)}
                    className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border transition-colors ${stock === s ? "text-white" : "text-mt-ink-2 hover:bg-mt-surface"}`}
                    style={{
                      backgroundColor: stock === s ? primaryColor : "white",
                      borderColor: stock === s ? primaryColor : "#E5E7EB",
                    }}
                  >{s}</button>
                ))}
              </div>
            </div>
          )}

          {tiers.length > 0 && (
            <div className="mb-5">
              <p className="text-[12px] font-semibold text-mt-ink-2 mb-2">Quantity</p>
              <div className="rounded-lg border border-mt-border divide-y divide-mt-border overflow-hidden">
                {tiers.map((t) => {
                  const active = tierQty === t.quantity;
                  const isBest = t.quantity === bestValueQty;
                  return (
                    <button
                      key={t.quantity}
                      onClick={() => setTierQty(t.quantity)}
                      className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${active ? "" : "hover:bg-mt-surface"}`}
                      style={{ backgroundColor: active ? "rgba(101,75,249,0.06)" : "white" }}
                    >
                      <div>
                        <span className="text-[13px] font-semibold text-mt-ink">{t.quantity} units</span>
                        {isBest && (
                          <span
                            className="ml-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: "rgba(101,75,249,0.08)", color: primaryColor }}
                          >Best value</span>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-[13px] font-semibold text-mt-ink">{formatUsd(t.priceInCents)}</div>
                        <div className="text-[11px] text-mt-ink-3">
                          {formatUsd(t.priceInCents * t.quantity)} total
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-mt-border">
            <div>
              <div className="text-[11px] text-mt-ink-3 uppercase tracking-wide">Total</div>
              <div className="text-[18px] font-bold text-mt-ink">
                {tier && tierQty ? formatUsd(tier.priceInCents * tierQty) : "—"}
              </div>
            </div>
            <button
              onClick={onAddToCart}
              disabled={!tier}
              className="px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ backgroundColor: primaryColor }}
            >
              Add to Cart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
