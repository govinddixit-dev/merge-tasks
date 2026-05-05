import React, { useState, useEffect, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { VariantProductCard } from "@/components/products/VariantProductCard";
import {
  Search, Bot, Plus, Filter, Check, Sparkles,
  FolderOpen, Upload, Printer, Package, ChevronRight, FileText,
  Grid, List, Tag, Layers, Download
} from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import CurationImportModal from "@/components/curation/CurationImportModal";
import ExternalProductSearchModal from "@/components/products/ExternalProductSearchModal";
import CurationChatPanel from "@/components/curation/CurationChatPanel";
import CurationMockupModal from "@/components/curation/CurationMockupModal";
import CurationProductsTab from "@/components/curation/CurationProductsTab";
import CurationPrintTab from "@/components/curation/CurationPrintTab";
import CurationCollectionsTab from "@/components/curation/CurationCollectionsTab";
import { CardGridSkeleton } from "@/components/motion";

type CurationTab = "products" | "collections" | "print";

const curatedProducts: { name: string; supplier: string; price: string; category: string; rating: number; inStock: boolean; type: "promo"; image: string }[] = [];

const printProducts: { name: string; supplier: string; price: string; category: string; rating: number; inStock: boolean; type: "print"; format: string; specs: string }[] = [];

// Collections are now fully DB-driven via trpc.collections.list

interface ChatMessage { role: "user" | "assistant"; text: string; }

const initialMessages: ChatMessage[] = [
  { role: "assistant", text: "I'm your MergeTasks Copilot. I can help you find products, generate mockups, and build proposals. What are you working on?" },
];

export default function Curation() {
  //  tRPC hooks for real data
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const { data: _dbProductsRaw, isLoading: productsLoading } = trpc.products.list.useQuery();
  const dbProducts = _dbProductsRaw?.items ?? [];
  // Phase 8 — variant-grouped feed for the promo card grid. Bumped to 200
  // so the in-memory search/filter stays snappy without paginating round
  // trips. The flat list above is still consumed by the print branch and
  // by the legacy in-memory promoFiltered pipeline.
  const { data: _dbGroupedRaw } = trpc.products.listGrouped.useQuery({ limit: 200 });
  const dbGroups = _dbGroupedRaw?.items ?? [];
  const { data: dbApiConnections = [] } = trpc.apiConnections.list.useQuery();
  const { data: dbCollections = [] } = trpc.collections.list.useQuery();

  const createProduct = trpc.products.create.useMutation({
    onSuccess: () => { utils.products.list.invalidate(); },
  });
  const bulkCreateProducts = trpc.products.bulkCreate.useMutation({
    onSuccess: () => { utils.products.list.invalidate(); },
  });
  const deleteProduct = trpc.products.delete.useMutation({
    onSuccess: () => { utils.products.list.invalidate(); },
    onError: (err) => { toast.error("Failed to delete: " + err.message); },
  });
  const createApiConnection = trpc.apiConnections.create.useMutation({
    onSuccess: () => { utils.apiConnections.list.invalidate(); },
  });
  const testApiConnection = trpc.apiConnections.testConnection.useMutation({
    onSuccess: () => { utils.apiConnections.list.invalidate(); },
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const [showMockup, setShowMockup] = useState(false);
  const [mockupStep, setMockupStep] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [isTyping, setIsTyping] = useState(false);
  const [addedProducts, setAddedProducts] = useState<Set<string>>(new Set());
  const searchString = useSearch();

  // Read tab from URL query parameter
  const getTabFromSearch = (s: string): CurationTab => {
    const params = new URLSearchParams(s);
    const tab = params.get('tab');
    if (tab === 'print') return 'print';
    if (tab === 'promo') return 'products';
    return 'products';
  };
  const [activeTab, setActiveTab] = useState<CurationTab>(() => getTabFromSearch(searchString));
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Sync tab with URL search params from wouter
  useEffect(() => {
    setActiveTab(getTabFromSearch(searchString));
  }, [searchString]);

  const [dragOver, setDragOver] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [searchScope, setSearchScope] = useState<"all" | "promo" | "print">("all");

  //  Import Modal State 
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<"choose" | "supplier" | "csv" | "manual" | "custom-api">("choose");
  const [showExternalSearch, setShowExternalSearch] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [supplierPhase, setSupplierPhase] = useState<"select" | "categories" | "syncing" | "preview" | "conflicts" | "done">("select");
  const [importStep, setImportStep] = useState(0);
  const [importRunning, setImportRunning] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [csvFile, setCsvFile] = useState<string | null>(null);
  const [csvRawContent, setCsvRawContent] = useState<string>("");
  const [csvPreviewData, setCsvPreviewData] = useState<Record<string, unknown>[]>([]);
  const [csvTotalRows, setCsvTotalRows] = useState(0);
  const csvInputRef = React.useRef<HTMLInputElement>(null);
  const [csvPhase, setCsvPhase] = useState<"upload" | "mapping" | "validating" | "preview" | "done">("upload");
  const [csvMappings, setCsvMappings] = useState<Record<string, string>>({ col_a: "product_name", col_b: "sku", col_c: "price", col_d: "category", col_e: "description", col_f: "image_url" });

  // Manual entry state
  const [manualProduct, setManualProduct] = useState({ name: "", sku: "", category: "Apparel", description: "", price: "", colors: "", sizes: "", weight: "", material: "" });
  const [manualPriceTiers, setManualPriceTiers] = useState([{ min: "1", max: "49", price: "" }, { min: "50", max: "99", price: "" }, { min: "100", max: "499", price: "" }, { min: "500", max: "+", price: "" }]);
  const [manualImages, setManualImages] = useState<string[]>([]);
  const [manualPhase, setManualPhase] = useState<"form" | "pricing" | "review" | "done">("form");
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const uploadProductImage = trpc.products.uploadImage.useMutation();

  // Custom API state
  const [apiPhase, setApiPhase] = useState<"info" | "auth" | "test" | "mapping" | "sync" | "done">("info");
  const [apiConfig, setApiConfig] = useState({ name: "", baseUrl: "", docUrl: "", format: "REST", authType: "api_key" as string, apiKey: "", headerName: "X-API-Key", clientId: "", clientSecret: "", tokenUrl: "" });
  const [apiTestStatus, setApiTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [apiFieldMappings, setApiFieldMappings] = useState<Record<string, string>>({ product_name: "name", sku: "item_number", price: "unit_price", category: "product_type", description: "long_description", image_url: "primary_image", stock: "quantity_available", color: "available_colors", size: "available_sizes" });
  const [apiSyncProgress, setApiSyncProgress] = useState(0);

  const suppliers = [
    { id: "sanmar", name: "SanMar", products: "450K+", categories: ["Apparel", "Bags", "Headwear", "Outerwear", "Activewear"], status: "not_connected", color: "#2563EB" },
    { id: "ss-activewear", name: "S&S Activewear", products: "380K+", categories: ["Apparel", "Activewear", "Fleece", "Polos", "T-Shirts"], status: "not_connected", color: "#16A34A" },
    { id: "pcna", name: "PCNA", products: "25K+", categories: ["Tech", "Office", "Drinkware", "Bags", "Writing"], status: "not_connected", color: 'var(--mt-brand)' },
    { id: "alphabroder", name: "alphabroder", products: "320K+", categories: ["Apparel", "Bags", "Accessories", "Headwear", "Workwear"], status: "not_connected", color: "#D97706" },
    { id: "hit-promo", name: "Hit Promotional", products: "60K+", categories: ["Promo", "Drinkware", "Tech"], status: "not_connected", color: "#737373" },
    { id: "gemline", name: "Gemline", products: "15K+", categories: ["Bags", "Drinkware", "Tech"], status: "not_connected", color: "#737373" },
  ];

  const supplierCategoryMap: Record<string, string[]> = {
    sanmar: ["T-Shirts", "Polos", "Outerwear", "Fleece", "Activewear", "Bags", "Headwear", "Woven Shirts", "Sweatshirts", "Workwear"],
    "ss-activewear": ["T-Shirts", "Polos", "Fleece", "Activewear", "Performance", "Tank Tops", "Sweatshirts", "Youth"],
    pcna: ["Drinkware", "Tech Accessories", "Writing Instruments", "Bags & Totes", "Desk & Office", "Outdoor & Leisure", "Health & Wellness"],
    alphabroder: ["T-Shirts", "Polos", "Outerwear", "Fleece", "Headwear", "Bags", "Accessories", "Workwear", "Aprons"],
  };

  const importedProductPreview = [
    { name: "Nike Dri-FIT Micro Pique Polo", sku: "NKDC1963", price: "$42.00", cat: "Polos", img: "https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/WpSpRwYeLdFf_3178866e.jpg" },
    { name: "Port Authority Packable Puffy Vest", sku: "J851", price: "$38.98", cat: "Outerwear", img: "https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/aom36Q0BuKjj_39a44ccf.jpg" },
    { name: "Bella+Canvas Unisex Jersey Tee", sku: "BC3001", price: "$6.58", cat: "T-Shirts", img: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=100&h=100&fit=crop" },
    { name: "OGIO Catalyst Backpack", sku: "91008", price: "$65.00", cat: "Bags", img: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=100&h=100&fit=crop" },
    { name: "New Era Structured Stretch Cap", sku: "NE1000", price: "$22.98", cat: "Headwear", img: "https://images.unsplash.com/photo-1556306535-0f09a537f0a3?w=100&h=100&fit=crop" },
    { name: "Sport-Tek PosiCharge Tee", sku: "ST350", price: "$8.98", cat: "Activewear", img: "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=100&h=100&fit=crop" },
  ];

  const conflictProducts = [
    { name: "Nike Dri-FIT Polo", existing: "$42.00 · SanMar", incoming: "$41.50 · alphabroder", sku: "NKDC1963" },
    { name: "Yeti Rambler 26oz", existing: "$34.99 · SanMar", incoming: "$33.99 · PCNA", sku: "YRAM26" },
  ];
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, "keep" | "replace" | "both">>({});

  const handleSelectSupplier = (supplierId: string) => {
    setSelectedSupplier(supplierId);
    setSupplierPhase("categories");
    setSelectedCategories(new Set());
  };

  const handleStartSync = () => {
    setSupplierPhase("syncing");
    setImportRunning(true);
    setImportStep(0);
    const interval = setInterval(() => {
      setImportStep(prev => {
        if (prev >= 4) { clearInterval(interval); setImportRunning(false); setSupplierPhase("preview"); return prev; }
        return prev + 1;
      });
    }, 1200);
  };

  // Step 14: Real CSV upload via file picker (replaces mock)
  const handleCsvUpload = () => {
    // Trigger hidden file input
    csvInputRef.current?.click();
  };

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".xlsx")) {
      toast.error("Please upload a .csv or .xlsx file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setCsvFile(file.name);
      setCsvRawContent(text);
      setCsvPhase("mapping");
    };
    reader.onerror = () => toast.error("Failed to read file");
    reader.readAsText(file);
    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  // Step 14: Real CSV validation via Papa Parse (replaces setTimeout mock)
  const handleCsvValidate = () => {
    setCsvPhase("validating");
    try {
      const results = Papa.parse(csvRawContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
      });
      if (results.errors.length > 0) {
        const errorMsgs = results.errors
          .slice(0, 5)
          .map((e) => `Row ${e.row}: ${e.message}`)
          .join("\n");
        toast.error(`CSV has ${results.errors.length} error(s):\n${errorMsgs}`);
        setCsvPhase("mapping"); // Go back to mapping so user can re-upload
        return;
      }
      // Validate required columns
      const required = ["sku", "name", "price"];
      const headers = (results.meta.fields || []).map((h) => h.toLowerCase().trim());
      const missing = required.filter((r) => !headers.includes(r));
      if (missing.length > 0) {
        toast.error(`Missing required columns: ${missing.join(", ")}`);
        setCsvPhase("mapping");
        return;
      }
      setCsvPreviewData((results.data as Record<string, unknown>[]).slice(0, 10));
      setCsvTotalRows(results.data.length);
      setCsvPhase("preview");
      toast.success(`Validated ${results.data.length} rows`);
    } catch (err: unknown) {
      toast.error("Failed to parse CSV: " + (err instanceof Error ? err.message : String(err)));
      setCsvPhase("mapping");
    }
  };

  const resetImport = () => {
    setShowImport(false);
    setImportMode("choose");
    setSelectedSupplier(null);
    setSupplierPhase("select");
    setImportStep(0);
    setImportRunning(false);
    setSelectedCategories(new Set());
    setCsvFile(null);
    setCsvPhase("upload");
    setConflictResolutions({});
    setManualProduct({ name: "", sku: "", category: "Apparel", description: "", price: "", colors: "", sizes: "", weight: "", material: "" });
    setManualPriceTiers([{ min: "1", max: "49", price: "" }, { min: "50", max: "99", price: "" }, { min: "100", max: "499", price: "" }, { min: "500", max: "+", price: "" }]);
    setManualImages([]);
    setManualPhase("form");
    setApiPhase("info");
    setApiConfig({ name: "", baseUrl: "", docUrl: "", format: "REST", authType: "api_key", apiKey: "", headerName: "X-API-Key", clientId: "", clientSecret: "", tokenUrl: "" });
    setApiTestStatus("idle");
    setApiSyncProgress(0);
  };

  // Merge DB products with static catalog for display
  const dbPromoProducts = useMemo(() => dbProducts
    .filter(p => p.type === "promotional")
    .map(p => ({
      name: p.name,
      supplier: p.supplier || "Custom",
      price: p.basePrice ? `$${p.basePrice}` : "$0.00",
      category: (p.category || "other").charAt(0).toUpperCase() + (p.category || "other").slice(1),
      rating: 0,
      inStock: p.status === "active",
      type: "promo" as const,
      image: p.imageUrl || "",
      dbId: p.id,
      source: p.source || "manual",
      hasLiveInventory: p.hasLiveInventory || false,
    })), [dbProducts]);

  const dbPrintProducts = useMemo(() => dbProducts
    .filter(p => p.type === "print")
    .map(p => ({
      name: p.name,
      supplier: p.supplier || "Custom",
      price: p.basePrice ? `$${p.basePrice}` : "$0.00",
      category: "Print",
      rating: 0,
      inStock: p.status === "active",
      type: "print" as const,
      format: "PDF",
      specs: p.description || "",
      dbId: p.id,
    })), [dbProducts]);

  // Unified search across promo + print (static + DB)
  const allPromo = [...curatedProducts.map(p => ({ ...p, dbId: undefined as number | undefined })), ...dbPromoProducts];
  const allPrint = [...printProducts.map(p => ({ ...p, image: "", rating: p.rating, dbId: undefined as number | undefined })), ...dbPrintProducts];
  const allProducts = [...allPromo, ...allPrint];
  const filteredProducts = allProducts.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.supplier.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    const matchesScope = searchScope === "all" || (p.type === "promo" && searchScope === "promo") || (p.type === "print" && searchScope === "print");
    return matchesSearch && matchesCategory && matchesScope;
  });

  const promoFiltered = filteredProducts.filter(p => p.type === "promo");
  const printFiltered = filteredProducts.filter(p => p.type === "print");

  // Phase 8 — filtered grouped view for the promo grid. Mirrors the
  // search/category pipeline above but operates on group primaries.
  const groupedPromoFiltered = useMemo(() => dbGroups
    .filter(g => g.primary.type === "promotional")
    .filter(g => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q ||
        g.primary.name.toLowerCase().includes(q) ||
        (g.primary.sku ?? "").toLowerCase().includes(q) ||
        (g.primary.supplier ?? "").toLowerCase().includes(q);
      const cat = (g.primary.category || "other").charAt(0).toUpperCase() + (g.primary.category || "other").slice(1);
      const matchesCategory = selectedCategory === "All" || cat === selectedCategory;
      const matchesScope = searchScope === "all" || searchScope === "promo";
      return matchesSearch && matchesCategory && matchesScope;
    }),
    [dbGroups, searchQuery, selectedCategory, searchScope]);

  // Step 15: Replace keyword-matching mock with real copilot dispatch.
  // The sendChat function now delegates to the GlobalAIAssistant via
  // a custom event. If the copilot is not available, it falls back to
  // a tRPC call to the copilot router.
  const copilotMutation = trpc.copilot.chat.useMutation();

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setChatInput("");
    setIsTyping(true);

    try {
      // Try dispatching to the global copilot first
      const copilotOpened = window.dispatchEvent(
        new CustomEvent("open-copilot", {
          detail: {
            context: "product-curation",
            message: userMsg,
          },
        })
      );

      // Also call the copilot tRPC endpoint for a real response
      const response = await copilotMutation.mutateAsync({
        message: userMsg,
        context: { page: "product-curation" },
      });

      setIsTyping(false);
      setMessages(prev => [...prev, {
        role: "assistant",
        text: response.reply || "I can help with that! Let me look into it.",
      }]);

      // If the response suggests opening mockup engine, do it
      if (response.actions?.some((a: { type: string }) => a.type === "open-mockup")) {
        setShowChat(false);
        setShowMockup(true);
        setMockupStep(0);
        let step = 0;
        const interval = setInterval(() => {
          step++;
          if (step > 3) clearInterval(interval);
          else setMockupStep(step);
        }, 1000);
      }
    } catch {
      setIsTyping(false);
      // Graceful fallback if copilot endpoint is unavailable
      setMessages(prev => [...prev, {
        role: "assistant",
        text: "I'm having trouble connecting to the AI service. Please try again in a moment, or use the search bar to find products directly.",
      }]);
    }
  };

  const handleAddProduct = (key: string, productName: string) => {
    setAddedProducts(prev => new Set(prev).add(key));
    toast.success(`${productName} added to proposal draft`);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).map(f => f.name);
    setUploadedFiles(prev => [...prev, ...files]);
    toast.success(`${files.length} file(s) uploaded for print processing`);
  };

  const categories = activeTab === "print"
    ? ["All", "Print"]
    : activeTab === "products"
    ? ["All", "Apparel", "Drinkware", "Tech", "Office"]
    : ["All"];

  return (
    <DashboardLayout title="Product Curation" subtitle="Search, curate, and generate mockups across suppliers">
      {/* Hidden file input for CSV upload (Step 14) */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={handleCsvFileChange}
      />
      {/* Unified Search Bar */}
      {/* Action Buttons - visible on mobile above search */}
      <div className="flex sm:hidden flex-wrap items-center gap-2 mb-3">
        <button className="sq-action-btn flex-1 flex items-center justify-center gap-2" onClick={() => { setImportMode("choose"); setShowImport(true); }}>
          <Download size={14} /> Import Products
        </button>
        <button className="sq-action-btn primary flex-1 flex items-center justify-center gap-2" onClick={() => setShowChat(true)}>
          <Bot size={14} /> AI Copilot
        </button>
      </div>

      {/* Search Bar + Desktop Buttons */}
      <div className="flex flex-col sm:flex-row items-center gap-3 mb-5">
        <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-white rounded-lg border border-mt-border focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
          <Search size={15} className="text-mt-ink-4" />
          <input
            className="flex-1 text-[13px] outline-none bg-transparent text-mt-ink placeholder-[#A3A3A3]"
            placeholder="Search across all products, suppliers, and print items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {/* Scope Toggle */}
          <div className="hidden sm:flex items-center gap-1 pl-3" style={{ borderLeft: '1px solid #E5E5E5' }}>
            {(["all", "promo", "print"] as const).map((scope) => (
              <button
                key={scope}
                className={`text-[10px] font-semibold px-2 py-1 rounded transition-all ${
                  searchScope === scope ? "bg-primary text-white" : "text-mt-ink-4 hover:text-mt-ink-2"
                }`}
                onClick={() => setSearchScope(scope)}
              >
                {scope === "all" ? "All" : scope === "promo" ? "Promo" : "Print"}
              </button>
            ))}
          </div>
        </div>
        <button data-catalog-trigger className="sq-action-btn hidden sm:flex items-center gap-2" onClick={() => setShowExternalSearch(true)}>
          <Search size={14} /> Live Catalog
        </button>
        <button data-import-trigger className="sq-action-btn hidden sm:flex items-center gap-2" onClick={() => { setImportMode("choose"); setShowImport(true); }}>
          <Download size={14} /> Import Products
        </button>
        <button data-copilot-trigger className="sq-action-btn primary hidden sm:flex items-center gap-2" onClick={() => setShowChat(true)}>
          <Bot size={14} /> AI Copilot
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex gap-1 bg-mt-surface-2 p-1 rounded-lg">
          {([
            // Phase 8 — show grouped count (unique products), not row count.
            { id: "products" as CurationTab, label: "Promotional Items", icon: Package, count: groupedPromoFiltered.length },
            { id: "collections" as CurationTab, label: "Collections", icon: FolderOpen, count: dbCollections.length },
            { id: "print" as CurationTab, label: "Print Items", icon: Printer, count: allPrint.length },
          ]).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSelectedCategory("All"); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-[12px] font-semibold transition-all ${
                  activeTab === tab.id ? 'bg-white text-mt-ink shadow-sm' : 'text-mt-ink-3 hover:text-mt-ink-2'
                }`}
              >
                <Icon size={13} />
                {tab.label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  activeTab === tab.id ? 'bg-primary/10 text-primary' : 'bg-[#E5E5E5] text-mt-ink-4'
                }`}>{tab.count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 rounded-md transition-colors ${viewMode === "grid" ? "bg-primary/10 text-primary" : "text-mt-ink-4 hover:text-mt-ink-2"}`}
          >
            <Grid size={14} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 rounded-md transition-colors ${viewMode === "list" ? "bg-primary/10 text-primary" : "text-mt-ink-4 hover:text-mt-ink-2"}`}
          >
            <List size={14} />
          </button>
        </div>
      </div>

      {/* Category Filters (for products & print tabs) */}
      {activeTab !== "collections" && (
        <div className="flex items-center gap-2 mb-5">
          <Filter size={13} className="text-mt-ink-4" />
          {categories.map((cat) => (
            <button
              key={cat}
              className={`text-[12px] font-medium px-3.5 py-1.5 rounded-md transition-all duration-150 ${
                selectedCategory === cat ? "bg-primary text-white" : "bg-white text-mt-ink-3 border border-mt-border hover:bg-mt-surface"
              }`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
          {searchQuery && (
            <span className="text-[11px] text-mt-ink-4 ml-2">
              {filteredProducts.length} results for "{searchQuery}"
            </span>
          )}
        </div>
      )}

      {/* TAB: Promo Products — Phase 8 grouped grid in "grid" mode, legacy
          flat table in "list" mode for power-users editing individual SKUs. */}
      {activeTab === "products" && (
        productsLoading ? (
          <CardGridSkeleton count={6} columns={4} />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {groupedPromoFiltered.map(g => (
              <VariantProductCard
                key={g.styleGroup}
                styleGroup={g.styleGroup}
                primary={{
                  name: g.primary.name,
                  sku: g.primary.sku,
                  imageUrl: g.primary.imageUrl,
                  category: g.primary.category,
                  basePrice: g.primary.basePrice,
                }}
                variants={g.variants}
                variantCount={g.variantCount}
                onSelect={() => setLocation(`/curation/product/${g.primary.id}`)}
                cta={
                  <button
                    onClick={() => handleAddProduct(g.styleGroup, g.primary.name)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                      addedProducts.has(g.styleGroup)
                        ? "bg-mt-surface-2 text-mt-ink-3"
                        : "bg-primary text-white hover:bg-[#4F3BC7]"
                    }`}
                  >
                    {addedProducts.has(g.styleGroup) ? "Added" : "+ Add"}
                  </button>
                }
              />
            ))}
            {groupedPromoFiltered.length === 0 && (
              <div className="col-span-full py-16 text-center text-[13px] text-mt-ink-4">
                No products match your filters.
              </div>
            )}
          </div>
        ) : (
          <CurationProductsTab
            promoFiltered={promoFiltered}
            viewMode={viewMode}
            addedProducts={addedProducts}
            onAddProduct={handleAddProduct}
            onDeleteProduct={(id, name) => {
              deleteProduct.mutate({ id });
              toast.success(`"${name}" deleted`);
            }}
            clientId={null}
          />
        )
      )}
      {/* TAB: Collections (Subfolders) */}
      {activeTab === "collections" && <CurationCollectionsTab />}
      {/* TAB: Print Products */}
      {activeTab === "print" && (
        productsLoading ? (
          <CardGridSkeleton count={6} columns={4} />
        ) : (
        <CurationPrintTab
          printFiltered={printFiltered}
          viewMode={viewMode}
          addedProducts={addedProducts}
          dragOver={dragOver}
          uploadedFiles={uploadedFiles}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleFileDrop}
          onBrowseFiles={() => {
            setUploadedFiles(prev => [...prev, "client_logo_v3.ai", "brochure_final.pdf"]);
            toast.success("2 files uploaded for print processing");
          }}
          onRemoveFile={(i) => setUploadedFiles(prev => prev.filter((_, j) => j !== i))}
          onAddProduct={handleAddProduct}
          onDeleteProduct={(id, name) => {
            deleteProduct.mutate({ id });
            toast.success(`"${name}" deleted`);
          }}
        />
        )
      )}
      {showChat && (
        <CurationChatPanel
          messages={messages}
          chatInput={chatInput}
          isTyping={isTyping}
          onClose={() => setShowChat(false)}
          onInputChange={(v) => setChatInput(v)}
          onSend={sendChat}
        />
      )}
      {/* AI Mockup Modal */}
      {showMockup && (
        <CurationMockupModal
          mockupStep={mockupStep}
          onClose={() => setShowMockup(false)}
        />
      )}
      <CurationImportModal
        showImport={showImport}
        importMode={importMode}
        setImportMode={setImportMode}
        selectedSupplier={selectedSupplier}
        supplierPhase={supplierPhase}
        setSupplierPhase={setSupplierPhase}
        importStep={importStep}
        importRunning={importRunning}
        selectedCategories={selectedCategories}
        setSelectedCategories={setSelectedCategories}
        csvFile={csvFile}
        setCsvFile={setCsvFile}
        csvPhase={csvPhase}
        setCsvPhase={setCsvPhase}
        manualProduct={manualProduct}
        setManualProduct={setManualProduct}
        manualPriceTiers={manualPriceTiers}
        setManualPriceTiers={setManualPriceTiers}
        manualImages={manualImages}
        setManualImages={setManualImages}
        manualPhase={manualPhase}
        setManualPhase={setManualPhase}
        imageUploading={imageUploading}
        setImageUploading={setImageUploading}
        imageInputRef={imageInputRef}
        apiPhase={apiPhase}
        setApiPhase={setApiPhase}
        apiConfig={apiConfig}
        setApiConfig={setApiConfig}
        apiTestStatus={apiTestStatus}
        setApiTestStatus={setApiTestStatus}
        apiFieldMappings={apiFieldMappings}
        setApiFieldMappings={setApiFieldMappings}
        apiSyncProgress={apiSyncProgress}
        setApiSyncProgress={setApiSyncProgress}
        conflictProducts={conflictProducts}
        conflictResolutions={conflictResolutions}
        setConflictResolutions={setConflictResolutions}
        suppliers={suppliers}
        supplierCategoryMap={supplierCategoryMap}
        importedProductPreview={importedProductPreview}
        onSelectSupplier={handleSelectSupplier}
        onStartSync={handleStartSync}
        onCsvUpload={handleCsvUpload}
        onCsvValidate={handleCsvValidate}
        onReset={resetImport}
        createProduct={createProduct}
        bulkCreateProducts={bulkCreateProducts}
        createApiConnection={createApiConnection}
        uploadProductImage={uploadProductImage}
      />
      {showExternalSearch && (
        <ExternalProductSearchModal
          open={showExternalSearch}
          onClose={() => setShowExternalSearch(false)}
        />
      )}
    </DashboardLayout>
  );
}
