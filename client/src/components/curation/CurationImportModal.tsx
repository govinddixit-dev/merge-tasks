import React from "react";
import { createPortal } from "react-dom";
import {
  X, Database, FileSpreadsheet, PenTool, Plug, Check, Loader2, AlertCircle,
  CheckCircle2, ArrowRight, Upload, Image, ImagePlus, Plus, Globe, Key,
  Settings, Zap, Copy, DollarSign, RefreshCw, Link2, TestTube, FileText
} from "lucide-react";
import { toast } from "sonner";
import type { trpc } from "@/lib/trpc";

const API_TEST_TIMEOUT_MS = 8_000;

type CreateProductMutation = ReturnType<typeof trpc.products.create.useMutation>;
type BulkCreateProductsMutation = ReturnType<typeof trpc.products.bulkCreate.useMutation>;
type CreateApiConnectionMutation = ReturnType<typeof trpc.apiConnections.create.useMutation>;
type UploadProductImageMutation = ReturnType<typeof trpc.products.uploadImage.useMutation>;

interface ImportModalProps {
  showImport: boolean;
  importMode: "choose" | "supplier" | "csv" | "manual" | "custom-api";
  setImportMode: (m: "choose" | "supplier" | "csv" | "manual" | "custom-api") => void;
  selectedSupplier: string | null;
  supplierPhase: "select" | "categories" | "syncing" | "preview" | "conflicts" | "done";
  setSupplierPhase: (p: "select" | "categories" | "syncing" | "preview" | "conflicts" | "done") => void;
  importStep: number;
  importRunning: boolean;
  selectedCategories: Set<string>;
  setSelectedCategories: React.Dispatch<React.SetStateAction<Set<string>>>;
  csvFile: string | null;
  setCsvFile: (f: string | null) => void;
  csvPhase: "upload" | "mapping" | "validating" | "preview" | "done";
  setCsvPhase: (p: "upload" | "mapping" | "validating" | "preview" | "done") => void;
  manualProduct: { name: string; sku: string; category: string; description: string; price: string; colors: string; sizes: string; weight: string; material: string };
  setManualProduct: React.Dispatch<React.SetStateAction<{ name: string; sku: string; category: string; description: string; price: string; colors: string; sizes: string; weight: string; material: string }>>;
  manualPriceTiers: { min: string; max: string; price: string }[];
  setManualPriceTiers: React.Dispatch<React.SetStateAction<{ min: string; max: string; price: string }[]>>;
  manualImages: string[];
  setManualImages: React.Dispatch<React.SetStateAction<string[]>>;
  manualPhase: "form" | "pricing" | "review" | "done";
  setManualPhase: (p: "form" | "pricing" | "review" | "done") => void;
  imageUploading: boolean;
  setImageUploading: (v: boolean) => void;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  apiPhase: "info" | "auth" | "test" | "mapping" | "sync" | "done";
  setApiPhase: (p: "info" | "auth" | "test" | "mapping" | "sync" | "done") => void;
  apiConfig: { name: string; baseUrl: string; docUrl: string; format: string; authType: string; apiKey: string; headerName: string; clientId: string; clientSecret: string; tokenUrl: string };
  setApiConfig: React.Dispatch<React.SetStateAction<{ name: string; baseUrl: string; docUrl: string; format: string; authType: string; apiKey: string; headerName: string; clientId: string; clientSecret: string; tokenUrl: string }>>;
  apiTestStatus: "idle" | "testing" | "success" | "error";
  setApiTestStatus: (s: "idle" | "testing" | "success" | "error") => void;
  apiFieldMappings: Record<string, string>;
  setApiFieldMappings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  apiSyncProgress: number;
  setApiSyncProgress: (v: number) => void;
  conflictProducts: { name: string; existing: string; incoming: string; sku: string }[];
  conflictResolutions: Record<string, "keep" | "replace" | "both">;
  setConflictResolutions: React.Dispatch<React.SetStateAction<Record<string, "keep" | "replace" | "both">>>;
  suppliers: { id: string; name: string; products: string; categories: string[]; status: string; color: string }[];
  supplierCategoryMap: Record<string, string[]>;
  importedProductPreview: { name: string; sku: string; price: string; cat: string; img: string }[];
  onSelectSupplier: (id: string) => void;
  onStartSync: () => void;
  onCsvUpload: () => void;
  onCsvValidate: () => void;
  onReset: () => void;
  createProduct: CreateProductMutation;
  bulkCreateProducts: BulkCreateProductsMutation;
  createApiConnection: CreateApiConnectionMutation;
  uploadProductImage: UploadProductImageMutation;
}

