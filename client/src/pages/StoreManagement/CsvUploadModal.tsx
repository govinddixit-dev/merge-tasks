import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload, FileText, CheckCircle, AlertCircle, Download, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface CsvUploadModalProps {
  open: boolean;
  onClose: () => void;
  storeId: number;
  storeSlug?: string;
  onSuccess?: () => void;
}

type ParsedRow = {
  rowNumber: number;
  name: string;
  email: string;
  role: string;
  location: string;
  department: string;
  errors: string[];
};

const VALID_ROLES = ["poc", "admin", "manager", "employee", "intern"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPECTED_HEADERS = ["name", "email", "role", "location", "department"];

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

  return lines.slice(1).map((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    const get = (key: string) => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? (cells[idx] ?? "") : "";
    };
    const name = get("name");
    const email = get("email");
    const role = get("role").toLowerCase();
    const location = get("location");
    const department = get("department");

    const errors: string[] = [];
    if (!name) errors.push("Missing name");
    if (!email) errors.push("Missing email");
    else if (!EMAIL_RE.test(email)) errors.push("Invalid email");
    if (!role) errors.push("Missing role");
    else if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
      errors.push(`Invalid role (must be ${VALID_ROLES.join("/")})`);
    }

    return { rowNumber: i + 2, name, email, role, location, department, errors };
  });
}

function toLocationSlug(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/\s+/g, "-");
}

