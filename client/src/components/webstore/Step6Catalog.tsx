/**
 * Step 6 — Build Catalog
 *
 * Layout (top to bottom):
 *  1. Draggable, editable category tiles (pre-filled defaults, add/rename/delete)
 *  2. Expanded category detail (click a tile to reveal its products + sub-cats)
 *  3. Long product search bar (name, SKU, supplier)
 *  4. Added products mini-grid (thumbnail, name, SKU, price, × remove)
 *  5. Auto-Classify button — AI sorts added products into categories/sub-cats,
 *     creates new ones if needed
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Search, X, Plus, GripVertical, ChevronDown, ChevronRight,
  Sparkles, Pencil, Check, Tag, Package, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useWebstore } from "./WebstoreContext";
import type { CatalogBlock } from "./WebstoreContext";
import { colorNameToHex } from "@/lib/colorMap";

//  Types 

interface DbProduct {
  id: number;
  name: string;
  sku?: string | null;
  category?: string | null;
  basePrice?: string | null;
  imageUrl?: string | null;
  supplier?: string | null;
  description?: string | null;
  status: string;
}

interface Props {
  dbProducts: DbProduct[];
  filteredCatalogProducts: DbProduct[];
  toggleCategory: (id: string) => void;
  toggleProduct: (id: number) => void;
}

//  Default category tiles 

const DEFAULT_TILES = [
  "Apparel", "Drinkware", "Tech", "Headwear", "Bags",
  "Writing", "Wellness", "Outdoor", "Office",
];

function uid() { return `c_${Math.random().toString(36).slice(2, 9)}`; }

//  Product thumbnail card 

function ProductThumb({
  product, onRemove,
}: { product: DbProduct; onRemove: () => void }) {
  return (
    <div className="relative flex items-center gap-2 bg-white border border-mt-border rounded-xl p-2 group hover:border-[#C4B5FD] transition-colors">
      {/* Image */}
      <div className="w-10 h-10 rounded-lg bg-mt-surface-2 flex-shrink-0 overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package size={16} className="text-[#D4D4D4]" />
          </div>
        )}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-mt-ink truncate leading-tight">{product.name}</p>
        {product.sku && <p className="text-[10px] text-mt-ink-4 truncate">{product.sku}</p>}
        {product.basePrice && (
          <p className="text-[10px] text-primary font-semibold">${parseFloat(product.basePrice).toFixed(2)}</p>
        )}
      </div>
      {/* Remove */}
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
        title="Remove"
      >
        <X size={8} />
      </button>
    </div>
  );
}

//  Main Component 

