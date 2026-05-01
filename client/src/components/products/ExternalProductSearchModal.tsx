/**
 * ExternalProductSearchModal
 *
 * Lets distributors search ASI ESP and PromoStandards in real time and
 * import products directly into their catalog with one click.
 *
 * Props:
 *   open         — whether the modal is visible
 *   onClose      — called when the modal should close
 *   onImported   — called with the new local product ID after a successful import
 */

import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  X, Search, Package, Download, CheckCircle2, Loader2,
  Wifi, WifiOff, AlertTriangle, ChevronDown, ChevronUp, Tag
} from "lucide-react";
import { toast } from "sonner";
import type { ExternalProduct } from "../../../../server/integrations/productSearchAdapter";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported?: (localProductId: number) => void;
}

//  Source badge 

function SourceBadge({ source, hasLiveInventory }: { source: string; hasLiveInventory: boolean }) {
  if (source === "promostandards") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
        <Wifi className="w-2.5 h-2.5" /> PromoStandards
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
      ASI ESP
    </span>
  );
}

//  Product card 

function ProductCard({
  product,
  importedId,
  onImport,
  isImporting,
}: {
  product: ExternalProduct;
  importedId: number | undefined;
  onImport: (product: ExternalProduct) => void;
  isImporting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white hover:border-primary/30 transition-colors">
      <div className="flex gap-3 p-3">
        {/* Image */}
        <div className="w-16 h-16 flex-shrink-0 rounded-md overflow-hidden bg-gray-100 flex items-center justify-center">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <Package className="w-6 h-6 text-gray-300" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{product.name}</p>
              <p className="text-xs text-gray-500 truncate">{product.supplier} · {product.productNumber}</p>
            </div>
            <SourceBadge source={product.source} hasLiveInventory={product.hasLiveInventory} />
          </div>

          <div className="flex items-center gap-3 mt-1.5">
            {product.basePrice != null && (
              <span className="text-sm font-semibold text-gray-900">
                ${product.basePrice.toFixed(2)}
              </span>
            )}
            {product.minQuantity > 1 && (
              <span className="text-xs text-gray-400">Min qty: {product.minQuantity}</span>
            )}
            {product.colors.length > 0 && (
              <span className="text-xs text-gray-400">{product.colors.length} colors</span>
            )}
          </div>

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 text-xs text-primary hover:opacity-80 flex items-center gap-0.5"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Less" : "Details"}
          </button>
        </div>

        {/* Import button */}
        <div className="flex-shrink-0 flex items-center">
          {importedId ? (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle2 className="w-4 h-4" /> In catalog
            </span>
          ) : (
            <button
              onClick={() => onImport(product)}
              disabled={isImporting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Import
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 pt-2 space-y-2">
          {product.description && (
            <p className="text-xs text-gray-600 line-clamp-3">{product.description}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {product.colors.slice(0, 8).map((c) => (
              <span key={c} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{c}</span>
            ))}
            {product.colors.length > 8 && (
              <span className="text-[10px] text-gray-400">+{product.colors.length - 8} more</span>
            )}
          </div>
          {product.sizes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {product.sizes.map((s) => (
                <span key={s} className="text-[10px] bg-mt-brand-light text-primary px-1.5 py-0.5 rounded">{s}</span>
              ))}
            </div>
          )}
          {product.decorationMethods.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="w-3 h-3 text-gray-400" />
              {product.decorationMethods.map((d) => (
                <span key={d} className="text-[10px] text-gray-500">{d}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

//  Main modal 

export default function ExternalProductSearchModal({ open, onClose, onImported }: Props) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: status } = trpc.externalProducts.connectionStatus.useQuery(undefined, {
    enabled: open,
  });

  const { data: searchData, isFetching, error } = trpc.externalProducts.search.useQuery(
    { query: submittedQuery, limit: 50 },
    { enabled: !!submittedQuery }
  );

  const externalIds = searchData?.products.map((p) => p.externalId) ?? [];
  const { data: importedMap } = trpc.externalProducts.checkImported.useQuery(
    { externalIds },
    { enabled: externalIds.length > 0 }
  );

  const importMutation = trpc.externalProducts.importProduct.useMutation({
    onSuccess: (result, variables) => {
      setImportingId(null);
      if (result.alreadyExists) {
        toast.info("Already in your catalog");
      } else {
        toast.success("Product imported to catalog");
        onImported?.(result.id);
      }
    },
    onError: (err) => {
      setImportingId(null);
      toast.error(`Import failed: ${err.message}`);
    },
  });

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) setSubmittedQuery(query.trim());
    },
    [query]
  );

  const handleImport = useCallback(
    (product: ExternalProduct) => {
      setImportingId(product.externalId);
      importMutation.mutate({ product });
    },
    [importMutation]
  );

  if (!open) return null;

  const noSourcesConnected =
    status &&
    !status.asi.connected &&
    !status.sanmar.connected &&
    !status.ss.connected &&
    !status.alphabroder.connected;

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Search Live Catalog</h2>
            <p className="text-xs text-gray-500 mt-0.5">ASI ESP + PromoStandards suppliers</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Source status bar */}
        {status && (
          <div className="flex items-center gap-3 px-5 py-2 bg-gray-50 border-b border-gray-100 flex-wrap">
            {[
              { key: "asi", label: status.asi.label, connected: status.asi.connected },
              { key: "sanmar", label: status.sanmar.label, connected: status.sanmar.connected },
              { key: "ss", label: status.ss.label, connected: status.ss.connected },
              { key: "alphabroder", label: status.alphabroder.label, connected: status.alphabroder.connected },
            ].map((src) => (
              <span
                key={src.key}
                className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  src.connected
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-gray-100 text-gray-400 border border-gray-200"
                }`}
              >
                {src.connected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                {src.label}
              </span>
            ))}
          </div>
        )}

        {/* No sources warning */}
        {noSourcesConnected && (
          <div className="mx-5 mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800">No sources connected</p>
              <p className="text-xs text-yellow-700 mt-0.5">
                Add your ASI or PromoStandards credentials in{" "}
                <a href="/settings?tab=integrations" className="underline text-primary">Settings → Integrations</a> to enable live search.
                Platform-level credentials will be used if configured.
              </p>
            </div>
          </div>
        )}

        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex gap-2 px-5 py-3 border-b border-gray-100">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products (e.g. 'blue polo shirt', 'tumbler', 'tote bag')"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!query.trim() || isFetching}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </button>
        </form>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {isFetching && !searchData && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm">Searching ASI ESP and PromoStandards…</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              Search failed: {error.message}
            </div>
          )}

          {searchData && !isFetching && (
            <>
              {/* Source summary */}
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>
                  {searchData.totalCount} result{searchData.totalCount !== 1 ? "s" : ""}
                  {searchData.sources.asi.queried && ` · ASI: ${searchData.sources.asi.count}`}
                  {searchData.sources.promostandards.queried && ` · PromoStandards: ${searchData.sources.promostandards.count}`}
                </span>
                {(searchData.sources.asi.error || searchData.sources.promostandards.error) && (
                  <span className="text-yellow-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Some sources unavailable
                  </span>
                )}
              </div>

              {searchData.products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <Package className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">No products found for "{submittedQuery}"</p>
                  <p className="text-xs mt-1">Try a different search term</p>
                </div>
              ) : (
                searchData.products.map((product) => (
                  <ProductCard
                    key={product.externalId}
                    product={product}
                    importedId={importedMap?.[product.externalId]}
                    onImport={handleImport}
                    isImporting={importingId === product.externalId}
                  />
                ))
              )}
            </>
          )}

          {!submittedQuery && !isFetching && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Search className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">Enter a search term to find products</p>
              <p className="text-xs mt-1">Results come from ASI ESP and PromoStandards simultaneously</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
