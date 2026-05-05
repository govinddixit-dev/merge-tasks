import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Plus, Search, Filter, Loader2, X, ChevronRight, ChevronLeft,
  Building2, Mail, Phone, Globe, MapPin, Edit3, Trash2, Eye,
  FileText, ShoppingCart, Store, Image as ImageIcon, Upload,
  Users, TrendingUp, UserPlus, Star, Check,
  FolderOpen, Download, File, Palette, BookOpen, Camera, Package
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, formatFileSize } from "@/lib/utils";
import { RequiredMark } from "@/components/ui/required-mark";
import { FieldError } from "@/components/ui/field-error";
import { statusTone } from "@/lib/statusPalette";
import ClientProductsTab from "@/components/clients/ClientProductsTab";
import PriceMatrixModal from "@/components/curation/PriceMatrixModal";

const ROWS_PER_PAGE = 10;

/**
 * Skeleton row for the Clients table — columns 1:1 with the real render
 * at line ~920. Widths chosen to approximate typical content length so
 * the skeleton reads as a dim version of the real data, not a generic bar.
 */
function ClientsSkeletonRow() {
  return (
    <tr className="border-b border-[#F5F5F5]">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#F0F0F0] animate-pulse flex-shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3.5 bg-[#F0F0F0] rounded-full w-32 animate-pulse" />
            <div className="h-2.5 bg-[#F0F0F0] rounded-full w-24 animate-pulse" />
          </div>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <div className="space-y-1.5">
          <div className="h-3.5 bg-[#F0F0F0] rounded-full w-28 animate-pulse" />
          <div className="h-2.5 bg-[#F0F0F0] rounded-full w-36 animate-pulse" />
        </div>
      </td>
      <td className="px-5 py-3.5"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-20 animate-pulse" /></td>
      <td className="px-5 py-3.5"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-6 mx-auto animate-pulse" /></td>
      <td className="px-5 py-3.5"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-6 mx-auto animate-pulse" /></td>
      <td className="px-5 py-3.5"><div className="h-5 bg-[#F0F0F0] rounded-full w-16 animate-pulse" /></td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-1">
          <div className="w-7 h-7 rounded-md bg-[#F0F0F0] animate-pulse" />
          <div className="w-7 h-7 rounded-md bg-[#F0F0F0] animate-pulse" />
        </div>
      </td>
    </tr>
  );
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  active:   { ...statusTone.purple, label: "Active" },
  prospect: { ...statusTone.amber,  label: "Prospect" },
  inactive: { ...statusTone.gray,   label: "Inactive" },
};

const ASSET_CATEGORIES = [
  { value: "logo", label: "Logo", icon: Palette },
  { value: "brand_guide", label: "Brand Guide", icon: BookOpen },
  { value: "artwork", label: "Artwork", icon: ImageIcon },
  { value: "document", label: "Document", icon: File },
  { value: "photo", label: "Photo", icon: Camera },
  { value: "other", label: "Other", icon: Package },
] as const;

const INDUSTRIES = [
  "Technology", "Healthcare", "Finance", "Education", "Manufacturing",
  "Retail", "Real Estate", "Non-Profit", "Government", "Hospitality",
  "Sports & Entertainment", "Construction", "Energy", "Agriculture", "Other"
];

const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];

// formatFileSize, formatDate, formatCurrency imported from @/lib/utils

//  Add/Edit Client Modal 
interface ClientFormData {
  companyName: string;
  industry: string;
  companySize: string;
  website: string;
  address: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  pocEmail: string;
  status: "active" | "inactive" | "prospect";
  notes: string;
}

const emptyForm: ClientFormData = {
  companyName: "", industry: "", companySize: "", website: "", address: "",
  contactName: "", contactTitle: "", contactEmail: "", contactPhone: "",
  pocEmail: "",
  status: "prospect", notes: "",
};