export default function Step6Catalog({ dbProducts, toggleProduct }: Props) {
  const { state, dispatch, set } = useWebstore();
  const { addedProductIds, catalogBlocks } = state;

  //  Category tiles 
  const [tiles, setTiles] = useState<{ id: string; name: string }[]>(() => {
    if (catalogBlocks.length > 0) {
      return catalogBlocks.map(b => ({ id: b.id, name: b.name }));
    }
    return DEFAULT_TILES.map(name => ({ id: uid(), name }));
  });
  const [editingTileId, setEditingTileId] = useState<string | null>(null);
  const [editingTileName, setEditingTileName] = useState("");
  const [addingTile, setAddingTile] = useState(false);
  const [newTileName, setNewTileName] = useState("");
  const [expandedTileId, setExpandedTileId] = useState<string | null>(null);

  //  Drag state (native HTML5 drag) 
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  //  Product search 
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  //  Auto-classify 
  const [classifying, setClassifying] = useState(false);
  const autoClassifyMut = trpc.stores.autoClassifyCatalog.useMutation();

  // Sync tiles → catalogBlocks when tiles change (preserves sub-categories).
  // catalogBlocks is intentionally excluded from deps — we only want to re-sync
  // when the tile list itself changes (reorder, add, remove), not on every block update.
  // Using a ref snapshot avoids the stale-closure issue without triggering extra renders.
  const catalogBlocksRef = useRef(catalogBlocks);
  useEffect(() => { catalogBlocksRef.current = catalogBlocks; });

  useEffect(() => {
    const newBlocks: CatalogBlock[] = tiles.map(tile => {
      const existing = catalogBlocksRef.current.find(b => b.id === tile.id);
      return existing
        ? { ...existing, name: tile.name }
        : { id: tile.id, name: tile.name, subCategories: [] };
    });
    set("catalogBlocks", newBlocks);
  }, [tiles, set]);  // eslint-disable no longer needed — ref pattern resolves the stale closure  //  Derived data (memoized to avoid re-filtering on every render) 
  const activeProducts = useMemo(
    () => dbProducts.filter(p => p.status === "active"),
    [dbProducts]
  );

  const addedProducts = useMemo(
    () => activeProducts.filter(p => addedProductIds.includes(p.id)),
    [activeProducts, addedProductIds]
  );

  // Phase 8 — variant-grouped feed for the dropdown. Picking a card adds
  // ALL its variant productIds to the store; picking a swatch adds just
  // that color. dbProducts (flat) is still used for the addedProducts
  // mini-grid below since it's already keyed by individual productId.
  const { data: groupedRaw } = trpc.products.listGrouped.useQuery(
    { limit: 200 },
    { staleTime: 60_000 },
  );
  const groupedProducts = groupedRaw?.items ?? [];

  const groupedSearchResults = useMemo(() => {
    if (search.trim().length < 1) return [];
    const q = search.toLowerCase();
    return groupedProducts
      .filter(g =>
        g.primary.name.toLowerCase().includes(q) ||
        (g.primary.sku && g.primary.sku.toLowerCase().includes(q)) ||
        (g.primary.supplier && g.primary.supplier.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [groupedProducts, search]);

  // Tile drag
  const onDragStart = (idx: number) => { dragIdx.current = idx; };
  const onDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); };
  const onDrop = (idx: number) => {
    if (dragIdx.current === null || dragIdx.current === idx) { setDragOverIdx(null); return; }
    const reordered = [...tiles];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(idx, 0, moved);
    setTiles(reordered);
    dragIdx.current = null;
    setDragOverIdx(null);
  };

  // Tile rename
  const startEditTile = (tile: { id: string; name: string }) => {
    setEditingTileId(tile.id);
    setEditingTileName(tile.name);
  };
  const commitEditTile = () => {
    if (editingTileName.trim()) {
      setTiles(prev => prev.map(t => t.id === editingTileId ? { ...t, name: editingTileName.trim() } : t));
    }
    setEditingTileId(null);
  };

  // Tile add
  const commitAddTile = () => {
    if (!newTileName.trim()) { setAddingTile(false); return; }
    const newTile = { id: uid(), name: newTileName.trim() };
    setTiles(prev => [...prev, newTile]);
    setNewTileName("");
    setAddingTile(false);
  };

  // Tile delete
  const deleteTile = (id: string) => {
    setTiles(prev => prev.filter(t => t.id !== id));
    if (expandedTileId === id) setExpandedTileId(null);
    // Remove from catalogBlocks
    set("catalogBlocks", catalogBlocks.filter(b => b.id !== id));
  };

  // Phase 8 — adding a styleGroup adds ALL its variant productIds. Only
  // pushes ids that aren't already in the set (avoids accidental toggle-off).
  const handleAddGroup = (variantIds: number[]) => {
    const next = new Set(addedProductIds);
    variantIds.forEach(id => next.add(id));
    set("addedProductIds", Array.from(next));
    setSearch("");
    setShowDropdown(false);
  };

  // Single-variant pick from the swatch row.
  const handleAddVariant = (variantId: number) => {
    if (!addedProductIds.includes(variantId)) {
      dispatch({ type: "TOGGLE_PRODUCT", productId: variantId });
    }
    setSearch("");
    setShowDropdown(false);
  };

  // Product remove
  const handleRemoveProduct = (productId: number) => {
    dispatch({ type: "TOGGLE_PRODUCT", productId });
    // Remove from all catalogBlocks
    set("catalogBlocks", catalogBlocks.map(b => ({
      ...b,
      subCategories: b.subCategories.map(sc => ({
        ...sc,
        productIds: sc.productIds.filter(id => id !== productId),
      })),
    })));
  };

  // Auto-Classify
  const handleAutoClassify = useCallback(async () => {
    if (addedProducts.length === 0) {
      toast.error("Add at least one product before classifying.");
      return;
    }
    setClassifying(true);
    try {
      const result = await autoClassifyMut.mutateAsync({
        storeId: state.createdStoreId || 0,
        productIds: addedProducts.map(p => p.id),
        clientIndustry: state.industry || undefined,
        existingCategories: tiles.map(t => t.name),
      });

      if (result.categories && result.categories.length > 0) {
        const aiCats = result.categories as Array<{
          id: string; name: string;
          subCategories: Array<{ id: string; name: string; productIds: number[] }>;
        }>;

        // Merge AI result with existing tiles: match by name, add new tiles for new cats
        const newTiles = [...tiles];
        const newBlocks: CatalogBlock[] = [];

        aiCats.forEach(aiCat => {
          const existingTile = newTiles.find(t => t.name.toLowerCase() === aiCat.name.toLowerCase());
          const tileId = existingTile ? existingTile.id : uid();
          if (!existingTile) newTiles.push({ id: tileId, name: aiCat.name });
          newBlocks.push({
            id: tileId,
            name: aiCat.name,
            subCategories: aiCat.subCategories.map(sc => ({
              id: sc.id || uid(),
              name: sc.name,
              productIds: sc.productIds,
            })),
          });
        });

        // Remove empty tiles that AI didn't classify anything into
        // Only keep tiles that have at least one product across their sub-categories
        const filledBlocks = newBlocks.filter(b =>
          b.subCategories.some(sc => sc.productIds.length > 0)
        );
        const filledTiles = newTiles.filter(t => filledBlocks.find(b => b.id === t.id));

        setTiles(filledTiles);
        set("catalogBlocks", filledBlocks);
        set("catalogClassified", true);

        // Update addedProductIds to include all classified products
        const allIds = new Set<number>(addedProductIds);
        filledBlocks.forEach(b => b.subCategories.forEach(s => s.productIds.forEach(id => allIds.add(id))));
        set("addedProductIds", Array.from(allIds));

        const removedCount = newTiles.length - filledTiles.length;
        const removedMsg = removedCount > 0 ? ` (removed ${removedCount} empty ${removedCount === 1 ? "category" : "categories"})` : "";
        toast.success(`Auto-Classified ${addedProducts.length} products into ${filledBlocks.length} categories${removedMsg}`);

        // Auto-expand first non-empty category
        const firstFilled = newBlocks.find(b => b.subCategories.some(s => s.productIds.length > 0));
        if (firstFilled) setExpandedTileId(firstFilled.id);
      } else {
        toast.error("AI couldn't classify products. Try again.");
      }
    } catch (err: unknown) {
      toast.error("Auto-Classify failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setClassifying(false);
    }
  }, [addedProducts, tiles, state, autoClassifyMut, set, addedProductIds]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  //  Expanded tile detail 
  const expandedBlock = catalogBlocks.find(b => b.id === expandedTileId);

  const totalAssigned = catalogBlocks.reduce(
    (acc, b) => acc + b.subCategories.reduce((a, s) => a + s.productIds.length, 0), 0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-mt-ink mb-1">Build Catalog</h2>
        <p className="text-[13px] text-mt-ink-3">
          Arrange categories, add products, then click <strong>Auto-Classify</strong> to let AI sort everything.
        </p>
      </div>

      {/*  1. Category Tiles  */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold text-mt-ink-2 uppercase tracking-widest">
            Categories
            <span className="ml-2 text-mt-ink-4 font-normal normal-case">
              {totalAssigned > 0 && `· ${totalAssigned} products assigned`}
            </span>
          </p>
          <button
            onClick={() => setAddingTile(true)}
            className="flex items-center gap-1 text-[12px] text-primary font-semibold hover:underline"
          >
            <Plus size={13} /> Add Category
          </button>
        </div>

        {/* Tile grid — 6-column card layout */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {tiles.map((tile, idx) => {
            const block = catalogBlocks.find(b => b.id === tile.id);
            const count = block ? block.subCategories.reduce((s, sc) => s + sc.productIds.length, 0) : 0;
            const isExpanded = expandedTileId === tile.id;
            const isDragTarget = dragOverIdx === idx;

            return (
              <div
                key={tile.id}
                draggable={editingTileId !== tile.id}
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDrop={() => onDrop(idx)}
                onDragEnd={() => setDragOverIdx(null)}
                className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 transition-all select-none py-5 px-3 min-h-[90px] ${
                  isExpanded
                    ? "border-primary bg-mt-brand-light text-primary shadow-md"
                    : isDragTarget
                    ? "border-primary bg-[#EDE9FE] scale-105 shadow-md"
                    : "border-mt-border bg-white text-[#374151] hover:border-[#C4B5FD] hover:bg-mt-surface hover:shadow-sm"
                } ${editingTileId !== tile.id ? "cursor-grab active:cursor-grabbing" : ""}`}
                onClick={() => editingTileId !== tile.id && setExpandedTileId(isExpanded ? null : tile.id)}
              >
                {/* Drag handle top-left */}
                <GripVertical size={11} className="absolute top-2 left-2 text-[#D4D4D4]" />

                {/* Edit / Delete — top-right on hover */}
                {editingTileId !== tile.id && (
                  <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button
                      onClick={e => { e.stopPropagation(); startEditTile(tile); }}
                      className="p-1 rounded-lg hover:bg-[#E5E5E5] text-mt-ink-4 hover:text-mt-ink-2"
                      title="Rename"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteTile(tile.id); }}
                      className="p-1 rounded-lg hover:bg-[#FEE2E2] text-mt-ink-4 hover:text-[#EF4444]"
                      title="Delete"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}

                {/* Category icon */}
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-0.5 ${
                  isExpanded ? "bg-[#EDE9FE]" : "bg-mt-surface-2 group-hover:bg-[#EDE9FE]"
                } transition-colors`}>
                  <Tag size={14} className={isExpanded ? "text-primary" : "text-mt-ink-4 group-hover:text-primary"} />
                </div>

                {editingTileId === tile.id ? (
                  <div className="flex flex-col items-center gap-1" onClick={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      value={editingTileName}
                      onChange={e => setEditingTileName(e.target.value)}
                      onBlur={commitEditTile}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitEditTile();
                        if (e.key === "Escape") setEditingTileId(null);
                      }}
                      className="w-20 text-[11px] font-bold text-center bg-transparent border-b border-primary outline-none text-primary"
                    />
                    <button onClick={commitEditTile} className="text-[#16A34A]"><Check size={11} /></button>
                  </div>
                ) : (
                  <>
                    <span className="text-[11px] font-bold text-center leading-tight px-1 truncate w-full text-center">
                      {tile.name}
                    </span>
                    {count > 0 ? (
                      <span className="text-[10px] font-semibold text-primary bg-[#EDE9FE] px-2 py-0.5 rounded-full">
                        {count}
                      </span>
                    ) : (
                      <span className="text-[9px] text-[#C4C4C4]">Empty</span>
                    )}
                  </>
                )}

                {/* Expand indicator */}
                {editingTileId !== tile.id && (
                  <div className="absolute bottom-1.5 right-2">
                    {isExpanded
                      ? <ChevronDown size={10} className="text-primary" />
                      : <ChevronRight size={10} className="text-[#D4D4D4] group-hover:text-[#C4B5FD]" />}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add tile inline */}
          {addingTile && (
            <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-2xl border-2 border-primary bg-mt-brand-light">
              <Tag size={12} className="text-primary" />
              <input
                autoFocus
                value={newTileName}
                onChange={e => setNewTileName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitAddTile();
                  if (e.key === "Escape") { setAddingTile(false); setNewTileName(""); }
                }}
                placeholder="Category name"
                className="w-28 text-[12px] font-semibold bg-transparent outline-none text-primary placeholder:text-[#C4B5FD]"
              />
              <button onClick={commitAddTile} className="text-primary"><Check size={12} /></button>
              <button onClick={() => { setAddingTile(false); setNewTileName(""); }} className="text-mt-ink-4"><X size={12} /></button>
            </div>
          )}
        </div>

        {/*  Expanded category detail  */}
        {expandedTileId && expandedBlock && (
          <div className="mt-4 rounded-2xl border border-mt-border bg-mt-surface overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-mt-border">
              <div className="flex items-center gap-2">
                <Tag size={13} className="text-primary" />
                <span className="text-[13px] font-bold text-mt-ink">{expandedBlock.name}</span>
                <span className="text-[11px] text-mt-ink-4">
                  {expandedBlock.subCategories.reduce((s, sc) => s + sc.productIds.length, 0)} products
                </span>
              </div>
              <button onClick={() => setExpandedTileId(null)} className="text-mt-ink-4 hover:text-mt-ink-2">
                <X size={14} />
              </button>
            </div>

            <div className="p-4">
              {expandedBlock.subCategories.length === 0 ? (
                <p className="text-[12px] text-mt-ink-4 italic text-center py-4">
                  No products classified here yet. Click <strong>Auto-Classify</strong> to sort your products.
                </p>
              ) : (
                <div className="space-y-5">
                  {expandedBlock.subCategories.map(sc => {
                    const scProducts = sc.productIds
                      .map(id => dbProducts.find(p => p.id === id))
                      .filter(Boolean) as DbProduct[];
                    return (
                      <div key={sc.id}>
                        <p className="text-[11px] font-semibold text-mt-ink-2 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                          {sc.name}
                          <span className="text-mt-ink-4 font-normal normal-case">({scProducts.length})</span>
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {scProducts.map(p => (
                            <div key={p.id} className="flex items-center gap-2 bg-white border border-mt-border rounded-xl p-2">
                              <div className="w-8 h-8 rounded-lg bg-mt-surface-2 flex-shrink-0 overflow-hidden">
                                {p.imageUrl ? (
                                  <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Package size={12} className="text-[#D4D4D4]" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-mt-ink truncate">{p.name}</p>
                                {p.sku && <p className="text-[9px] text-mt-ink-4 truncate">{p.sku}</p>}
                                {p.basePrice && (
                                  <p className="text-[9px] text-primary font-semibold">
                                    ${parseFloat(p.basePrice).toFixed(2)}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/*  2. Product Search Bar  */}
      <div>
        <p className="text-[11px] font-semibold text-mt-ink-2 uppercase tracking-widest mb-3">Add Products</p>
        <div className="relative">
          <div className="flex items-center gap-3 w-full px-4 py-3.5 bg-white border-2 border-mt-border rounded-2xl focus-within:border-primary transition-colors shadow-sm">
            <Search size={16} className="text-mt-ink-4 flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search products by name, SKU, or supplier…"
              className="flex-1 text-[13px] bg-transparent outline-none text-mt-ink placeholder:text-[#C4C4C4]"
            />
            {search && (
              <button onClick={() => { setSearch(""); setShowDropdown(false); }} className="text-mt-ink-4 hover:text-mt-ink-2">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Dropdown — variant-grouped tile list */}
          {showDropdown && search.trim().length >= 1 && (
            <div
              ref={dropdownRef}
              className="absolute top-full left-0 right-0 mt-1 bg-white border border-mt-border rounded-2xl shadow-md z-50 max-h-80 overflow-y-auto"
            >
              {groupedSearchResults.length > 0 ? groupedSearchResults.map(g => {
                const variantIds = g.variants.map(v => v.productId);
                const allAdded = variantIds.every(id => addedProductIds.includes(id));
                return (
                  <div
                    key={g.styleGroup}
                    className="border-b border-mt-border last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => handleAddGroup(variantIds)}
                      disabled={allAdded}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-mt-brand-light transition-colors duration-150 text-left first:rounded-t-2xl ${
                        allAdded ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      <div className="w-10 h-10 rounded-md border border-mt-border bg-mt-surface-2 flex-shrink-0 overflow-hidden">
                        {g.primary.imageUrl ? (
                          <img src={g.primary.imageUrl} alt={g.primary.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package size={14} className="text-mt-ink-4" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-mt-ink truncate">{g.primary.name}</p>
                        <p className="text-[11px] text-mt-ink-4">
                          {g.primary.sku && <span className="mr-2 font-mono">{g.primary.sku}</span>}
                          {g.variantCount > 1 && <span>{g.variantCount} colors · </span>}
                          {g.primary.basePrice && <span className="text-primary font-semibold">${parseFloat(g.primary.basePrice).toFixed(2)}</span>}
                        </p>
                      </div>
                      {allAdded ? (
                        <span className="text-[11px] text-[#16A34A] font-semibold flex-shrink-0">All added</span>
                      ) : (
                        <span className="text-[11px] text-primary font-semibold flex-shrink-0 inline-flex items-center gap-1">
                          <Plus size={13} /> Add all
                        </span>
                      )}
                    </button>
                    {g.variantCount > 1 && (
                      <div className="px-4 pb-2.5 pl-[3.75rem] flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider text-mt-ink-4 font-semibold mr-1">
                          Or pick one
                        </span>
                        {g.variants.map(v => {
                          const hex = v.colorHex ?? colorNameToHex(v.colorName);
                          const added = addedProductIds.includes(v.productId);
                          return (
                            <button
                              key={v.productId}
                              type="button"
                              title={`${v.colorName ?? "Variant"}${added ? " (added)" : ""}`}
                              aria-label={v.colorName ?? "Variant"}
                              onClick={() => handleAddVariant(v.productId)}
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
                              className={`h-4 w-4 rounded-full transition-all duration-150 ${
                                added
                                  ? "ring-2 ring-[#16A34A]"
                                  : "ring-1 ring-mt-border hover:ring-2 hover:ring-primary"
                              }`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div className="px-4 py-3 text-[12px] text-mt-ink-4">
                  No products found for "{search}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/*  3. Added Products Mini-Grid  */}
      {addedProducts.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-mt-ink-2 uppercase tracking-widest">
              Added Products
              <span className="ml-2 text-mt-ink-4 font-normal normal-case">({addedProducts.length})</span>
            </p>
            <button
              onClick={handleAutoClassify}
              disabled={classifying}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-[12px] font-bold hover:bg-[#5338E0] active:scale-95 transition-all disabled:opacity-60 shadow-sm"
            >
              {classifying ? (
                <><Loader2 size={13} className="animate-spin" /> Classifying…</>
              ) : (
                <><Sparkles size={13} /> Auto-Classify</>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {addedProducts.map(p => (
              <ProductThumb
                key={p.id}
                product={p}
                onRemove={() => handleRemoveProduct(p.id)}
              />
            ))}
          </div>

          {!state.catalogClassified && (
            <p className="text-[11px] text-mt-ink-4 mt-2 italic">
              Click <strong>Auto-Classify</strong> to automatically sort these into categories and sub-categories.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 rounded-2xl border-2 border-dashed border-mt-border text-center">
          <Package size={32} className="text-[#D4D4D4] mb-3" />
          <p className="text-[13px] font-semibold text-mt-ink-4">No products added yet</p>
          <p className="text-[12px] text-[#C4C4C4] mt-1">Use the search bar above to find and add products</p>
        </div>
      )}
    </div>
  );
}
