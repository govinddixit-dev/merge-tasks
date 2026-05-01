/**
 * PortalMediaTab — POC-facing media library.
 *
 * Two-way file sharing with the distributor:
 *   • List files (both distributor and POC uploads) — live via trpc.storeMedia.listPortal
 *   • Upload (drag-and-drop or click) — live via trpc.storeMedia.uploadPortal
 *   • Delete — POCs can only delete their own uploads; distributor files show no delete button
 *
 * Uses existing design tokens (mt-brand primary, same card/border/hover patterns as
 * other portal tabs). No new UI libraries.
 */

import React, { useRef, useState } from "react";
import {
  Search, Upload, FileImage, FileVideo, File as FileIconGeneric, Download,
  Eye, Trash2, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface PortalMediaTabProps {
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  mediaSearch: string;
  setMediaSearch: (v: string) => void;
  getFileIcon: (type: string) => typeof FileImage;
  storeSlug: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:...;base64,XXXX → we only want XXXX
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function PortalMediaTab({
  isDark, fg, mutedFg, borderColor, cardBg,
  mediaSearch, setMediaSearch, getFileIcon, storeSlug,
}: PortalMediaTabProps) {
  const { data: files, isLoading, refetch } = trpc.storeMedia.listPortal.useQuery(
    { storeSlug },
    { enabled: !!storeSlug },
  );
  const uploadMut = trpc.storeMedia.uploadPortal.useMutation();
  const deleteMut = trpc.storeMedia.deletePortal.useMutation();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  // storeUser id of the signed-in POC — the dashboard endpoint already
  // exposes the current storeUser, so we piggy-back on that query.
  const { data: dashboard } = trpc.storePortal.dashboard.useQuery(
    { storeSlug },
    { enabled: !!storeSlug },
  );
  const mySessionUserId = dashboard?.user?.id ?? null;

  const filtered = (files ?? []).filter((f) =>
    !mediaSearch || f.fileName.toLowerCase().includes(mediaSearch.toLowerCase()) ||
    f.fileType.toLowerCase().includes(mediaSearch.toLowerCase()),
  );

  async function handleFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      for (const f of arr) {
        if (f.size > 25 * 1024 * 1024) {
          toast.error(`${f.name} exceeds the 25MB upload limit.`);
          continue;
        }
        const base64 = await fileToBase64(f);
        await uploadMut.mutateAsync({
          storeSlug,
          fileName: f.name,
          fileType: f.type || "application/octet-stream",
          base64Data: base64,
        });
      }
      toast.success(arr.length === 1 ? "File uploaded" : `${arr.length} files uploaded`);
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMut.mutateAsync({ storeSlug, id });
      toast.success("File removed");
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast.error(msg);
    }
  }

  const canDelete = (f: { uploadedBy: string; uploadedByUserId: number }) =>
    f.uploadedBy === "poc" && f.uploadedByUserId === mySessionUserId;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 items-start sm:items-center justify-between mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
          <input
            className="pl-9 pr-4 py-2 rounded-lg text-[12px] outline-none transition-all"
            style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}`, color: fg, width: 240 }}
            placeholder="Search media..."
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-60"
          style={{ backgroundColor: "var(--mt-brand)", color: "#FFFFFF" }}
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        className="mb-6 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors"
        style={{
          borderColor: dragOver ? "var(--mt-brand)" : borderColor,
          backgroundColor: dragOver ? "rgba(101,75,249,0.04)" : "transparent",
          color: mutedFg,
        }}
      >
        <Upload size={18} className="mx-auto mb-2 opacity-70" />
        <p className="text-[12px] font-medium" style={{ color: fg }}>
          Drop files to share with your distributor
        </p>
        <p className="text-[11px] mt-0.5">or click to browse — up to 25MB each</p>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[0,1,2,3,4,5,6,7].map((i) => (
            <div key={i} className="rounded-xl overflow-hidden animate-pulse" style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}>
              <div className="h-36" style={{ backgroundColor: isDark ? "#16161A" : "#F0F0F0" }} />
              <div className="p-3 space-y-2">
                <div className="h-3 rounded" style={{ backgroundColor: isDark ? "#1F1F23" : "#E5E7EB", width: "70%" }} />
                <div className="h-2 rounded" style={{ backgroundColor: isDark ? "#1F1F23" : "#E5E7EB", width: "40%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-xl" style={{ color: mutedFg, border: `1px dashed ${borderColor}` }}>
          <FileIconGeneric size={28} className="mx-auto mb-3 opacity-40" />
          <p className="text-[13px] font-semibold" style={{ color: fg }}>
            {mediaSearch ? "No matches" : "Your distributor hasn't shared any files yet"}
          </p>
          <p className="text-[12px] mt-1">
            {mediaSearch ? "Try a different search term." : "When they do, they'll show up here. You can also upload files to share back."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((file) => {
            const Icon = getFileIcon(file.fileType) || FileIconGeneric;
            const isImage = file.fileType.startsWith("image/");
            return (
              <div key={file.id} className="rounded-xl overflow-hidden group transition-all" style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}>
                <div className="h-36 flex items-center justify-center relative" style={{ backgroundColor: isDark ? "#16161A" : "#F0F0F0" }}>
                  {isImage ? (
                    <img src={file.fileUrl} alt={file.fileName} className="w-full h-full object-cover" />
                  ) : file.fileType.startsWith("video/") ? (
                    <FileVideo size={40} style={{ color: mutedFg, opacity: 0.5 }} />
                  ) : (
                    <Icon size={40} style={{ color: mutedFg, opacity: 0.5 }} />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
                    {isImage && (
                      <a href={file.fileUrl} target="_blank" rel="noreferrer" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors" aria-label="Preview">
                        <Eye size={14} className="text-white" />
                      </a>
                    )}
                    <a href={file.fileUrl} download={file.fileName} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors" aria-label="Download">
                      <Download size={14} className="text-white" />
                    </a>
                    {canDelete(file) && (
                      <button
                        onClick={() => handleDelete(file.id)}
                        disabled={deleteMut.isPending}
                        className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/70 transition-colors disabled:opacity-60"
                        aria-label="Delete"
                      >
                        <Trash2 size={14} className="text-white" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-[12px] font-semibold truncate" style={{ color: fg }} title={file.fileName}>{file.fileName}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{
                      backgroundColor: isDark ? "rgba(101,75,249,0.12)" : "rgba(101,75,249,0.06)",
                      color: "var(--mt-brand)",
                    }}>
                      {file.uploadedBy === "distributor" ? "Distributor" : "Team"}
                    </span>
                    <span className="text-[10px]" style={{ color: mutedFg }}>{formatBytes(file.fileSizeBytes)}</span>
                  </div>
                  <div className="text-[10px] mt-1" style={{ color: mutedFg }}>
                    {file.uploadedByName} · {formatDate(file.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
