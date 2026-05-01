import { useState } from "react";
import { Upload, Printer, FileText, Check, Plus, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type PrintProduct = {
  name: string;
  supplier: string;
  price: string;
  category: string;
  rating: number;
  inStock: boolean;
  type: "print";
  format: string;
  specs: string;
  image?: string;
  dbId?: number;
};

interface CurationPrintTabProps {
  printFiltered: PrintProduct[];
  viewMode: "grid" | "list";
  addedProducts: Set<string>;
  dragOver: boolean;
  uploadedFiles: string[];
  onAddProduct: (key: string, productName: string) => void;
  onDeleteProduct: (id: number, name: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRemoveFile: (index: number) => void;
  onBrowseFiles: () => void;
}

export default function CurationPrintTab({
  printFiltered,
  viewMode,
  addedProducts,
  dragOver,
  uploadedFiles,
  onAddProduct,
  onDeleteProduct,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemoveFile,
  onBrowseFiles,
}: CurationPrintTabProps) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
          dragOver ? "border-primary bg-mt-brand-light" : "border-mt-border bg-mt-surface"
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Upload size={28} className={`mx-auto mb-3 ${dragOver ? "text-primary" : "text-mt-ink-4"}`} />
        <p className="text-[14px] font-semibold text-mt-ink mb-1">Upload Print-Ready Artwork</p>
        <p className="text-[12px] text-mt-ink-3 mb-3">Drag & drop PDF, AI, PSD, or INDD files here</p>
        <button
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-white transition-colors"
          onClick={onBrowseFiles}
        >
          <Upload size={12} /> Browse Files
        </button>
        {uploadedFiles.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {uploadedFiles.map((file, i) => (
              <span key={i} className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-white border border-mt-border text-mt-ink-2">
                <FileText size={10} className="text-primary" />
                {file}
                <button onClick={() => onRemoveFile(i)} className="ml-1 hover:text-[#DC2626]">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Print Product Grid */}
      <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" : "space-y-3"}>
        {printFiltered.map((product, i) => {
          const key = `print-${product.name}`;
          const isAdded = addedProducts.has(key);
          return viewMode === "grid" ? (
            <div key={i} className="bg-white rounded-lg border border-mt-border cursor-pointer card-hover overflow-hidden">
              <div className="w-full h-36 flex items-center justify-center bg-gradient-to-br from-[#F5F3FF] to-[#EEF2FF] p-6">
                <div className="text-center">
                  <Printer size={28} className="mx-auto text-primary mb-2" />
                  <p className="text-[10px] font-semibold text-primary">{product.format}</p>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[10px] text-mt-ink-4 uppercase tracking-wider font-medium">{product.supplier}</p>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#D97706]/10 text-[#D97706]">Print</span>
                </div>
                <h3 className="text-[13px] font-semibold text-mt-ink mb-1">{product.name}</h3>
                <p className="text-[10px] text-mt-ink-3 mb-2">{product.specs}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-bold text-mt-ink">{product.price}</span>
                  {isAdded ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-[#16A34A]"><Check size={10} /> Added</span>
                  ) : (
                    <button className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:opacity-80"
                      onClick={(e) => { e.stopPropagation(); onAddProduct(key, product.name); }}>
                      <Plus size={10} /> Add
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-center gap-4 p-4 bg-white rounded-lg border border-mt-border hover:border-primary/30 transition-colors">
              <div className="w-16 h-16 flex-shrink-0 bg-gradient-to-br from-[#F5F3FF] to-[#EEF2FF] rounded-lg flex items-center justify-center">
                <Printer size={20} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-mt-ink">{product.name}</h3>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#D97706]/10 text-[#D97706]">Print</span>
                </div>
                <p className="text-[11px] text-mt-ink-3">{product.supplier} · {product.specs}</p>
              </div>
              <span className="text-[14px] font-bold text-mt-ink">{product.price}</span>
              {isAdded ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-[#16A34A]"><Check size={10} /> Added</span>
              ) : (
                <button className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:opacity-80"
                  onClick={() => onAddProduct(key, product.name)}>
                  <Plus size={10} /> Add
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
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this product?"
        description={deleteTarget ? <>&ldquo;{deleteTarget.name}&rdquo; will be removed from your print catalog. This cannot be undone.</> : null}
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          onDeleteProduct(deleteTarget.id, deleteTarget.name);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
