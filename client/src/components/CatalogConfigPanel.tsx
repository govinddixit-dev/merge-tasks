import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Plus, Trash2, X, Image, DollarSign, Palette, Ruler, ChevronDown, ChevronUp, Save, Loader2, MapPin } from "lucide-react";

type PriceTier = {
  tierType: "quantity" | "size";
  label: string;
  minQty: number | null;
  maxQty: number | null;
  price: string;
};

type ProductConfig = {
  proposalProductId: number;
  productId: number;
  productName: string;
  colors: string[];
  sizes: string[];
  logoPositions: string[];
  priceTiers: PriceTier[];
  images: string[];
  sizeChart: { chartData: Record<string, string>[]; imageUrl: string | null } | null;
};

export function CatalogConfigPanel({ proposalId }: { proposalId: number }) {
  const { data: configData, isLoading, refetch } = trpc.proposals.getProductCatalogConfig.useQuery({ proposalId });
  const saveMutation = trpc.proposals.saveProductCatalogConfig.useMutation({
    onSuccess: () => {
      toast.success("Catalog configuration saved");
      refetch();
    },
    onError: (err) => toast.error(`Failed to save: ${err.message}`),
  });

  const [expandedProduct, setExpandedProduct] = useState<number | null>(null);
  const [localConfigs, setLocalConfigs] = useState<Map<number, ProductConfig>>(new Map());

  useEffect(() => {
    if (configData?.products) {
      const map = new Map<number, ProductConfig>();
      configData.products.forEach((p: { proposalProductId: number; productId: number; productName: string; colors?: string[]; sizes?: string[]; logoPositions?: string[]; priceTiers?: { tierType: string; label: string; minQty: number | null; maxQty: number | null; price: string }[]; images?: string[]; sizeChart?: { chartData: Record<string, string>[]; imageUrl: string | null } | null }) => {
        map.set(p.proposalProductId, {
          proposalProductId: p.proposalProductId,
          productId: p.productId,
          productName: p.productName,
          colors: p.colors || [],
          sizes: p.sizes || [],
          logoPositions: p.logoPositions || [],
          priceTiers: (p.priceTiers || []).map((t) => ({
            tierType: t.tierType as "quantity" | "size",
            label: t.label,
            minQty: t.minQty,
            maxQty: t.maxQty,
            price: t.price,
          })),
          images: p.images || [],
          sizeChart: p.sizeChart || null,
        });
      });
      setLocalConfigs(map);
    }
  }, [configData]);

  const updateConfig = useCallback((ppId: number, updater: (config: ProductConfig) => ProductConfig) => {
    setLocalConfigs(prev => {
      const next = new Map(prev);
      const current = next.get(ppId);
      if (current) next.set(ppId, updater(current));
      return next;
    });
  }, []);

  const saveConfig = useCallback((ppId: number) => {
    const config = localConfigs.get(ppId);
    if (!config) return;
    saveMutation.mutate({
      proposalId,
      proposalProductId: ppId,
      colors: config.colors,
      sizes: config.sizes,
      logoPositions: config.logoPositions,
      priceTiers: config.priceTiers,
      images: config.images,
      sizeChart: config.sizeChart,
    });
  }, [localConfigs, proposalId, saveMutation]);

  if (isLoading) {
    return (
      <div className="bg-white border border-mt-border p-6">
        <div className="flex items-center gap-2 text-[#A1A1AA]">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-[13px]">Loading catalog configuration...</span>
        </div>
      </div>
    );
  }

  const products = Array.from(localConfigs.values());

  if (products.length === 0) {
    return (
      <div className="bg-white border border-mt-border p-6">
        <h3 className="text-[15px] font-bold text-mt-ink mb-2">Catalog Configuration</h3>
        <p className="text-[12px] text-[#A1A1AA]">Add products to the proposal first to configure catalog options.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-mt-border p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[15px] font-bold text-mt-ink">Catalog Configuration</h3>
          <p className="text-[11px] text-[#A1A1AA] mt-0.5">Configure colors, sizes, logo positions, price tiers, and images for the client-facing catalog view</p>
        </div>
      </div>

      <div className="space-y-2">
        {products.map(config => {
          const isExpanded = expandedProduct === config.proposalProductId;
          const hasConfig = config.colors.length > 0 || config.sizes.length > 0 || config.logoPositions.length > 0 || config.priceTiers.length > 0 || config.images.length > 0;

          return (
            <div key={config.proposalProductId} className="border border-mt-border overflow-hidden">
              {/* Product header */}
              <button
                onClick={() => setExpandedProduct(isExpanded ? null : config.proposalProductId)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-mt-surface transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold text-mt-ink">{config.productName}</span>
                  {hasConfig && (
                    <div className="flex items-center gap-1.5">
                      {config.colors.length > 0 && (
                        <span className="text-[9px] font-bold text-primary bg-mt-brand-light px-1.5 py-0.5">{config.colors.length} colors</span>
                      )}
                      {config.sizes.length > 0 && (
                        <span className="text-[9px] font-bold text-[#059669] bg-[#ECFDF5] px-1.5 py-0.5">{config.sizes.length} sizes</span>
                      )}
                      {config.logoPositions.length > 0 && (
                        <span className="text-[9px] font-bold text-[#7C3AED] bg-[#EDE9FE] px-1.5 py-0.5">{config.logoPositions.length} logo pos.</span>
                      )}
                      {config.priceTiers.length > 0 && (
                        <span className="text-[9px] font-bold text-[#D97706] bg-[#FEF3C7] px-1.5 py-0.5">{config.priceTiers.length} tiers</span>
                      )}
                      {config.images.length > 0 && (
                        <span className="text-[9px] font-bold text-[#2563EB] bg-[#EFF6FF] px-1.5 py-0.5">{config.images.length} images</span>
                      )}
                    </div>
                  )}
                </div>
                {isExpanded ? <ChevronUp size={16} className="text-[#A1A1AA]" /> : <ChevronDown size={16} className="text-[#A1A1AA]" />}
              </button>

              {/* Expanded config panel */}
              {isExpanded && (
                <div className="border-t border-mt-border px-4 py-4 bg-mt-surface">
                  <div className="grid grid-cols-3 gap-4">
                    {/* Colors */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Palette size={14} className="text-primary" />
                        <label className="text-[11px] font-bold text-primary tracking-wider uppercase">Colors</label>
                      </div>
                      <ColorSizeEditor
                        values={config.colors}
                        placeholder="Add color (e.g., Red, Navy)"
                        onChange={(colors) => updateConfig(config.proposalProductId, c => ({ ...c, colors }))}
                      />
                    </div>

                    {/* Sizes */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Ruler size={14} className="text-[#059669]" />
                        <label className="text-[11px] font-bold text-[#059669] tracking-wider uppercase">Sizes</label>
                      </div>
                      <ColorSizeEditor
                        values={config.sizes}
                        placeholder="Add size (e.g., S, M, L, XL)"
                        onChange={(sizes) => updateConfig(config.proposalProductId, c => ({ ...c, sizes }))}
                      />
                    </div>

                    {/* Logo Positions */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin size={14} className="text-[#7C3AED]" />
                        <label className="text-[11px] font-bold text-[#7C3AED] tracking-wider uppercase">Logo Positions</label>
                      </div>
                      <ColorSizeEditor
                        values={config.logoPositions}
                        placeholder="Add position (e.g., Left Chest)"
                        onChange={(logoPositions) => updateConfig(config.proposalProductId, c => ({ ...c, logoPositions }))}
                      />
                    </div>
                  </div>

                  {/* Price Tiers */}
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign size={14} className="text-[#D97706]" />
                      <label className="text-[11px] font-bold text-[#D97706] tracking-wider uppercase">Price Tiers</label>
                    </div>
                    <PriceTierEditor
                      tiers={config.priceTiers}
                      onChange={(priceTiers) => updateConfig(config.proposalProductId, c => ({ ...c, priceTiers }))}
                    />
                  </div>

                  {/* Additional Images */}
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Image size={14} className="text-[#2563EB]" />
                      <label className="text-[11px] font-bold text-[#2563EB] tracking-wider uppercase">Additional Images</label>
                    </div>
                    <ImageUrlEditor
                      images={config.images}
                      onChange={(images) => updateConfig(config.proposalProductId, c => ({ ...c, images }))}
                    />
                  </div>

                  {/* Save button */}
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => saveConfig(config.proposalProductId)}
                      disabled={saveMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-[12px] font-semibold hover:bg-[#5840D9] transition-colors disabled:opacity-50"
                    >
                      {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Save Configuration
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

//  Sub-components 

function ColorSizeEditor({ values, placeholder, onChange }: { values: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setInput("");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-white border border-mt-border text-[11px] text-mt-ink">
            {v}
            <button onClick={() => onChange(values.filter((_, idx) => idx !== i))} className="text-[#D4D4D4] hover:text-[#EF4444] transition-colors">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 px-2.5 py-1.5 text-[12px] border border-mt-border focus:border-primary focus:outline-none bg-white"
        />
        <button onClick={add} className="px-2.5 py-1.5 text-[11px] font-semibold text-primary border border-primary hover:bg-mt-brand-light transition-colors">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

function PriceTierEditor({ tiers, onChange }: { tiers: PriceTier[]; onChange: (v: PriceTier[]) => void }) {
  const addTier = () => {
    onChange([...tiers, { tierType: "quantity", label: "", minQty: null, maxQty: null, price: "0.00" }]);
  };

  const updateTier = (i: number, updates: Partial<PriceTier>) => {
    const next = [...tiers];
    next[i] = { ...next[i], ...updates };
    onChange(next);
  };

  const removeTier = (i: number) => onChange(tiers.filter((_, idx) => idx !== i));

  return (
    <div>
      {tiers.length > 0 && (
        <div className="space-y-2 mb-2">
          {tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2 bg-white border border-mt-border px-3 py-2">
              <select
                value={tier.tierType}
                onChange={(e) => updateTier(i, { tierType: e.target.value as "quantity" | "size" })}
                className="text-[11px] border border-mt-border px-1.5 py-1 focus:outline-none focus:border-primary bg-white"
              >
                <option value="quantity">Qty</option>
                <option value="size">Size</option>
              </select>
              <input
                value={tier.label}
                onChange={(e) => updateTier(i, { label: e.target.value })}
                placeholder="Label (e.g., 1-49)"
                className="flex-1 text-[11px] border border-mt-border px-2 py-1 focus:outline-none focus:border-primary bg-white"
              />
              <input
                type="number"
                value={tier.minQty ?? ""}
                onChange={(e) => updateTier(i, { minQty: e.target.value ? Number(e.target.value) : null })}
                placeholder="Min"
                className="w-16 text-[11px] border border-mt-border px-2 py-1 focus:outline-none focus:border-primary bg-white"
              />
              <input
                type="number"
                value={tier.maxQty ?? ""}
                onChange={(e) => updateTier(i, { maxQty: e.target.value ? Number(e.target.value) : null })}
                placeholder="Max"
                className="w-16 text-[11px] border border-mt-border px-2 py-1 focus:outline-none focus:border-primary bg-white"
              />
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-[#A1A1AA]">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={tier.price}
                  onChange={(e) => updateTier(i, { price: e.target.value })}
                  placeholder="0.00"
                  className="w-20 text-[11px] border border-mt-border px-2 py-1 focus:outline-none focus:border-primary bg-white"
                />
              </div>
              <button onClick={() => removeTier(i)} className="text-[#D4D4D4] hover:text-[#EF4444] transition-colors">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={addTier}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-[#D97706] border border-[#D97706] hover:bg-[#FEF3C7] transition-colors"
      >
        <Plus size={12} /> Add Price Tier
      </button>
    </div>
  );
}

function ImageUrlEditor({ images, onChange }: { images: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !images.includes(trimmed)) {
      onChange([...images, trimmed]);
      setInput("");
    }
  };

  return (
    <div>
      <div className="space-y-1.5 mb-2">
        {images.map((url, i) => (
          <div key={i} className="flex items-center gap-2 bg-white border border-mt-border px-3 py-2">
            <span className="flex-1 text-[11px] text-mt-ink-2 truncate">{url}</span>
            <button onClick={() => onChange(images.filter((_, idx) => idx !== i))} className="text-[#D4D4D4] hover:text-[#EF4444] transition-colors flex-shrink-0">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="Paste image URL..."
          className="flex-1 px-2.5 py-1.5 text-[12px] border border-mt-border focus:border-primary focus:outline-none bg-white"
        />
        <button onClick={add} className="px-2.5 py-1.5 text-[11px] font-semibold text-[#2563EB] border border-[#2563EB] hover:bg-[#EFF6FF] transition-colors">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