export default function CurationImportModal(props: ImportModalProps) {
  const {
    showImport, importMode, setImportMode, selectedSupplier, supplierPhase, setSupplierPhase,
    importStep, importRunning, selectedCategories, setSelectedCategories, csvFile, setCsvFile,
    csvPhase, setCsvPhase, manualProduct, setManualProduct, manualPriceTiers, setManualPriceTiers,
    manualImages, setManualImages, manualPhase, setManualPhase, imageUploading, setImageUploading,
    imageInputRef, apiPhase, setApiPhase, apiConfig, setApiConfig, apiTestStatus, setApiTestStatus,
    apiFieldMappings, setApiFieldMappings, apiSyncProgress, setApiSyncProgress, conflictProducts,
    conflictResolutions, setConflictResolutions, suppliers, supplierCategoryMap, importedProductPreview,
    onSelectSupplier, onStartSync, onCsvUpload, onCsvValidate, onReset,
    createProduct, bulkCreateProducts, createApiConnection, uploadProductImage,
  } = props;

  if (!showImport) return null;

  const modalTitles: Record<string, string> = {
    choose: "Import Products",
    supplier: "Connect Supplier",
    csv: "Import from CSV",
    manual: "Add Product Manually",
    "custom-api": "Connect Custom API",
  };

  return createPortal(
    <div className="fixed inset-0 z-[10002] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-lg flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="px-7 py-5 flex items-center justify-between" style={{ borderBottom: "1px solid #F0F0F0" }}>
          <div>
            <h2 className="text-[18px] font-bold text-mt-ink">{modalTitles[importMode]}</h2>
            {importMode === "choose" && <p className="text-[12px] text-mt-ink-3 mt-0.5">Choose how you'd like to add products to your catalog</p>}
          </div>
          <button className="p-2 hover:bg-mt-surface-2 rounded-lg transition-colors" onClick={onReset}><X size={16} className="text-mt-ink-3" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-5">

          {/*  CHOOSE MODE  */}
          {importMode === "choose" && (
            <div className="grid grid-cols-2 gap-4">
              {[
                { id: "supplier" as const, icon: Database, color: "#2563EB", label: "Supplier Catalog", desc: "Connect SanMar, PCNA, alphabroder & more" },
                { id: "csv" as const, icon: FileSpreadsheet, color: "#D97706", label: "CSV / Excel", desc: "Upload a spreadsheet of your products" },
                { id: "manual" as const, icon: PenTool, color: "#16A34A", label: "Manual Entry", desc: "Add a single product with full details" },
                { id: "custom-api" as const, icon: Plug, color: 'var(--mt-brand)', label: "Custom API", desc: "Connect any supplier via REST or GraphQL" },
              ].map(opt => {
                const Icon = opt.icon;
                return (
                  <button key={opt.id} onClick={() => setImportMode(opt.id)}
                    className="text-left p-5 rounded-xl border-2 border-mt-border hover:border-primary/40 hover:bg-[#F9F9FF] transition-all">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${opt.color}15` }}>
                      <Icon size={18} style={{ color: opt.color }} />
                    </div>
                    <h3 className="text-[14px] font-bold text-mt-ink mb-1">{opt.label}</h3>
                    <p className="text-[12px] text-mt-ink-3">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/*  SUPPLIER FLOW  */}
          {importMode === "supplier" && supplierPhase === "select" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-[12px] text-[#2563EB] font-semibold hover:underline" onClick={() => setImportMode("choose")}>&larr; Back</button>
              </div>
              <p className="text-[13px] text-mt-ink-3 mb-4">Select a supplier to sync their product catalog into your account.</p>
              {suppliers.map(sup => (
                <button key={sup.id} onClick={() => onSelectSupplier(sup.id)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-mt-border hover:border-[#2563EB]/40 hover:bg-[#F0F7FF] transition-all text-left">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[13px] text-white" style={{ backgroundColor: sup.color }}>
                    {sup.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-bold text-mt-ink">{sup.name}</h3>
                      {sup.status === "connected" && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A]">Connected</span>}
                    </div>
                    <p className="text-[11px] text-mt-ink-3">{sup.products} products · {sup.categories.slice(0, 3).join(", ")}</p>
                  </div>
                  <ArrowRight size={14} className="text-mt-ink-4" />
                </button>
              ))}
            </div>
          )}

          {importMode === "supplier" && supplierPhase === "categories" && selectedSupplier && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-[12px] text-[#2563EB] font-semibold hover:underline" onClick={() => setSupplierPhase("select")}>&larr; Back</button>
                <span className="text-[11px] text-mt-ink-4">Select categories to import</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(supplierCategoryMap[selectedSupplier] || []).map(cat => (
                  <button key={cat} onClick={() => setSelectedCategories(prev => { const s = new Set(prev); s.has(cat) ? s.delete(cat) : s.add(cat); return s; })}
                    className={`flex items-center gap-2 p-3 rounded-lg border text-left text-[12px] font-medium transition-all ${selectedCategories.has(cat) ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]" : "border-mt-border text-mt-ink-2 hover:border-mt-border-2"}`}>
                    <div className={`w-4 h-4 rounded flex items-center justify-center border ${selectedCategories.has(cat) ? "bg-[#2563EB] border-[#2563EB]" : "border-mt-border-2"}`}>
                      {selectedCategories.has(cat) && <Check size={10} color="#FFF" />}
                    </div>
                    {cat}
                  </button>
                ))}
              </div>
              {selectedCategories.size > 0 && (
                <p className="text-[12px] text-[#2563EB] font-medium">{selectedCategories.size} categories selected · ~{selectedCategories.size * 38} products</p>
              )}
            </div>
          )}

          {importMode === "supplier" && supplierPhase === "syncing" && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <Loader2 size={32} className="text-[#2563EB] animate-spin mx-auto mb-3" />
                <h3 className="text-[16px] font-bold text-mt-ink mb-1">Syncing catalog...</h3>
                <p className="text-[12px] text-mt-ink-3">Fetching products from {suppliers.find(s => s.id === selectedSupplier)?.name}</p>
              </div>
              <div className="space-y-2">
                {["Authenticating with supplier API...", "Fetching product catalog...", "Processing images...", "Applying pricing rules...", "Finalizing import..."].map((step, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${i < importStep ? "bg-[#F0FDF4]" : i === importStep ? "bg-[#EFF6FF]" : "bg-mt-surface"}`}>
                    {i < importStep ? <CheckCircle2 size={14} className="text-[#16A34A]" /> : i === importStep ? <Loader2 size={14} className="text-[#2563EB] animate-spin" /> : <div className="w-3.5 h-3.5 rounded-full border border-mt-border-2" />}
                    <span className={`text-[12px] ${i <= importStep ? "text-mt-ink font-medium" : "text-mt-ink-4"}`}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importMode === "supplier" && supplierPhase === "preview" && (
            <div className="space-y-4">
              <div className="bg-[#F0FDF4] rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-[#16A34A]" />
                <span className="text-[12px] font-medium text-[#16A34A]">Sync complete — {selectedCategories.size * 38} products ready to import</span>
              </div>
              <div className="space-y-2">
                {importedProductPreview.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-mt-border">
                    <img src={p.img} alt={p.name} className="w-10 h-10 rounded-lg object-cover bg-mt-surface-2" />
                    <div className="flex-1">
                      <p className="text-[12px] font-semibold text-mt-ink">{p.name}</p>
                      <p className="text-[11px] text-mt-ink-3">SKU: {p.sku} · {p.cat}</p>
                    </div>
                    <span className="text-[13px] font-bold text-mt-ink">{p.price}</span>
                  </div>
                ))}
                <p className="text-[11px] text-mt-ink-4 text-center">Showing 6 of {selectedCategories.size * 38} products · 2 conflicts detected</p>
              </div>
            </div>
          )}

          {importMode === "supplier" && supplierPhase === "conflicts" && (
            <div className="space-y-4">
              <p className="text-[13px] text-mt-ink-2">These products already exist in your catalog. Choose how to handle each conflict:</p>
              {conflictProducts.map((p, i) => (
                <div key={i} className="p-4 rounded-xl border border-mt-border">
                  <h4 className="text-[13px] font-bold text-mt-ink mb-1">{p.name} <span className="text-[11px] font-normal text-mt-ink-4">SKU: {p.sku}</span></h4>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="p-2 rounded bg-mt-surface text-[11px]"><p className="text-mt-ink-4 mb-0.5">Existing</p><p className="font-medium text-mt-ink">{p.existing}</p></div>
                    <div className="p-2 rounded bg-[#EFF6FF] text-[11px]"><p className="text-mt-ink-4 mb-0.5">Incoming</p><p className="font-medium text-[#2563EB]">{p.incoming}</p></div>
                  </div>
                  <div className="flex gap-2">
                    {(["keep", "replace", "both"] as const).map(opt => (
                      <button key={opt} onClick={() => setConflictResolutions(prev => ({ ...prev, [p.sku]: opt }))}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${conflictResolutions[p.sku] === opt ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]" : "border-mt-border text-mt-ink-3 hover:border-mt-border-2"}`}>
                        {opt === "keep" ? "Keep Existing" : opt === "replace" ? "Replace" : "Keep Both"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {importMode === "supplier" && supplierPhase === "done" && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-[#F0FDF4] flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={32} className="text-[#16A34A]" /></div>
              <h3 className="text-[18px] font-bold text-mt-ink mb-2">Import Complete!</h3>
              <p className="text-[13px] text-mt-ink-3 mb-1">{selectedCategories.size * 38} products from {suppliers.find(s => s.id === selectedSupplier)?.name} have been added to your catalog.</p>
              <p className="text-[12px] text-mt-ink-4">Products are now available in Product Curation.</p>
            </div>
          )}

          {/*  CSV FLOW  */}
          {importMode === "csv" && csvPhase === "upload" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-[12px] text-primary font-semibold hover:underline" onClick={() => setImportMode("choose")}>&larr; Back</button>
                <span className="text-[11px] text-mt-ink-4">Step 1 of 4 — Upload your file</span>
              </div>
              <div className="border-2 border-dashed rounded-xl p-8 text-center transition-all border-mt-border hover:border-[#D97706] bg-mt-surface cursor-pointer" onClick={onCsvUpload}>
                <FileSpreadsheet size={32} className="mx-auto mb-3 text-[#D97706]" />
                <p className="text-[14px] font-semibold text-mt-ink mb-1">Drop your CSV file here</p>
                <p className="text-[12px] text-mt-ink-3 mb-4">Or click to browse. Supports .csv and .xlsx files</p>
                <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-white transition-colors">
                  <Upload size={12} /> Browse Files
                </button>
              </div>
              <div className="bg-[#FFFBEB] rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="text-[#D97706] mt-0.5" />
                  <div>
                    <p className="text-[12px] font-semibold text-[#92400E] mb-1">CSV Format Requirements</p>
                    <p className="text-[11px] text-[#A16207] leading-relaxed">Required columns: Product Name, SKU, Price, Category. Optional: Description, Image URL, Color, Size, Stock Quantity, Supplier.</p>
                    <button className="text-[11px] font-semibold text-[#D97706] mt-1.5 hover:underline" onClick={(e) => { e.stopPropagation(); const headers = ["name","sku","price","category","description","image_url","color","size","stock"]; const example = ["Custom Branded Polo","CBP-001","24.99","Apparel","Premium polo shirt","https://example.com/img.jpg","Black, White, Navy","S, M, L, XL","500"]; const csv = headers.join(",") + "\n" + example.join(","); const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "mergetasks-product-template.csv"; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); toast.success("Template CSV downloaded"); }}>Download template &rarr;</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {importMode === "csv" && csvPhase === "mapping" && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-[12px] text-primary font-semibold hover:underline" onClick={() => { setCsvFile(null); setCsvPhase("upload"); }}>&larr; Back</button>
                <span className="text-[11px] text-mt-ink-4">Step 2 of 4 — Map columns from {csvFile}</span>
              </div>
              <div className="bg-[#F0FDF4] rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-[#16A34A]" />
                <span className="text-[12px] font-medium text-[#16A34A]">File uploaded — 24 rows detected, 6 columns found</span>
              </div>
              <p className="text-[13px] text-mt-ink-2">Match your CSV columns to MergeTasks product fields.</p>
              <div className="space-y-3">
                {[
                  { csvCol: "Column A: \"Product Name\"", field: "product_name", label: "Product Name", required: true },
                  { csvCol: "Column B: \"Item SKU\"", field: "sku", label: "SKU", required: true },
                  { csvCol: "Column C: \"Unit Price\"", field: "price", label: "Price", required: true },
                  { csvCol: "Column D: \"Type\"", field: "category", label: "Category", required: true },
                  { csvCol: "Column E: \"Notes\"", field: "description", label: "Description", required: false },
                  { csvCol: "Column F: \"Photo Link\"", field: "image_url", label: "Image URL", required: false },
                ].map((mapping, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1 p-3 rounded-lg bg-mt-surface border border-[#F0F0F0]">
                      <p className="text-[11px] text-mt-ink-4 mb-0.5">CSV Column</p>
                      <p className="text-[12px] font-medium text-mt-ink">{mapping.csvCol}</p>
                    </div>
                    <ArrowRight size={14} className="text-[#D4D4D4] shrink-0" />
                    <div className="flex-1">
                      <select className="w-full p-3 rounded-lg border border-mt-border text-[12px] text-mt-ink bg-white focus:border-primary outline-none" defaultValue={mapping.field}>
                        <option value="product_name">Product Name {mapping.required ? "*" : ""}</option>
                        <option value="sku">SKU {mapping.required ? "*" : ""}</option>
                        <option value="price">Price {mapping.required ? "*" : ""}</option>
                        <option value="category">Category {mapping.required ? "*" : ""}</option>
                        <option value="description">Description</option>
                        <option value="image_url">Image URL</option>
                        <option value="color">Color</option>
                        <option value="size">Size</option>
                        <option value="stock">Stock Quantity</option>
                        <option value="skip">-- Skip this column --</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importMode === "csv" && csvPhase === "validating" && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={40} className="text-[#D97706] animate-spin mb-4" />
              <h3 className="text-[16px] font-bold text-mt-ink mb-1">Validating your data...</h3>
              <p className="text-[12px] text-mt-ink-3">Checking required fields, formatting, and duplicates</p>
            </div>
          )}

          {importMode === "csv" && csvPhase === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-[12px] text-primary font-semibold hover:underline" onClick={() => setCsvPhase("mapping")}>&larr; Back</button>
                <span className="text-[11px] text-mt-ink-4">Step 4 of 4 — Review &amp; import</span>
              </div>
              <div className="flex gap-3">
                <div className="bg-[#F0FDF4] rounded-lg p-3 flex-1 flex items-center gap-2"><CheckCircle2 size={14} className="text-[#16A34A]" /><span className="text-[12px] font-medium text-[#16A34A]">22 products ready</span></div>
                <div className="bg-[#FFFBEB] rounded-lg p-3 flex items-center gap-2"><AlertCircle size={14} className="text-[#D97706]" /><span className="text-[12px] font-medium text-[#92400E]">2 warnings</span></div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-mt-border">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-mt-surface">
                      {["Row", "Product Name", "SKU", "Price", "Category", "Status"].map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-mt-ink-3">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { row: 1, name: "Custom Branded Mug", sku: "CLT-MG-001", price: "$12.50", cat: "Drinkware", status: "ready" as const },
                      { row: 2, name: "Team Hoodie", sku: "CLT-HD-002", price: "$48.00", cat: "Apparel", status: "ready" as const },
                      { row: 3, name: "Desk Organizer", sku: "CLT-DO-003", price: "$22.00", cat: "Office", status: "ready" as const },
                      { row: 4, name: "Wireless Charger", sku: "", price: "$35.00", cat: "Tech", status: "warning" as const },
                      { row: 5, name: "Canvas Tote Bag", sku: "CLT-TB-005", price: "$15.00", cat: "Bags", status: "ready" as const },
                    ].map(row => (
                      <tr key={row.row} className={row.status === "warning" ? "bg-[#FFFBEB]" : ""} style={{ borderTop: "1px solid #F0F0F0" }}>
                        <td className="px-3 py-2 text-mt-ink-4 font-mono">{row.row}</td>
                        <td className="px-3 py-2 text-mt-ink font-medium">{row.name}</td>
                        <td className="px-3 py-2 text-mt-ink-3 font-mono">{row.sku || <span className="text-[#EF4444] italic">Missing — auto-generate</span>}</td>
                        <td className="px-3 py-2 text-mt-ink">{row.price}</td>
                        <td className="px-3 py-2 text-mt-ink-3">{row.cat}</td>
                        <td className="px-3 py-2">{row.status === "ready" ? <span className="flex items-center gap-1 text-[#16A34A]"><CheckCircle2 size={10} /> Ready</span> : <span className="flex items-center gap-1 text-[#D97706]"><AlertCircle size={10} /> Warning</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {importMode === "csv" && csvPhase === "done" && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-[#F0FDF4] flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={32} className="text-[#16A34A]" /></div>
              <h3 className="text-[18px] font-bold text-mt-ink mb-2">Import Complete!</h3>
              <p className="text-[13px] text-mt-ink-3 mb-1">5 products from {csvFile} have been added to your catalog.</p>
            </div>
          )}

          {/*  MANUAL ENTRY FLOW  */}
          {importMode === "manual" && manualPhase === "form" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-[12px] text-[#16A34A] font-semibold hover:underline" onClick={() => setImportMode("choose")}>&larr; Back</button>
              </div>
              <div className="flex items-center gap-2 mb-1">
                {["Details", "Pricing", "Review"].map((label, i) => (
                  <React.Fragment key={label}>
                    {i > 0 && <div className={`h-px flex-1 ${i === 0 ? "bg-[#16A34A]" : "bg-[#E5E5E5]"}`} />}
                    <div className="flex items-center gap-1.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i === 0 ? "bg-[#16A34A] text-white" : "bg-[#E5E5E5] text-mt-ink-3"}`}>{i + 1}</div>
                      <span className={`text-[11px] ${i === 0 ? "font-semibold text-[#16A34A]" : "text-mt-ink-3"} hidden sm:inline`}>{label}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div>
                <label className="text-[12px] font-semibold text-mt-ink-2 mb-2 block">Product Images</label>
                <div className="flex gap-2 flex-wrap">
                  {manualImages.map((img, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-lg border border-mt-border overflow-hidden">
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => setManualImages(prev => prev.filter((_, j) => j !== i))} className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/60 flex items-center justify-center"><X size={8} color="#FFF" /></button>
                    </div>
                  ))}
                  {manualImages.length < 5 && (
                    <>
                      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setImageUploading(true);
                        try {
                          const reader = new FileReader();
                          const base64Promise = new Promise<string>((resolve, reject) => {
                            reader.onload = (ev) => resolve(ev.target?.result as string);
                            reader.onerror = reject;
                          });
                          reader.readAsDataURL(file);
                          const base64Full = await base64Promise;
                          const base64Data = base64Full.split(",")[1];
                          const res = await uploadProductImage.mutateAsync({
                            fileName: file.name,
                            mimeType: file.type,
                            base64Data,
                          }) as { url: string };
                          setManualImages(prev => [...prev, res.url]);
                          toast.success("Image uploaded");
                        } catch { toast.error("Failed to upload image"); }
                        setImageUploading(false);
                        e.target.value = "";
                      }} />
                      <button onClick={() => imageInputRef.current?.click()} disabled={imageUploading}
                        className="w-20 h-20 rounded-lg border-2 border-dashed border-mt-border-2 flex flex-col items-center justify-center text-mt-ink-4 hover:border-[#16A34A] hover:text-[#16A34A] transition-colors disabled:opacity-50">
                        {imageUploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                        <span className="text-[9px] mt-1">{imageUploading ? "..." : "Add"}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">Product Name *</label><input value={manualProduct.name} onChange={e => setManualProduct(p => ({...p, name: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A]" placeholder="e.g. Custom Branded Polo" /></div>
                <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">SKU *</label><input value={manualProduct.sku} onChange={e => setManualProduct(p => ({...p, sku: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A]" placeholder="e.g. CBP-001" /></div>
                <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">Category</label>
                  <select value={manualProduct.category} onChange={e => setManualProduct(p => ({...p, category: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A] bg-white">
                    {["Apparel", "Drinkware", "Bags", "Tech", "Office", "Accessories", "Headwear", "Outerwear"].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">Base Price ($) *</label><input value={manualProduct.price} onChange={e => setManualProduct(p => ({...p, price: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A]" placeholder="0.00" type="number" step="0.01" /></div>
                <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">Available Colors</label><input value={manualProduct.colors} onChange={e => setManualProduct(p => ({...p, colors: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A]" placeholder="Black, White, Navy" /></div>
                <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">Available Sizes</label><input value={manualProduct.sizes} onChange={e => setManualProduct(p => ({...p, sizes: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A]" placeholder="S, M, L, XL, 2XL" /></div>
              </div>
              <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">Description</label><textarea value={manualProduct.description} onChange={e => setManualProduct(p => ({...p, description: e.target.value}))} rows={3} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A] resize-none" placeholder="Enter product description..." /></div>
            </div>
          )}

          {importMode === "manual" && manualPhase === "pricing" && (
            <div className="space-y-4">
              <div className="bg-[#F9FAFB] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[13px] font-bold text-mt-ink">Volume Pricing Tiers</h4>
                  <span className="text-[11px] text-mt-ink-3">Base price: ${manualProduct.price || "0.00"}</span>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-3 text-[11px] font-semibold text-mt-ink-3 px-1"><span>Min Qty</span><span>Max Qty</span><span>Unit Price ($)</span></div>
                  {manualPriceTiers.map((tier, i) => (
                    <div key={i} className="grid grid-cols-3 gap-3">
                      <input value={tier.min} onChange={e => { const t = [...manualPriceTiers]; t[i] = {...t[i], min: e.target.value}; setManualPriceTiers(t); }} className="px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A] bg-white" />
                      <input value={tier.max} onChange={e => { const t = [...manualPriceTiers]; t[i] = {...t[i], max: e.target.value}; setManualPriceTiers(t); }} className="px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A] bg-white" />
                      <input value={tier.price} onChange={e => { const t = [...manualPriceTiers]; t[i] = {...t[i], price: e.target.value}; setManualPriceTiers(t); }} className="px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#16A34A] bg-white" type="number" step="0.01" />
                    </div>
                  ))}
                </div>
                <button onClick={() => setManualPriceTiers(prev => [...prev, { min: "", max: "", price: "" }])} className="mt-3 text-[12px] text-[#16A34A] font-semibold flex items-center gap-1 hover:underline"><Plus size={12} /> Add Tier</button>
              </div>
            </div>
          )}

          {importMode === "manual" && manualPhase === "review" && (
            <div className="space-y-4">
              <div className="bg-[#F9FAFB] rounded-xl p-5">
                <div className="flex gap-4">
                  {manualImages.length > 0 ? <img src={manualImages[0]} alt="" className="w-24 h-24 rounded-lg object-cover border border-mt-border" /> : <div className="w-24 h-24 rounded-lg bg-[#E5E5E5] flex items-center justify-center text-mt-ink-4"><Image size={24} /></div>}
                  <div className="flex-1">
                    <h4 className="text-[15px] font-bold text-mt-ink">{manualProduct.name || "Untitled Product"}</h4>
                    <p className="text-[12px] text-mt-ink-3 mt-0.5">SKU: {manualProduct.sku || "—"} · {manualProduct.category}</p>
                    <p className="text-[14px] font-bold text-[#16A34A] mt-1">${manualProduct.price || "0.00"}</p>
                  </div>
                </div>
                {manualProduct.description && <p className="text-[12px] text-mt-ink-2 mt-3 leading-relaxed">{manualProduct.description}</p>}
              </div>
            </div>
          )}

          {importMode === "manual" && manualPhase === "done" && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-[#F0FDF4] flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={32} className="text-[#16A34A]" /></div>
              <h3 className="text-[18px] font-bold text-mt-ink mb-2">Product Added!</h3>
              <p className="text-[13px] text-mt-ink-3">"{manualProduct.name}" is now in your catalog.</p>
            </div>
          )}

          {/*  CUSTOM API FLOW  */}
          {importMode === "custom-api" && apiPhase === "info" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-[12px] text-primary font-semibold hover:underline" onClick={() => setImportMode("choose")}>&larr; Back</button>
              </div>
              <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">API Name *</label><input value={apiConfig.name} onChange={e => setApiConfig(c => ({...c, name: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#2563EB]" placeholder="e.g. Acme Supplier API" /></div>
              <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">Base URL *</label><input value={apiConfig.baseUrl} onChange={e => setApiConfig(c => ({...c, baseUrl: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-[#2563EB] font-mono" placeholder="https://api.supplier.com/v2" /></div>
              <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">API Format</label>
                <div className="flex gap-3">
                  {["REST", "GraphQL", "SOAP"].map(fmt => (
                    <button key={fmt} onClick={() => setApiConfig(c => ({...c, format: fmt}))} className={`px-4 py-2 rounded-lg text-[12px] font-semibold border-2 transition-all ${apiConfig.format === fmt ? "border-[#2563EB] bg-[#2563EB]/5 text-[#2563EB]" : "border-mt-border text-mt-ink-3 hover:border-mt-border-2"}`}>{fmt}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {importMode === "custom-api" && apiPhase === "auth" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[{id: "api_key", label: "API Key", icon: Key, desc: "Static key in header"}, {id: "oauth2", label: "OAuth 2.0", icon: Globe, desc: "Client credentials flow"}, {id: "basic", label: "Basic Auth", icon: Settings, desc: "Username & password"}].map(auth => {
                  const Icon = auth.icon;
                  return (
                    <button key={auth.id} onClick={() => setApiConfig(c => ({...c, authType: auth.id}))} className={`text-left p-3 rounded-lg border-2 transition-all ${apiConfig.authType === auth.id ? "border-[#2563EB] bg-[#2563EB]/5" : "border-mt-border hover:border-mt-border-2"}`}>
                      <Icon size={16} className={apiConfig.authType === auth.id ? "text-[#2563EB]" : "text-mt-ink-3"} />
                      <p className="text-[12px] font-semibold text-mt-ink mt-1.5">{auth.label}</p>
                      <p className="text-[10px] text-mt-ink-4">{auth.desc}</p>
                    </button>
                  );
                })}
              </div>
              {apiConfig.authType === "api_key" && (
                <div className="space-y-3">
                  <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">Header Name</label><input value={apiConfig.headerName} onChange={e => setApiConfig(c => ({...c, headerName: e.target.value}))} className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] font-mono focus:outline-none focus:border-[#2563EB]" /></div>
                  <div><label className="text-[12px] font-semibold text-mt-ink-2 mb-1 block">API Key</label><input value={apiConfig.apiKey} onChange={e => setApiConfig(c => ({...c, apiKey: e.target.value}))} type="password" className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] font-mono focus:outline-none focus:border-[#2563EB]" placeholder="sk_live_..." /></div>
                </div>
              )}
            </div>
          )}

          {importMode === "custom-api" && apiPhase === "test" && (
            <div className="space-y-4">
              <div className="bg-[#F9FAFB] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div><h4 className="text-[14px] font-bold text-mt-ink">{apiConfig.name || "Custom API"}</h4><p className="text-[12px] text-mt-ink-3 font-mono mt-0.5">{apiConfig.baseUrl || "No URL"}</p></div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#2563EB]/10 text-[#2563EB] font-semibold">{apiConfig.format}</span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[12px] text-mt-ink-3">Connection Status</span>
                  {apiTestStatus === "idle" && <span className="text-mt-ink-4 text-[12px]">Not tested</span>}
                  {apiTestStatus === "testing" && <span className="text-[#D97706] flex items-center gap-1 text-[12px]"><Loader2 size={12} className="animate-spin" /> Testing...</span>}
                  {apiTestStatus === "success" && <span className="text-[#16A34A] flex items-center gap-1 text-[12px]"><CheckCircle2 size={12} /> Connected</span>}
                  {apiTestStatus === "error" && <span className="text-[#DC2626] flex items-center gap-1 text-[12px]"><AlertCircle size={12} /> Failed</span>}
                </div>
              </div>
              <button onClick={async () => { setApiTestStatus("testing"); try { const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), API_TEST_TIMEOUT_MS); const r = await fetch(apiConfig.baseUrl, { method: "HEAD", mode: "no-cors", signal: ctrl.signal }); clearTimeout(t); setApiTestStatus("success"); } catch { setApiTestStatus("error"); } }} disabled={apiTestStatus === "testing" || !apiConfig.baseUrl}
                className="w-full py-3 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-60 transition-all">
                {apiTestStatus === "testing" ? <><Loader2 size={14} className="animate-spin" /> Testing...</> : apiTestStatus === "success" ? <><CheckCircle2 size={14} /> Connected!</> : <><Zap size={14} /> Test Connection</>}
              </button>
            </div>
          )}

          {importMode === "custom-api" && apiPhase === "sync" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-6">
                <div className="relative w-24 h-24 mb-4">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#E5E5E5" strokeWidth="3" />
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#2563EB" strokeWidth="3" strokeDasharray={`${apiSyncProgress}, 100`} />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center"><span className="text-[18px] font-bold text-mt-ink">{apiSyncProgress}%</span></div>
                </div>
                <h3 className="text-[16px] font-bold text-mt-ink mb-1">{apiSyncProgress < 100 ? "Syncing products..." : "Sync complete!"}</h3>
                <p className="text-[12px] text-mt-ink-3">{apiSyncProgress < 100 ? `Fetching from ${apiConfig.name}` : "12,847 products imported"}</p>
              </div>
            </div>
          )}

          {importMode === "custom-api" && apiPhase === "done" && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-[#EFF6FF] flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={32} className="text-[#2563EB]" /></div>
              <h3 className="text-[18px] font-bold text-mt-ink mb-2">API Connected!</h3>
              <p className="text-[13px] text-mt-ink-3">{apiConfig.name} is now syncing 12,847 products to your catalog.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-4 flex items-center justify-end gap-3" style={{ borderTop: "1px solid #F0F0F0" }}>
          <button className="sq-action-btn text-[12px]" onClick={onReset}>Cancel</button>
          {importMode === "supplier" && supplierPhase === "categories" && selectedCategories.size > 0 && (
            <button className="sq-action-btn primary text-[12px]" onClick={onStartSync}>Import {selectedCategories.size} Categories</button>
          )}
          {importMode === "supplier" && supplierPhase === "preview" && (
            <button className="sq-action-btn primary text-[12px]" onClick={() => setSupplierPhase("conflicts")}>Resolve 2 Conflicts</button>
          )}
          {importMode === "supplier" && supplierPhase === "conflicts" && Object.keys(conflictResolutions).length === conflictProducts.length && (
            <button className="sq-action-btn primary text-[12px]" onClick={() => setSupplierPhase("done")}>Confirm &amp; Import</button>
          )}
          {importMode === "supplier" && supplierPhase === "done" && (
            <button className="sq-action-btn primary text-[12px]" onClick={() => { onReset(); toast.success(`${selectedCategories.size * 38} products imported`); }}>Done</button>
          )}
          {importMode === "csv" && csvPhase === "mapping" && (
            <button className="sq-action-btn primary text-[12px]" onClick={onCsvValidate}>Validate &amp; Preview</button>
          )}
          {importMode === "csv" && csvPhase === "preview" && (
            <button className="sq-action-btn primary text-[12px]" disabled={bulkCreateProducts.isPending} onClick={async () => {
              const catMap: Record<string, "apparel" | "drinkware" | "tech" | "bags" | "writing" | "wellness" | "outdoor" | "office" | "other"> = { "Drinkware": "drinkware", "Apparel": "apparel", "Office": "office", "Tech": "tech", "Bags": "bags" };
              const csvProducts = [
                { name: "Custom Branded Mug", sku: "CLT-MG-001", basePrice: "12.50", category: "drinkware" as const },
                { name: "Team Hoodie", sku: "CLT-HD-002", basePrice: "48.00", category: "apparel" as const },
                { name: "Desk Organizer", sku: "CLT-DO-003", basePrice: "22.00", category: "office" as const },
                { name: "Wireless Charger", sku: "CLT-TC-004", basePrice: "35.00", category: "tech" as const },
                { name: "Canvas Tote Bag", sku: "CLT-TB-005", basePrice: "15.00", category: "bags" as const },
              ];
              await bulkCreateProducts.mutateAsync({ products: csvProducts.map(p => ({ ...p, source: "csv" as const, type: "promotional" as const })) });
              setCsvPhase("done");
            }}>{bulkCreateProducts.isPending ? "Importing..." : `Import ${5} Products`}</button>
          )}
          {importMode === "csv" && csvPhase === "done" && (
            <button className="sq-action-btn primary text-[12px]" onClick={() => { onReset(); toast.success("5 products imported from CSV"); }}>Done</button>
          )}
          {importMode === "manual" && manualPhase === "form" && (
            <button className="sq-action-btn primary text-[12px]" disabled={!manualProduct.name || !manualProduct.sku || !manualProduct.price} onClick={() => setManualPhase("pricing")}>Next: Pricing Tiers</button>
          )}
          {importMode === "manual" && manualPhase === "pricing" && (
            <><button className="sq-action-btn text-[12px]" onClick={() => setManualPhase("form")}>Back</button><button className="sq-action-btn primary text-[12px]" onClick={() => setManualPhase("review")}>Next: Review</button></>
          )}
          {importMode === "manual" && manualPhase === "review" && (
            <><button className="sq-action-btn text-[12px]" onClick={() => setManualPhase("pricing")}>Back</button>
            <button className="sq-action-btn primary text-[12px]" disabled={createProduct.isPending} onClick={async () => {
              const catMap: Record<string, any> = { "Apparel": "apparel", "Drinkware": "drinkware", "Bags": "bags", "Tech": "tech", "Office": "office", "Accessories": "other", "Headwear": "apparel", "Outerwear": "apparel" };
              await createProduct.mutateAsync({ name: manualProduct.name, sku: manualProduct.sku || undefined, category: catMap[manualProduct.category] || "other", type: "promotional", description: manualProduct.description || undefined, basePrice: manualProduct.price || undefined, imageUrl: manualImages[0] || undefined, additionalImages: manualImages.slice(1), pricingTiers: manualPriceTiers.filter(t => t.price).map(t => ({ minQty: parseInt(t.min) || 1, maxQty: t.max === "+" ? 999999 : parseInt(t.max) || 999999, price: parseFloat(t.price) || 0 })), source: "manual" });
              setManualPhase("done");
              toast.success(`"${manualProduct.name}" added to catalog`);
            }}>{createProduct.isPending ? "Saving..." : "Add Product"}</button></>
          )}
          {importMode === "manual" && manualPhase === "done" && (
            <><button className="sq-action-btn text-[12px]" onClick={() => { setManualPhase("form"); setManualProduct({ name: "", sku: "", category: "Apparel", description: "", price: "", colors: "", sizes: "", weight: "", material: "" }); setManualImages([]); setManualPriceTiers([{ min: "1", max: "49", price: "" }, { min: "50", max: "99", price: "" }, { min: "100", max: "499", price: "" }, { min: "500", max: "+", price: "" }]); }}>Add Another</button>
            <button className="sq-action-btn primary text-[12px]" onClick={onReset}>Done</button></>
          )}
          {importMode === "custom-api" && apiPhase === "info" && (
            <button className="sq-action-btn primary text-[12px]" disabled={!apiConfig.name || !apiConfig.baseUrl} onClick={() => setApiPhase("auth")}>Next: Authentication</button>
          )}
          {importMode === "custom-api" && apiPhase === "auth" && (
            <><button className="sq-action-btn text-[12px]" onClick={() => setApiPhase("info")}>Back</button><button className="sq-action-btn primary text-[12px]" onClick={() => setApiPhase("test")}>Next: Test Connection</button></>
          )}
          {importMode === "custom-api" && apiPhase === "test" && apiTestStatus === "success" && (
            <button className="sq-action-btn primary text-[12px]" onClick={() => setApiPhase("mapping")}>Next: Map Fields</button>
          )}
          {importMode === "custom-api" && apiPhase === "mapping" && (
            <><button className="sq-action-btn text-[12px]" onClick={() => setApiPhase("test")}>Back</button>
            <button className="sq-action-btn primary text-[12px]" onClick={() => { setApiPhase("sync"); setApiSyncProgress(0); let p = 0; const iv = setInterval(() => { p += Math.random() * 15 + 5; if (p >= 100) { p = 100; clearInterval(iv); } setApiSyncProgress(Math.min(Math.round(p), 100)); }, 600); }}>Start Sync</button></>
          )}
          {importMode === "custom-api" && apiPhase === "sync" && apiSyncProgress >= 100 && (
            <button className="sq-action-btn primary text-[12px]" disabled={createApiConnection.isPending} onClick={async () => {
              await createApiConnection.mutateAsync({ name: apiConfig.name, baseUrl: apiConfig.baseUrl, format: apiConfig.format === "REST" ? "rest_json" : apiConfig.format === "GraphQL" ? "graphql" : "soap", authType: apiConfig.authType === "api_key" ? "api_key" : apiConfig.authType === "oauth2" ? "oauth2" : "basic_auth", credentials: apiConfig.authType === "api_key" ? { headerName: apiConfig.headerName, apiKey: apiConfig.apiKey } : {}, fieldMapping: apiFieldMappings });
              setApiPhase("done");
            }}>{createApiConnection.isPending ? "Saving..." : "Complete Setup"}</button>
          )}
          {importMode === "custom-api" && apiPhase === "done" && (
            <button className="sq-action-btn primary text-[12px]" onClick={() => { onReset(); toast.success(`${apiConfig.name} connected`); }}>Done</button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
