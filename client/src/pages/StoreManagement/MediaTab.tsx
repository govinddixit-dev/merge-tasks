/**
 * MediaTab — distributor-facing media library for a single store.
 *
 * Mirrors PortalMediaTab for the POC side: same underlying storeMedia
 * data model, same upload/preview/delete semantics. Distributor can
 * delete any file; POC uploads are tagged so distributor can see who
 * sent them.
 */
import React, { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Upload, Download, Eye, Trash2, Loader2, FileImage, FileVideo, File as FileIconGeneric,
  FileText, FileArchive, Search,
} from "lucide-react";

interface MediaTabProps {
  storeId: number;
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

function iconFor(fileType: string): typeof FileImage {
  if (fileType.startsWith("image/")) return FileImage;
  if (fileType.startsWith("video/")) return FileVideo;
  if (fileType.startsWith("text/") || fileType.includes("pdf") || fileType.includes("word")) return FileText;
  if (fileType.includes("zip") || fileType.includes("rar") || fileType.includes("tar")) return FileArchive;
  return FileIconGeneric;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function MediaTab({ storeId }: MediaTabProps) {
  const { data: files, isLoading, refetch } = trpc.storeMedia.list.useQuery({ storeId });
  const uploadMut = trpc.storeMedia.upload.useMutation();
  const deleteMut = trpc.storeMedia.delete.useMutation();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = (files ?? []).filter((f) =>
    !search || f.fileName.toLowerCase().includes(search.toLowerCase()) || f.fileType.toLowerCase().includes(search.toLowerCase())
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
          storeId,
          fileName: f.name,
          fileType: f.type || "application/octet-stream",
          base64Data: base64,
        });
      }
      toast.success(arr.length === 1 ? "File uploaded" : `${arr.length} files uploaded`);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload the file — please try again");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMut.mutateAsync({ id });
      toast.success("File removed");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the file");
    }
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3 sm:gap-0">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mt-ink-4" />
          <input
            className="pl-9 pr-4 py-2 rounded-lg text-[12px] outline-none border border-mt-border bg-white focus:border-primary"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
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
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60 transition-colors"
          style={{ backgroundColor: "#654BF9" }}
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
          borderColor: dragOver ? "#654BF9" : "#E5E7EB",
          backgroundColor: dragOver ? "rgba(101,75,249,0.04)" : "transparent",
        }}
      >
        <Upload size={18} className="mx-auto mb-2 text-mt-ink-3" />
        <p className="text-[13px] font-medium text-mt-ink">Drop files to share with this store&rsquo;s POC</p>
        <p className="text-[11px] text-mt-ink-3 mt-0.5">or click to browse — up to 25MB each</p>
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="space-y-2">
          {[0,1,2,3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-mt-surface animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed border-mt-border">
          <FileIconGeneric size={28} className="mx-auto mb-3 text-mt-ink-4 opacity-40" />
          <p className="text-[13px] font-semibold text-mt-ink">
            {search ? "No matches" : "No files shared yet"}
          </p>
          <p className="text-[12px] text-mt-ink-3 mt-1">
            {search ? "Try a different search term." : "Upload brand assets, artwork, and specs so your POC has them in one place."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-mt-border overflow-hidden divide-y divide-mt-border">
          {filtered.map((file) => {
            const Icon = iconFor(file.fileType);
            const isImage = file.fileType.startsWith("image/");
            return (
              <div key={file.id} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-mt-surface/60 transition-colors">
                <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#F3F4F6" }}>
                  {isImage ? (
                    <img src={file.fileUrl} alt={file.fileName} className="w-full h-full object-cover rounded-md" />
                  ) : (
                    <Icon size={16} className="text-mt-ink-3" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-mt-ink truncate">{file.fileName}</div>
                  <div className="text-[11px] text-mt-ink-3 mt-0.5 flex items-center gap-2">
                    <span className="uppercase tracking-wide">{file.uploadedBy === "distributor" ? "You" : "POC"}</span>
                    <span>·</span>
                    <span>{file.uploadedByName}</span>
                    <span>·</span>
                    <span>{formatBytes(file.fileSizeBytes)}</span>
                    <span>·</span>
                    <span>{formatDate(file.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isImage && (
                    <a href={file.fileUrl} target="_blank" rel="noreferrer" className="p-2 rounded-md hover:bg-mt-surface text-mt-ink-3 hover:text-mt-ink" aria-label="Preview">
                      <Eye size={14} />
                    </a>
                  )}
                  <a href={file.fileUrl} download={file.fileName} className="p-2 rounded-md hover:bg-mt-surface text-mt-ink-3 hover:text-mt-ink" aria-label="Download">
                    <Download size={14} />
                  </a>
                  <button
                    onClick={() => handleDelete(file.id)}
                    disabled={deleteMut.isPending}
                    className="p-2 rounded-md hover:bg-red-50 text-mt-ink-3 hover:text-red-500 disabled:opacity-60"
                    aria-label="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