export default function CsvUploadModal({
  open, onClose, storeId, onSuccess,
}: CsvUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [phase, setPhase] = useState<"upload" | "preview" | "done">("upload");
  const [result, setResult] = useState<{ successful: number; emailsSent: number } | null>(null);

  const provisionMut = trpc.storeProvisioning.provisionUsers.useMutation({
    onSuccess: (res) => {
      setResult({ successful: res.successful, emailsSent: res.emailsSent });
      setPhase("done");
      onSuccess?.();
      toast.success(`${res.successful} users created, ${res.emailsSent} invites sent`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const reset = () => {
    setFileName(null);
    setRows([]);
    setPhase("upload");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a .csv file");
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      toast.error("No rows found in CSV");
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    setPhase("preview");
  };

  const downloadTemplate = () => {
    const csv = [
      EXPECTED_HEADERS.join(","),
      "John Smith,john@acme.com,employee,Ontario,Marketing",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "store-users-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Template downloaded");
  };

  const submit = () => {
    const validRows = rows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      toast.error("No valid rows to upload");
      return;
    }
    provisionMut.mutate({
      storeId,
      origin: window.location.origin,
      users: validRows.map((r) => ({
        name: r.name,
        email: r.email,
        role: r.role as (typeof VALID_ROLES)[number],
        department: r.department || undefined,
        locationSlug: toLocationSlug(r.location),
      })),
    });
  };

  if (!open) return null;

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  const invalidCount = rows.length - validCount;

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-3xl bg-white rounded-xl shadow-lg flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div
          className="px-7 py-5 flex items-center justify-between"
          style={{ borderBottom: "1px solid #F0F0F0" }}
        >
          <div>
            <h2 className="text-[18px] font-bold text-mt-ink">Bulk Upload Users</h2>
            <p className="text-[12px] text-mt-ink-3 mt-0.5">
              Import store users from a CSV file — one row per person.
            </p>
          </div>
          <button
            className="p-2 hover:bg-mt-surface-2 rounded-lg transition-colors"
            onClick={handleClose}
            aria-label="Close"
          >
            <X size={16} className="text-mt-ink-3" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-5">
          {phase === "upload" && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed rounded-xl p-8 text-center transition-all border-mt-border hover:border-primary bg-mt-surface cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText size={32} className="mx-auto mb-3 text-primary" />
                <p className="text-[14px] font-semibold text-mt-ink mb-1">
                  Select a CSV file
                </p>
                <p className="text-[12px] text-mt-ink-3 mb-4">
                  First row should be headers: {EXPECTED_HEADERS.join(", ")}
                </p>
                <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-white transition-colors">
                  <Upload size={12} /> Browse Files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </div>

              <div className="bg-[#F9FAFB] rounded-xl p-4">
                <div className="flex items-start gap-2.5">
                  <AlertCircle size={14} className="text-mt-ink-3 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[12px] font-semibold text-mt-ink mb-1">
                      CSV format
                    </p>
                    <p className="text-[11px] text-mt-ink-3 leading-relaxed mb-2">
                      Roles: <span className="font-mono">poc</span>, <span className="font-mono">admin</span>, <span className="font-mono">manager</span>, <span className="font-mono">employee</span>, <span className="font-mono">intern</span>. Location matches by slug (lowercased, spaces → dashes). Department is optional.
                    </p>
                    <button
                      onClick={downloadTemplate}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
                    >
                      <Download size={11} /> Download template
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {phase === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[12px] font-semibold text-mt-ink flex items-center gap-1.5">
                  <FileText size={12} className="text-mt-ink-3" /> {fileName}
                </span>
                <span className="text-[11px] text-mt-ink-4">·</span>
                <span className="text-[12px] text-mt-ink-3">
                  {rows.length} row{rows.length === 1 ? "" : "s"}
                </span>
                {validCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F0FDF4] text-[#16A34A]">
                    <CheckCircle size={10} /> {validCount} valid
                  </span>
                )}
                {invalidCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF2F2] text-[#DC2626]">
                    <AlertCircle size={10} /> {invalidCount} invalid
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-mt-border">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-mt-surface">
                      {["Row", "Name", "Email", "Role", "Location", "Department", "Status"].map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 font-semibold text-mt-ink-3 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const bad = r.errors.length > 0;
                      return (
                        <tr
                          key={r.rowNumber}
                          className={bad ? "bg-[#FEF2F2]" : ""}
                          style={{ borderTop: "1px solid #F0F0F0" }}
                        >
                          <td className="px-3 py-2 text-mt-ink-4 font-mono">{r.rowNumber}</td>
                          <td className="px-3 py-2 text-mt-ink font-medium">{r.name || <span className="text-mt-ink-4 italic">—</span>}</td>
                          <td className="px-3 py-2 text-mt-ink-3 font-mono">{r.email || <span className="text-mt-ink-4 italic">—</span>}</td>
                          <td className="px-3 py-2 text-mt-ink-3">{r.role || <span className="text-mt-ink-4 italic">—</span>}</td>
                          <td className="px-3 py-2 text-mt-ink-3">{r.location || <span className="text-mt-ink-4 italic">—</span>}</td>
                          <td className="px-3 py-2 text-mt-ink-3">{r.department || <span className="text-mt-ink-4 italic">—</span>}</td>
                          <td className="px-3 py-2">
                            {bad ? (
                              <span className="inline-flex items-center gap-1 text-[#DC2626]">
                                <AlertCircle size={10} /> {r.errors.join(", ")}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[#16A34A]">
                                <CheckCircle size={10} /> Ready
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {phase === "done" && result && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-[#F0FDF4] flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={32} className="text-[#16A34A]" />
              </div>
              <h3 className="text-[18px] font-bold text-mt-ink mb-2">Upload Complete</h3>
              <p className="text-[13px] text-mt-ink-3">
                {result.successful} user{result.successful === 1 ? "" : "s"} created, {result.emailsSent} invite{result.emailsSent === 1 ? "" : "s"} sent.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-7 py-4 flex items-center justify-end gap-3"
          style={{ borderTop: "1px solid #F0F0F0" }}
        >
          {phase === "upload" && (
            <button className="sq-action-btn text-[12px]" onClick={handleClose}>
              Cancel
            </button>
          )}
          {phase === "preview" && (
            <>
              <button
                className="sq-action-btn text-[12px]"
                onClick={reset}
                disabled={provisionMut.isPending}
              >
                Back
              </button>
              <button
                className="sq-action-btn primary text-[12px]"
                onClick={submit}
                disabled={provisionMut.isPending || validCount === 0}
              >
                {provisionMut.isPending
                  ? `Uploading ${validCount} users...`
                  : `Upload ${validCount} User${validCount === 1 ? "" : "s"}`}
              </button>
            </>
          )}
          {phase === "done" && (
            <button className="sq-action-btn primary text-[12px]" onClick={handleClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
