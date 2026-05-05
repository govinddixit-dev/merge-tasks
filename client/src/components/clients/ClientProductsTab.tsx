import { Loader2, Package, AlertTriangle, Check } from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";

interface ClientProductsTabProps {
  clientId: number;
  onSetPricing: (productId: number, productName: string) => void;
}

export default function ClientProductsTab({ clientId, onSetPricing }: ClientProductsTabProps) {
  const { data, isLoading } = trpc.clients.listClientProducts.useQuery({ clientId });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={18} className="animate-spin text-primary" />
      </div>
    );
  }

  const products = data ?? [];

  if (products.length === 0) {
    return (
      <div className="text-center py-10">
        <Package size={32} className="mx-auto mb-3 text-[#E5E5E5]" />
        <p className="text-[13px] text-mt-ink-4">No products in this client&apos;s stores yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {products.map((p, idx) => (
        <motion.div
          key={p.productId}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, delay: Math.min(idx, 15) * 0.03 }}
          className="flex items-center gap-3 p-3 rounded-lg border border-[#F0F0F0] hover:border-mt-border transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-mt-surface border border-mt-border flex items-center justify-center flex-shrink-0 overflow-hidden">
            {p.imageUrl ? (
              <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
            ) : (
              <Package size={16} className="text-mt-ink-4" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <Link
              href={`/curation/product/${p.productId}`}
              className="font-medium text-[13px] text-mt-ink hover:text-primary transition-colors hover:underline truncate block"
            >
              {p.name}
            </Link>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {p.sku && <span className="text-[10px] text-mt-ink-4">{p.sku}</span>}
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-mt-brand-light text-primary capitalize">
                {p.category}
              </span>
              {p.hasClientPricing ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F0FDF4] text-[#16A34A]">
                  <Check size={10} /> Pricing configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#D97706]">
                  <AlertTriangle size={10} /> Default pricing
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => onSetPricing(p.productId, p.name)}
            className="px-2.5 py-1 text-[11px] font-semibold text-primary bg-mt-brand-light rounded-md hover:bg-[#EDE9FE] transition-colors flex-shrink-0 active:scale-[0.97]"
          >
            Set Pricing
          </button>
        </motion.div>
      ))}
    </div>
  );
}