function ClientFormModal({
  open, onClose, initialData, onSubmit, isLoading, title,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: ClientFormData;
  onSubmit: (data: ClientFormData) => void;
  isLoading: boolean;
  title: string;
}) {
  const [form, setForm] = useState<ClientFormData>(initialData || emptyForm);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const handleChange = (field: keyof ClientFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const errors = {
    companyName: form.companyName.trim() ? null : "Company name is required",
    contactName: form.contactName.trim() ? null : "Contact name is required",
    contactEmail: !form.contactEmail.trim()
      ? "Email is required"
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())
      ? null
      : "Enter a valid email address",
  };
  const hasErrors = Boolean(errors.companyName || errors.contactName || errors.contactEmail);

  const handleSubmitClick = () => {
    setAttemptedSubmit(true);
    if (hasErrors) return;
    onSubmit(form);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
          <h2 className="text-[16px] font-bold text-mt-ink">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mt-surface-2">
            <X size={16} className="text-mt-ink-3" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-3">Company Information</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1.5 block">Company Name<RequiredMark /></label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all" placeholder="Acme Corporation" value={form.companyName} onChange={(e) => handleChange("companyName", e.target.value)} />
                {attemptedSubmit && <FieldError message={errors.companyName} />}
              </div>
              <div>
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Industry</label>
                <select className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary bg-white" value={form.industry} onChange={(e) => handleChange("industry", e.target.value)}>
                  <option value="">Select industry...</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Company Size</label>
                <select className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary bg-white" value={form.companySize} onChange={(e) => handleChange("companySize", e.target.value)}>
                  <option value="">Select size...</option>
                  {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Website</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all" placeholder="https://acme.com" value={form.website} onChange={(e) => handleChange("website", e.target.value)} />
              </div>
              <div>
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Status</label>
                <select className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary bg-white" value={form.status} onChange={(e) => handleChange("status", e.target.value)}>
                  <option value="prospect">Prospect</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Address</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all" placeholder="123 Main St, City, State 12345" value={form.address} onChange={(e) => handleChange("address", e.target.value)} />
              </div>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-3">Primary Contact</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1.5 block">Contact Name<RequiredMark /></label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all" placeholder="John Doe" value={form.contactName} onChange={(e) => handleChange("contactName", e.target.value)} />
                {attemptedSubmit && <FieldError message={errors.contactName} />}
              </div>
              <div>
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Title</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all" placeholder="Marketing Director" value={form.contactTitle} onChange={(e) => handleChange("contactTitle", e.target.value)} />
              </div>
              <div>
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1.5 block">Email<RequiredMark /></label>
                <input type="email" className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all" placeholder="john@acme.com" value={form.contactEmail} onChange={(e) => handleChange("contactEmail", e.target.value)} />
                {attemptedSubmit && <FieldError message={errors.contactEmail} />}
              </div>
              <div>
                <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Phone</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all" placeholder="(555) 123-4567" value={form.contactPhone} onChange={(e) => handleChange("contactPhone", e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-[12px] font-medium text-mt-ink-3 mb-1.5">
                  Webstore POC Email
                  <span className="ml-1 text-mt-ink-4 font-normal">(optional — person who manages the client portal)</span>
                </label>
                <input
                  type="email"
                  className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all"
                  placeholder="portal-manager@acme.com"
                  value={form.pocEmail}
                  onChange={(e) => handleChange("pocEmail", e.target.value)}
                />
              </div>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Notes</label>
            <textarea className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all resize-none" rows={3} placeholder="Additional notes about this client..." value={form.notes} onChange={(e) => handleChange("notes", e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#F0F0F0]">
          <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-mt-ink-3 hover:text-mt-ink transition-colors">Cancel</button>
          <button onClick={handleSubmitClick} disabled={isLoading || (attemptedSubmit && hasErrors)} className="px-5 py-2.5 text-[13px] font-semibold text-white bg-primary rounded-lg hover:bg-[#5438D4] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.97] flex items-center gap-2">
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            {title.includes("Edit") ? "Save Changes" : "Add Client"}
          </button>
        </div>
      </div>
    </div>
  );
}

//  Delete Confirmation Modal — wraps the shared ConfirmDialog with a
//  two-stage description: plain prompt first, then a warning (and a
//  "Force Delete" primary label) if the first attempt surfaced related
//  records that would be affected.
function DeleteModal({ open, onClose, onConfirm, clientName, isLoading, hasRelated, relatedMessage }: {
  open: boolean; onClose: () => void; onConfirm: (force: boolean) => void;
  clientName: string; isLoading: boolean; hasRelated: boolean; relatedMessage: string;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Delete this client?"
      description={
        <>
          <span>
            <strong>{clientName}</strong> will be removed permanently. This cannot be undone.
          </span>
          {hasRelated && (
            <span className="mt-3 block p-3 rounded-lg bg-[#FEF3C7] text-[12px] text-[#92400E]">
              {relatedMessage}
            </span>
          )}
        </>
      }
      confirmLabel={hasRelated ? "Force Delete" : "Delete"}
      loading={isLoading}
      onCancel={onClose}
      onConfirm={() => onConfirm(hasRelated)}
    />
  );
}

//  Asset Upload Modal 
function AssetUploadModal({ open, onClose, clientId, onSuccess }: {
  open: boolean; onClose: () => void; clientId: number; onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("other");
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadAsset = trpc.clients.uploadAsset.useMutation({
    onSuccess: () => {
      toast.success("Asset uploaded");
      setFile(null); setPreview(null); setCategory("other"); setDescription("");
      onSuccess(); onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFileSelect = useCallback((f: File) => {
    setFile(f);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else { setPreview(null); }
  }, []);

  const handleUpload = useCallback(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      uploadAsset.mutate({ clientId, fileName: file.name, fileData: base64, fileType: file.type, fileSize: file.size, category: category as "logo" | "brand_guide" | "artwork" | "document" | "photo" | "other" | undefined, description: description || undefined });
    };
    reader.readAsDataURL(file);
  }, [file, clientId, category, description, uploadAsset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
          <h2 className="text-[16px] font-bold text-mt-ink">Upload Asset</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mt-surface-2"><X size={16} className="text-mt-ink-3" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div
            className="border-2 border-dashed border-mt-border rounded-xl p-6 text-center cursor-pointer hover:border-primary hover:bg-[#FAFAFE] transition-all"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
          >
            {preview ? (
              <img src={preview} alt="Preview" className="w-24 h-24 object-contain mx-auto rounded-lg mb-3" />
            ) : file ? (
              <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-mt-brand-light flex items-center justify-center"><File size={28} className="text-primary" /></div>
            ) : (
              <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-mt-brand-light flex items-center justify-center"><Upload size={28} className="text-primary" /></div>
            )}
            <p className="text-[13px] font-medium text-mt-ink">{file ? file.name : "Click or drag file to upload"}</p>
            <p className="text-[11px] text-mt-ink-4 mt-1">{file ? formatFileSize(file.size) : "Images, PDFs, documents up to 10MB"}</p>
            <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.ai,.eps,.svg" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
          </div>
          <div>
            <label className="text-[12px] font-medium text-mt-ink-2 mb-1.5 block">Category</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ASSET_CATEGORIES.map((cat) => {
                const CatIcon = cat.icon;
                return (
                  <button key={cat.value} onClick={() => setCategory(cat.value)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-all border ${category === cat.value ? "border-primary bg-mt-brand-light text-primary" : "border-mt-border text-mt-ink-3 hover:border-[#C4C4C4]"}`}>
                    <CatIcon size={14} />{cat.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-mt-ink-2 mb-1 block">Description (optional)</label>
            <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary transition-all" placeholder="Brief description of this asset..." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#F0F0F0]">
          <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-mt-ink-3">Cancel</button>
          <button onClick={handleUpload} disabled={!file || uploadAsset.isPending} className="px-5 py-2.5 text-[13px] font-semibold text-white bg-primary rounded-lg hover:bg-[#5438D4] disabled:opacity-50 transition-all active:scale-[0.97] flex items-center gap-2">
            {uploadAsset.isPending && <Loader2 size={14} className="animate-spin" />}Upload
          </button>
        </div>
      </div>
    </div>
  );
}

//  Contacts Section — multi-contact management under the Primary Contact label
interface ContactFormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
}
const emptyContactForm: ContactFormState = { firstName: "", lastName: "", email: "", phone: "", title: "" };

function ContactsSection({ clientId }: { clientId: number }) {
  const utils = trpc.useUtils();
  const { data: contacts, isLoading } = trpc.clientContacts.list.useQuery({ clientId });

  const [mode, setMode] = useState<"view" | "add" | { edit: number }>("view");
  const [form, setForm] = useState<ContactFormState>(emptyContactForm);
  const [contactToDelete, setContactToDelete] = useState<{ id: number; label: string } | null>(null);

  const refresh = () => {
    utils.clientContacts.list.invalidate({ clientId });
    utils.clients.getById.invalidate({ id: clientId });
  };

  const createMut = trpc.clientContacts.create.useMutation({
    onSuccess: () => { toast.success("Contact added"); refresh(); setMode("view"); setForm(emptyContactForm); },
    onError: (err) => toast.error(err.message),
  });
  const updateMut = trpc.clientContacts.update.useMutation({
    onSuccess: () => { toast.success("Contact updated"); refresh(); setMode("view"); setForm(emptyContactForm); },
    onError: (err) => toast.error(err.message),
  });
  const deleteMut = trpc.clientContacts.delete.useMutation({
    onSuccess: () => { toast.success("Contact removed"); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const setPrimaryMut = trpc.clientContacts.setPrimary.useMutation({
    onSuccess: () => { toast.success("Primary contact updated"); refresh(); },
    onError: (err) => toast.error(err.message),
  });

  const emailError = form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const isMutating = createMut.isPending || updateMut.isPending;

  const submit = () => {
    if (emailError) return;
    if (mode === "add") {
      createMut.mutate({
        clientId,
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        title: form.title.trim() || undefined,
      });
    } else if (typeof mode === "object") {
      updateMut.mutate({
        id: mode.edit,
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        title: form.title.trim() || null,
      });
    }
  };

  const startEdit = (c: { id: number; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; title: string | null }) => {
    setForm({
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      email: c.email || "",
      phone: c.phone || "",
      title: c.title || "",
    });
    setMode({ edit: c.id });
  };

  const cancel = () => { setMode("view"); setForm(emptyContactForm); };

  const renderForm = (submitLabel: string) => (
    <div className="space-y-2 p-3 rounded-lg bg-mt-surface border border-[#F0F0F0]">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className="px-2.5 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-primary" placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        <input className="px-2.5 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-primary" placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
      </div>
      <input className="w-full px-2.5 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-primary" placeholder="Title / Role" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <input className={`w-full px-2.5 py-2 text-[12px] border rounded-md outline-none ${emailError ? "border-red-400" : "border-mt-border focus:border-primary"}`} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      {emailError && <p className="text-[10px] text-red-500">Invalid email</p>}
      <input className="w-full px-2.5 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-primary" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={cancel} className="px-3 py-1.5 text-[12px] font-medium text-mt-ink-3 hover:text-mt-ink-2">Cancel</button>
        <button onClick={submit} disabled={isMutating || !!emailError} className="px-3 py-1.5 text-[12px] font-semibold text-white bg-primary rounded-md hover:bg-[#5438D4] disabled:opacity-50 transition-transform duration-75 active:scale-[0.97] flex items-center gap-1.5">
          {isMutating && <Loader2 size={12} className="animate-spin" />}{submitLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">Contacts</p>
        {mode === "view" && (
          <button onClick={() => { setForm(emptyContactForm); setMode("add"); }} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-[#5438D4]">
            <Plus size={12} /> Add Contact
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-4"><Loader2 size={14} className="animate-spin text-mt-ink-4" /></div>
      ) : (
        <div className="space-y-2.5">
          {mode === "add" && renderForm("Add")}
          {(contacts ?? []).map((c) => {
            const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact";
            const initials = (c.firstName?.[0] || c.email?.[0] || "?").toUpperCase() + (c.lastName?.[0] || "").toUpperCase();
            const isEditing = typeof mode === "object" && mode.edit === c.id;
            if (isEditing) return <div key={c.id}>{renderForm("Save")}</div>;
            return (
              <div key={c.id} className="rounded-lg border border-[#F0F0F0] p-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-mt-brand-light flex items-center justify-center text-[11px] font-bold text-primary shrink-0">{initials}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-semibold text-mt-ink truncate">{fullName}</p>
                      {c.isPrimary && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-mt-brand-light text-primary uppercase tracking-wide">
                          <Star size={9} /> Primary
                        </span>
                      )}
                    </div>
                    {c.title && <p className="text-[11px] text-mt-ink-4">{c.title}</p>}
                    {c.email && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-[12px] text-mt-ink-2">
                        <Mail size={12} className="text-mt-ink-4" />
                        <a href={`mailto:${c.email}`} className="hover:text-primary truncate">{c.email}</a>
                      </div>
                    )}
                    {c.phone && (
                      <div className="flex items-center gap-1.5 mt-1 text-[12px] text-mt-ink-2">
                        <Phone size={12} className="text-mt-ink-4" />
                        <span>{c.phone}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!c.isPrimary && (
                      <button onClick={() => setPrimaryMut.mutate({ id: c.id })} disabled={setPrimaryMut.isPending} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-mt-brand-light text-mt-ink-3 hover:text-primary" title="Set as primary">
                        <Check size={13} />
                      </button>
                    )}
                    <button onClick={() => startEdit(c)} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-mt-surface-2 text-mt-ink-3 hover:text-primary" title="Edit">
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={() => setContactToDelete({ id: c.id, label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "This contact" })}
                      disabled={deleteMut.isPending}
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#FEE2E2] text-mt-ink-3 hover:text-[#DC2626]"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {!isLoading && (contacts ?? []).length === 0 && mode !== "add" && (
            <p className="text-[12px] text-mt-ink-4">No contacts yet.</p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={contactToDelete !== null}
        title="Remove this contact?"
        description={
          contactToDelete
            ? <>{contactToDelete.label} will no longer appear on this client. You can add them again any time.</>
            : null
        }
        confirmLabel="Remove"
        loading={deleteMut.isPending}
        onCancel={() => setContactToDelete(null)}
        onConfirm={() => {
          if (!contactToDelete) return;
          deleteMut.mutate(
            { id: contactToDelete.id },
            { onSettled: () => setContactToDelete(null) },
          );
        }}
      />
    </div>
  );
}

//  Client Detail Slide-Over
function ClientDetail({ clientId, onClose, onEdit, onDelete }: {
  clientId: number; onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"overview" | "proposals" | "orders" | "assets" | "products">("overview");
  const [showAssetUpload, setShowAssetUpload] = useState(false);
  const [pricingTarget, setPricingTarget] = useState<{ productId: number; productName: string } | null>(null);

  const { data: client, isLoading, refetch } = trpc.clients.getById.useQuery({ id: clientId });

  const deleteAsset = trpc.clients.deleteAsset.useMutation({
    onSuccess: () => { toast.success("Asset deleted"); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-40 flex">
        <div className="flex-1 bg-black/20" onClick={onClose} />
        <div className="w-[520px] bg-white shadow-2xl flex items-center justify-center"><Loader2 size={24} className="animate-spin text-primary" /></div>
      </div>
    );
  }
  if (!client) return null;

  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "proposals" as const, label: `Proposals (${client.proposalCount})` },
    { key: "orders" as const, label: `Orders (${client.orderCount})` },
    { key: "assets" as const, label: `Assets (${client.assetCount})` },
    { key: "products" as const, label: "Products" },
  ];

  const statusInfo = STATUS_COLORS[client.status] || STATUS_COLORS.prospect;

  return (
    <>
      <div className="fixed inset-0 z-40 flex">
        <div className="flex-1 bg-black/20" onClick={onClose} />
        <div className="w-[560px] h-screen bg-white shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-[#F0F0F0]">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-[18px] font-bold text-mt-ink truncate">{client.companyName}</h2>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: statusInfo.bg, color: statusInfo.text }}>{statusInfo.label}</span>
                </div>
                {client.industry && <p className="text-[12px] text-mt-ink-3">{client.industry}{client.companySize ? ` · ${client.companySize} employees` : ""}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={onEdit} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mt-surface-2 text-mt-ink-3 hover:text-primary transition-colors" title="Edit"><Edit3 size={15} /></button>
                <button onClick={onDelete} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#FEE2E2] text-mt-ink-3 hover:text-[#DC2626] transition-colors" title="Delete"><Trash2 size={15} /></button>
                <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mt-surface-2 text-mt-ink-3"><X size={16} /></button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Revenue", value: formatCurrency(client.totalRevenue), icon: TrendingUp, color: "#16A34A" },
                { label: "Proposals", value: String(client.proposalCount), icon: FileText, color: 'var(--mt-brand)' },
                { label: "Orders", value: String(client.orderCount), icon: ShoppingCart, color: "#D97706" },
                { label: "Stores", value: String(client.storeCount), icon: Store, color: "#3B82F6" },
              ].map((stat) => (
                <div key={stat.label} className="bg-mt-surface rounded-lg px-3 py-2.5 text-center">
                  <stat.icon size={14} className="mx-auto mb-1" style={{ color: stat.color }} />
                  <p className="text-[14px] font-bold text-mt-ink">{stat.value}</p>
                  <p className="text-[10px] text-mt-ink-4">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[#F0F0F0] px-6">
            {tabs.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-4 py-3 text-[12px] font-semibold transition-colors relative ${activeTab === tab.key ? "text-primary" : "text-mt-ink-4 hover:text-mt-ink-2"}`}>
                {tab.label}
                {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t" />}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {activeTab === "overview" && (
              <div className="space-y-5">
                <ContactsSection clientId={client.id} />
                <div>
                  <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-3">Company Details</p>
                  <div className="space-y-2.5">
                    {client.website && <div className="flex items-center gap-2 text-[12px] text-mt-ink-2"><Globe size={13} className="text-mt-ink-4" /><a href={client.website} target="_blank" rel="noopener" className="hover:text-primary transition-colors">{client.website}</a></div>}
                    {client.address && <div className="flex items-center gap-2 text-[12px] text-mt-ink-2"><MapPin size={13} className="text-mt-ink-4" /><span>{client.address}</span></div>}
                    <div className="flex items-center gap-2 text-[12px] text-mt-ink-2"><Building2 size={13} className="text-mt-ink-4" /><span>{client.industry || "—"}{client.companySize ? ` · ${client.companySize} employees` : ""}</span></div>
                    {client.pocEmail && (
                      <div className="flex items-center gap-2 text-[12px] text-mt-ink-2">
                        <Mail size={13} className="text-mt-ink-4" />
                        <a href={`mailto:${client.pocEmail}`} className="hover:text-primary transition-colors">{client.pocEmail}</a>
                        <span className="text-[10px] text-mt-ink-4">· Webstore POC</span>
                      </div>
                    )}
                  </div>
                </div>
                {/* Stores Section */}
                {client.stores && client.stores.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-3">Webstores</p>
                    <div className="space-y-2">
                      {client.stores.map((store: { id: number; name: string; slug: string; status?: string; primaryColor: string | null }) => (
                        <div key={store.id} className="flex items-center justify-between p-3 rounded-lg border border-[#F0F0F0] hover:border-primary transition-colors group">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: store.primaryColor || 'var(--mt-brand)' }}>
                              <Store size={14} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-mt-ink truncate">{store.name}</p>
                              <p className="text-[10px] text-mt-ink-4">{store.slug} · {store.status}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => window.open(`/s/${store.slug}`, '_blank')}
                              className="px-2.5 py-1 text-[11px] font-semibold text-primary bg-mt-brand-light rounded-md hover:bg-[#EDE9FE] transition-colors flex items-center gap-1"
                            >
                              <Eye size={12} />Visit Store
                            </button>
                            <button
                              onClick={() => navigate(`/store-management/${store.id}`)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-mt-ink-2 bg-mt-surface-2 rounded-md hover:bg-[#E5E5E5] transition-colors flex items-center gap-1"
                            >
                              <Edit3 size={12} />Manage
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {client.notes && (
                  <div>
                    <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-2">Notes</p>
                    <p className="text-[13px] text-mt-ink-2 leading-relaxed bg-mt-surface rounded-lg p-3">{client.notes}</p>
                  </div>
                )}
                {client.logos && client.logos.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-3">Brand Logos</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {client.logos.map((logo: { id: number; logoUrl: string; logoName: string }) => (
                        <div key={logo.id} className="aspect-square rounded-lg border border-mt-border bg-white flex items-center justify-center p-2 hover:border-primary transition-colors">
                          <img src={logo.logoUrl} alt={logo.logoName} className="w-full h-full object-contain" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-6 text-[11px] text-mt-ink-4">
                  <span>Created {formatDate(client.createdAt)}</span>
                  <span>Updated {formatDate(client.updatedAt)}</span>
                </div>
              </div>
            )}

            {activeTab === "proposals" && (
              <div className="space-y-2">
                {client.proposals.length === 0 ? (
                  <div className="text-center py-10"><FileText size={32} className="mx-auto mb-3 text-[#E5E5E5]" /><p className="text-[13px] text-mt-ink-4">No proposals yet</p></div>
                ) : client.proposals.map((p: { id: number; title: string; createdAt: Date; estimatedValue: string | null; status: string }) => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-mt-surface transition-colors border border-[#F0F0F0]">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-mt-ink truncate">{p.title}</p>
                      <p className="text-[11px] text-mt-ink-4">{formatDate(p.createdAt)} · {formatCurrency(p.estimatedValue)}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${p.status === "sent" ? "bg-[#DBEAFE] text-[#2563EB]" : p.status === "accepted" ? "bg-[#F0FDF4] text-[#16A34A]" : p.status === "draft" ? "bg-mt-surface-2 text-mt-ink-3" : "bg-[#FEE2E2] text-[#DC2626]"}`}>{p.status}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "orders" && (
              <div className="space-y-2">
                {client.orders.length === 0 ? (
                  <div className="text-center py-10"><ShoppingCart size={32} className="mx-auto mb-3 text-[#E5E5E5]" /><p className="text-[13px] text-mt-ink-4">No orders yet</p></div>
                ) : client.orders.map((o: { id: number; orderNumber: string; createdAt: Date; total: string | null; status: string }) => (
                  <div key={o.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-mt-surface transition-colors border border-[#F0F0F0]">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-mt-ink">#{o.orderNumber}</p>
                      <p className="text-[11px] text-mt-ink-4">{formatDate(o.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-semibold text-mt-ink">{formatCurrency(o.total)}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${o.status === "delivered" ? "bg-[#F0FDF4] text-[#16A34A]" : o.status === "shipped" ? "bg-[#DBEAFE] text-[#2563EB]" : o.status === "pending" ? "bg-[#FEF3C7] text-[#D97706]" : "bg-mt-surface-2 text-mt-ink-3"}`}>{o.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "assets" && (
              <div>
                <button onClick={() => setShowAssetUpload(true)} className="w-full flex items-center justify-center gap-2 py-3 mb-4 border-2 border-dashed border-mt-border rounded-xl text-[13px] font-medium text-mt-ink-3 hover:border-primary hover:text-primary hover:bg-[#FAFAFE] transition-all">
                  <Upload size={16} />Upload New Asset
                </button>
                {client.assets.length === 0 ? (
                  <div className="text-center py-10">
                    <FolderOpen size={32} className="mx-auto mb-3 text-[#E5E5E5]" />
                    <p className="text-[13px] text-mt-ink-4">No assets uploaded yet</p>
                    <p className="text-[11px] text-[#C4C4C4] mt-1">Upload logos, brand guides, artwork, and documents</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {client.assets.map((asset: { id: number; fileName: string; fileUrl: string; fileType: string | null; fileSize: number | null; category: string; description: string | null; createdAt: Date }) => {
                      const isImage = asset.fileType?.startsWith("image/");
                      const catInfo = ASSET_CATEGORIES.find((c) => c.value === asset.category);
                      const CatIcon = catInfo?.icon || File;
                      return (
                        <div key={asset.id} className="flex items-center gap-3 p-3 rounded-lg border border-[#F0F0F0] hover:border-mt-border transition-colors group">
                          <div className="w-12 h-12 rounded-lg bg-mt-surface border border-mt-border flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {isImage ? <img src={asset.fileUrl} alt={asset.fileName} className="w-full h-full object-cover rounded-lg" /> : <CatIcon size={20} className="text-mt-ink-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-mt-ink truncate">{asset.fileName}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-mt-brand-light text-primary">{catInfo?.label || "Other"}</span>
                              <span className="text-[10px] text-mt-ink-4">{formatFileSize(asset.fileSize)}</span>
                              <span className="text-[10px] text-mt-ink-4">{formatDate(asset.createdAt)}</span>
                            </div>
                            {asset.description && <p className="text-[11px] text-mt-ink-4 mt-0.5 truncate">{asset.description}</p>}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <a href={asset.fileUrl} target="_blank" rel="noopener" className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-mt-brand-light text-mt-ink-4 hover:text-primary transition-colors" title="View"><Eye size={14} /></a>
                            <a href={asset.fileUrl} download={asset.fileName} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-mt-brand-light text-mt-ink-4 hover:text-primary transition-colors" title="Download"><Download size={14} /></a>
                            <button onClick={() => deleteAsset.mutate({ id: asset.id })} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#FEE2E2] text-mt-ink-4 hover:text-[#DC2626] transition-colors" title="Delete"><Trash2 size={14} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "products" && (
              <ClientProductsTab
                clientId={clientId}
                onSetPricing={(productId, productName) => setPricingTarget({ productId, productName })}
              />
            )}
          </div>
        </div>
      </div>
      <AssetUploadModal open={showAssetUpload} onClose={() => setShowAssetUpload(false)} clientId={clientId} onSuccess={() => refetch()} />
      {pricingTarget && (
        <PriceMatrixModal
          open={true}
          onClose={() => setPricingTarget(null)}
          clientId={clientId}
          productId={pricingTarget.productId}
          productName={pricingTarget.productName}
        />
      )}
    </>
  );
}

//  Main Clients Page 
export default function Clients() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Deep-link `?new=true` opens the Add Client modal on mount (Dashboard
  // quick-action entry point). Deep-link `?clientId=42` opens the detail
  // panel for a specific client (Agent Inbox detail-view "View Client"
  // action). Strip the params after applying so reloading doesn't replay
  // the deep-link.
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    let mutated = false;
    if (params.get("new") === "true") {
      setShowAddModal(true);
      params.delete("new");
      mutated = true;
    }
    const clientIdParam = params.get("clientId");
    if (clientIdParam) {
      const id = Number.parseInt(clientIdParam, 10);
      if (Number.isFinite(id) && id > 0) {
        setSelectedClientId(id);
      }
      params.delete("clientId");
      mutated = true;
    }
    if (mutated) {
      const qs = params.toString();
      navigate(qs ? `/clients?${qs}` : "/clients", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [editClientId, setEditClientId] = useState<number | null>(null);
  const [deleteClientId, setDeleteClientId] = useState<number | null>(null);
  const [deleteRelatedMsg, setDeleteRelatedMsg] = useState("");

  const { data: clientsList, isLoading } = trpc.clients.list.useQuery({ search: searchQuery || undefined });
  const { data: stats } = trpc.clients.stats.useQuery();
  const utils = trpc.useUtils();

  const createClient = trpc.clients.create.useMutation({
    onSuccess: () => { utils.clients.list.invalidate(); utils.clients.stats.invalidate(); toast.success("Client added"); setShowAddModal(false); },
    onError: (err) => toast.error(err.message),
  });

  const updateClient = trpc.clients.update.useMutation({
    onSuccess: () => { utils.clients.list.invalidate(); utils.clients.stats.invalidate(); utils.clients.getById.invalidate(); toast.success("Client updated"); setEditClientId(null); },
    onError: (err) => toast.error(err.message),
  });

  const deleteClient = trpc.clients.delete.useMutation({
    onSuccess: () => { utils.clients.list.invalidate(); utils.clients.stats.invalidate(); toast.success("Client deleted"); setDeleteClientId(null); setSelectedClientId(null); },
    onError: (err) => {
      if (err.data?.code === "PRECONDITION_FAILED") { setDeleteRelatedMsg(err.message); }
      else { toast.error(err.message); }
    },
  });

  const clients = (clientsList && 'items' in clientsList ? clientsList.items : null) ?? [];

  const filteredClients = useMemo(() => {
    return clients.filter((c: { status?: string }) => {
      return statusFilter === "All" || c.status === statusFilter.toLowerCase();
    });
  }, [clients, statusFilter]);

  const totalPages = Math.ceil(filteredClients.length / ROWS_PER_PAGE);
  const paginatedClients = filteredClients.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
  const editingClient = editClientId ? clients.find((c: { id: number }) => c.id === editClientId) : null;
  const deleteTargetClient = deleteClientId ? clients.find((c: { id: number }) => c.id === deleteClientId) : null;

  return (
    <DashboardLayout title="Clients" subtitle="Manage your client relationships">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Clients", value: stats?.total ?? 0, icon: Users, color: 'var(--mt-brand)', bg: "#F5F3FF" },
          { label: "Active", value: stats?.active ?? 0, icon: Building2, color: "#16A34A", bg: "#F0FDF4" },
          { label: "Prospects", value: stats?.prospects ?? 0, icon: UserPlus, color: "#D97706", bg: "#FEF3C7" },
          { label: "Total Revenue", value: formatCurrency(stats?.totalRevenue ?? 0), icon: TrendingUp, color: "#3B82F6", bg: "#EFF6FF" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-mt-border px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: stat.bg }}>
              <stat.icon size={18} style={{ color: stat.color }} />
            </div>
            <div>
              <p className="text-[20px] font-bold text-mt-ink">{stat.value}</p>
              <p className="text-[11px] text-mt-ink-4 font-medium">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Header row */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-mt-brand-light text-primary">{stats?.active ?? 0} Active</span>
          <span className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-[#FEF3C7] text-[#D97706]">{stats?.prospects ?? 0} Prospects</span>
          {(stats?.inactive ?? 0) > 0 && <span className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-mt-surface-2 text-mt-ink-3">{stats?.inactive ?? 0} Inactive</span>}
        </div>
        <button onClick={() => setShowAddModal(true)} className="sq-action-btn primary flex items-center gap-2 active:scale-[0.97]"><Plus size={14} /> Add Client</button>
      </div>

      {/* Search and filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mt-ink-4" />
          <input
            className="w-full pl-10 pr-4 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-[#C4C4C4]"
            placeholder="Search clients by name, email, or industry..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={13} className="text-mt-ink-4" />
          {["All", "Active", "Prospect", "Inactive"].map((t) => (
            <button key={t} className={`text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors ${statusFilter === t ? "bg-[#1A1A1A] text-white" : "bg-mt-surface-2 text-mt-ink-3 hover:bg-[#EBEBEB]"}`} onClick={() => { setStatusFilter(t); setCurrentPage(1); }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-mt-border overflow-hidden">
        {isLoading ? (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
                {["Company", "Contact", "Industry", "Proposals", "Orders", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => <ClientsSkeletonRow key={i} />)}
            </tbody>
          </table>
        ) : filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${searchQuery ? "bg-mt-surface-2" : "bg-mt-brand-light"}`}>
              {searchQuery ? <Search size={22} className="text-mt-ink-4" /> : <Users size={24} className="text-primary" />}
            </div>
            <p className="text-[14px] font-semibold text-mt-ink mb-1">{searchQuery ? "No clients match your filters" : "No clients added"}</p>
            <p className="text-[12px] text-mt-ink-3 mb-4">{searchQuery ? "Try a different search term" : "Add your first client to get started"}</p>
            {searchQuery ? (
              <button onClick={() => setSearchQuery("")} className="text-[12px] font-semibold text-primary hover:underline transition-colors duration-150">Clear filters</button>
            ) : (
              <button onClick={() => setShowAddModal(true)} className="sq-action-btn primary flex items-center gap-2 active:scale-[0.97]"><Plus size={14} /> Add Client</button>
            )}
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
                  {["Company", "Contact", "Industry", "Proposals", "Orders", "Status", ""].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedClients.map((client: { id: number; companyName: string; contactName: string; contactEmail: string; website: string | null; industry: string | null; status: string | null; proposalCount: number; orderCount: number }, i: number) => {
                  const si = STATUS_COLORS[client.status ?? "prospect"] || STATUS_COLORS.prospect;
                  return (
                    <motion.tr
                      key={client.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: Math.min(i, 15) * 0.03 }}
                      className="hover:bg-mt-surface transition-colors duration-150 cursor-pointer"
                      style={{ borderBottom: i < paginatedClients.length - 1 ? "1px solid #F5F5F5" : "none" }}
                      onClick={() => setSelectedClientId(client.id)}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-mt-brand-light flex items-center justify-center text-[11px] font-bold text-primary flex-shrink-0">{client.companyName.slice(0, 2).toUpperCase()}</div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-mt-ink truncate">{client.companyName}</p>
                            {client.website && <p className="text-[10px] text-mt-ink-4 truncate">{client.website.replace(/^https?:\/\//, "")}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-[13px] text-mt-ink">{client.contactName}</p>
                        <p className="text-[11px] text-mt-ink-4">{client.contactEmail}</p>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-mt-ink-2">{client.industry || "—"}</td>
                      <td className="px-5 py-3.5 text-[13px] text-mt-ink-2 text-center">{client.proposalCount || 0}</td>
                      <td className="px-5 py-3.5 text-[13px] text-mt-ink-2 text-center">{client.orderCount || 0}</td>
                      <td className="px-5 py-3.5"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: si.bg, color: si.text }}>{si.label}</span></td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setEditClientId(client.id); }} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-mt-brand-light text-mt-ink-4 hover:text-primary transition-colors" title="Edit"><Edit3 size={13} /></button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteClientId(client.id); setDeleteRelatedMsg(""); }} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#FEE2E2] text-mt-ink-4 hover:text-[#DC2626] transition-colors" title="Delete"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-[#F0F0F0]">
                <p className="text-[11px] text-mt-ink-4">Showing {(currentPage - 1) * ROWS_PER_PAGE + 1}–{Math.min(currentPage * ROWS_PER_PAGE, filteredClients.length)} of {filteredClients.length}</p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-mt-surface-2 disabled:opacity-30 text-mt-ink-3"><ChevronLeft size={14} /></button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button key={p} onClick={() => setCurrentPage(p)} className={`w-8 h-8 flex items-center justify-center rounded-md text-[12px] font-medium transition-colors ${currentPage === p ? "bg-primary text-white" : "text-mt-ink-3 hover:bg-mt-surface-2"}`}>{p}</button>
                  ))}
                  <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-mt-surface-2 disabled:opacity-30 text-mt-ink-3"><ChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Client Modal */}
      <ClientFormModal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add New Client" isLoading={createClient.isPending} onSubmit={(data) => createClient.mutate({ ...data, pocEmail: data.pocEmail || undefined })} />

      {/* Edit Client Modal */}
      {editingClient && (
        <ClientFormModal
          open={!!editClientId}
          onClose={() => setEditClientId(null)}
          title="Edit Client"
          isLoading={updateClient.isPending}
          initialData={{
            companyName: editingClient.companyName,
            industry: editingClient.industry || "",
            companySize: editingClient.companySize || "",
            website: editingClient.website || "",
            address: editingClient.address || "",
            contactName: editingClient.contactName,
            contactTitle: editingClient.contactTitle || "",
            contactEmail: editingClient.contactEmail,
            contactPhone: editingClient.contactPhone || "",
            pocEmail: editingClient.pocEmail || "",
            status: editingClient.status as "active" | "inactive" | "prospect",
            notes: editingClient.notes || "",
          }}
          onSubmit={(data) => updateClient.mutate({ id: editClientId!, ...data, pocEmail: data.pocEmail || undefined })}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteModal
        open={!!deleteClientId}
        onClose={() => { setDeleteClientId(null); setDeleteRelatedMsg(""); }}
        clientName={deleteTargetClient?.companyName || ""}
        isLoading={deleteClient.isPending}
        hasRelated={!!deleteRelatedMsg}
        relatedMessage={deleteRelatedMsg}
        onConfirm={(force) => { if (deleteClientId) deleteClient.mutate({ id: deleteClientId, force }); }}
      />

      {/* Client Detail Slide-Over */}
      {selectedClientId && (
        <ClientDetail
          clientId={selectedClientId}
          onClose={() => setSelectedClientId(null)}
          onEdit={() => setEditClientId(selectedClientId)}
          onDelete={() => { setDeleteClientId(selectedClientId); setDeleteRelatedMsg(""); }}
        />
      )}
    </DashboardLayout>
  );
}
