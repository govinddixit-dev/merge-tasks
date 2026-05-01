import { useState } from "react";
import { FolderOpen, ChevronRight, Plus, Layers, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const COLORS = ["#654BF9", "#16A34A", "#D97706", "#2563EB", "#DC2626", "#0891B2", "#7C3AED", "#EA580C"];

export default function CurationCollectionsTab() {
  const utils = trpc.useUtils();
  const { data: collections = [], isLoading } = trpc.collections.list.useQuery();
  const createCollection = trpc.collections.create.useMutation({
    onSuccess: () => { utils.collections.list.invalidate(); },
  });
  const deleteCollection = trpc.collections.delete.useMutation({
    onSuccess: () => { utils.collections.list.invalidate(); },
    onError: (err) => { toast.error("Failed to delete: " + err.message); },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createCollection.mutateAsync({ name: newName.trim(), color: newColor });
    toast.success(`"${newName.trim()}" collection created`);
    setNewName("");
    setNewColor(COLORS[0]);
    setShowCreate(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-mt-ink-3">Organize products into reusable collections for proposals and stores</p>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold text-white"
          style={{ backgroundColor: 'var(--mt-brand)' }}
          onClick={() => setShowCreate(true)}
        >
          <Plus size={12} /> New Collection
        </button>
      </div>

      {/* Create Collection Inline Form */}
      {showCreate && (
        <div className="bg-white rounded-xl border-2 border-primary/30 p-5 animate-[fadeIn_0.3s_ease-out]">
          <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[14px] font-bold text-mt-ink">Create Collection</h4>
            <button className="p-1 hover:bg-mt-surface-2 rounded-lg transition-colors" onClick={() => setShowCreate(false)}>
              <X size={14} className="text-mt-ink-3" />
            </button>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-[12px] font-semibold text-mt-ink-2 mb-1.5 block">Collection Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="w-full px-3 py-2.5 rounded-lg border border-mt-border text-[13px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="e.g. Q2 New Hire Kits"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-mt-ink-2 mb-1.5 block">Color</label>
              <div className="flex gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className="w-7 h-7 rounded-lg transition-all"
                    style={{
                      backgroundColor: c,
                      outline: newColor === c ? `2px solid ${c}` : "none",
                      outlineOffset: "2px",
                    }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
            </div>
            <button
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold text-white transition-all disabled:opacity-50"
              style={{ backgroundColor: 'var(--mt-brand)' }}
              disabled={!newName.trim() || createCollection.isPending}
              onClick={handleCreate}
            >
              {createCollection.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="text-primary animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && collections.length === 0 && !showCreate && (
        <div className="flex flex-col items-center justify-center py-16 animate-[fadeIn_0.5s_ease-out]">
          <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes pulse-ring{0%{transform:scale(1);opacity:0.3}50%{transform:scale(1.08);opacity:0.15}100%{transform:scale(1);opacity:0.3}}`}</style>
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-full bg-primary/10" style={{ animation: 'pulse-ring 3s ease-in-out infinite' }} />
            <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary/5 to-primary/15 flex items-center justify-center" style={{ animation: 'float 4s ease-in-out infinite' }}>
              <Layers size={32} className="text-primary/60" strokeWidth={1.5} />
            </div>
          </div>
          <h3 className="text-[17px] font-bold text-mt-ink mb-2">No collections yet</h3>
          <p className="text-[13px] text-mt-ink-3 text-center max-w-sm mb-6 leading-relaxed">Group your products into collections to quickly build proposals and stock client stores.</p>
          <button
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-sm"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={13} /> Create Your First Collection
          </button>
        </div>
      )}

      {/* Collections Grid */}
      {!isLoading && collections.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((col) => {
            const remaining = col.productCount - col.previewItems.length;
            return (
              <div key={col.id} className="bg-white rounded-xl border border-mt-border p-5 hover:border-primary/30 hover:shadow-md transition-all duration-200 cursor-pointer group">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${col.color}15` }}>
                      <FolderOpen size={18} style={{ color: col.color }} />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-bold text-mt-ink">{col.name}</h3>
                      <p className="text-[11px] text-mt-ink-3">
                        {col.productCount} {col.productCount === 1 ? "item" : "items"} · Updated {new Date(col.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-[#FEF2F2] rounded-lg transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget({ id: col.id, name: col.name });
                      }}
                    >
                      <Trash2 size={12} className="text-[#EF4444]" />
                    </button>
                    <ChevronRight size={14} className="text-mt-ink-4" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {col.previewItems.length > 0 ? (
                    <>
                      {col.previewItems.map((item, j) => (
                        <span key={j} className="text-[10px] font-medium px-2 py-0.5 rounded bg-mt-surface-2 text-mt-ink-3">{item}</span>
                      ))}
                      {remaining > 0 && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-mt-surface-2 text-mt-ink-4">+{remaining} more</span>
                      )}
                    </>
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-mt-surface-2 text-mt-ink-4">Empty — add products to get started</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this collection?"
        description={deleteTarget ? <>&ldquo;{deleteTarget.name}&rdquo; will be removed. Products in the collection won&rsquo;t be deleted.</> : null}
        confirmLabel="Delete"
        loading={deleteCollection.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const name = deleteTarget.name;
          deleteCollection.mutate(
            { id: deleteTarget.id },
            {
              onSuccess: () => toast.success(`"${name}" deleted`),
              onSettled: () => setDeleteTarget(null),
            },
          );
        }}
      />
    </div>
  );
}
