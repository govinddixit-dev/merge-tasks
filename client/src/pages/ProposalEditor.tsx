/**
 * Proposal Editor — Fully Integrated
 * - Real send flow via trpc.proposals.send
 * - Proposal type, delivery method, valid days, approval routing
 * - Real DB product search (trpc.products.list)
 * - Virtual proofing studio handoff
 * - Email preview modal
 * - Multi-department approval integration with DB
 * - Albert Sans typography, premium minimalist
 *
 * Large sub-panels extracted to client/src/components/proposal/
 */

import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import {
  ArrowLeft, Save, Send, Eye, Plus, Minus, Trash2, Check, X,
  CreditCard, Users, FileText, Package, Sparkles,
  CheckCircle2, Clock, AlertCircle, Search, History,
  RotateCcw, ChevronRight, ExternalLink, Loader2, Mail, Globe,
  ArrowRightLeft, Shield, MailOpen, CheckCircle, XCircle,
  UserPlus, Building2, DollarSign,
} from "lucide-react";
import PriceMatrixModal from "@/components/curation/PriceMatrixModal";
import { toast } from "sonner";
import { useLocation, useParams, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { humanizeEmailMethod } from "@/lib/emailMethod";
import { CatalogConfigPanel } from "@/components/CatalogConfigPanel";
import {
  ProposalPreviewMode,
  ProposalProofingPanel,
  ProposalProductSearchModal,
  ProposalSendConfirmModal,
  ProposalEmailPreviewModal,
} from "@/components/proposal";
import type { PreviewProduct, OrderItem } from "@/components/proposal";
import type { RouterOutput } from "@/lib/trpc";

type DbStore = RouterOutput["stores"]["list"]["items"][number];
type DbProduct = RouterOutput["products"]["list"]["items"][number];
type DeptApproval = RouterOutput["departmentApprovals"]["listByProposal"][number];
type ProposalVersion = RouterOutput["proposals"]["listVersions"][number];

/*  Types  */
interface Product {
  name: string; sku: string; qty: number; price: number; decoration: string | string[];
  imageUrl?: string; proofUrl?: string; proofStatus?: "none" | "generating" | "ready";
  dbProductId?: number;
}

interface Department {
  name: string; contact: string; email: string; enabled: boolean;
  dbId?: number; status?: "pending" | "approved" | "rejected"; emailSentAt?: string | Date | null;
}

function getPreviewProduct(editorProduct: Product): PreviewProduct {
  const decoration = Array.isArray(editorProduct.decoration) ? editorProduct.decoration.join(", ") : editorProduct.decoration;
  return {
    id: editorProduct.dbProductId ?? 0,
    name: editorProduct.name,
    price: editorProduct.price,
    category: "General",
    image: editorProduct.imageUrl || "",
    colors: ["Default"],
    sizes: ["One Size"],
    logoPositions: ["Center"],
    stock: 0,
    sku: editorProduct.sku,
    tags: [],
    description: "",
    shippingInfo: "Contact for shipping details.",
    decoration,
  };
}

const validDaysOptions = [
  { value: 15, label: "15 Days" }, { value: 30, label: "30 Days" }, { value: 45, label: "45 Days" },
  { value: 60, label: "60 Days" }, { value: 90, label: "90 Days" }, { value: 0, label: "No Expiration" },
];

/*  */
export default function ProposalEditor() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const searchString = useSearch();
  const proposalId = parseInt(params?.id || "0", 10);
  const startInPreview = new URLSearchParams(searchString).get("preview") === "1";
  const returnFromProofing = new URLSearchParams(searchString).get("returnFromProofing") === "1";
  const utils = trpc.useUtils();

  /*  tRPC queries  */
  const { data: proposalData, isLoading, error } = trpc.proposals.getById.useQuery({ id: proposalId }, { enabled: proposalId > 0 });
  const { data: _dbProductsRaw } = trpc.products.list.useQuery(undefined, { staleTime: 60000 });
  const dbProducts = _dbProductsRaw?.items ?? [];
  const { data: dbDeptApprovals, refetch: refetchDeptApprovals } = trpc.departmentApprovals.listByProposal.useQuery({ proposalId }, { enabled: proposalId > 0 });
  const { data: _dbStoresRaw } = trpc.stores.list.useQuery(undefined, { staleTime: 60000 });
  const dbStores = _dbStoresRaw?.items ?? [];
  const { data: versionHistory, refetch: refetchVersions } = trpc.proposals.listVersions.useQuery({ proposalId }, { enabled: proposalId > 0 });
  const { data: _dbClientsRaw } = trpc.clients.list.useQuery(undefined, { staleTime: 60000 });
  const dbClients = (_dbClientsRaw && 'items' in _dbClientsRaw ? _dbClientsRaw.items : null) ?? [];

  /*  tRPC mutations  */
  const createClientMutation = trpc.clients.create.useMutation({
    onSuccess: (newClient) => {
      toast.success(`Client "${newClient.companyName}" created!`);
      setClient(newClient.companyName); setClientContact(newClient.contactName); setClientEmail(newClient.contactEmail);
      setClientMode("existing");
      setNewClientCompany(""); setNewClientName(""); setNewClientEmail(""); setNewClientPhone(""); setNewClientIndustry(""); setNewClientTitle("");
      utils.clients.list.invalidate();
    },
    onError: (err) => toast.error(`Failed to create client — ${err.message}`),
  });

  const revertMutation = trpc.proposals.revertToVersion.useMutation({
    onSuccess: () => { toast.success("Reverted to previous version"); utils.proposals.getById.invalidate({ id: proposalId }); refetchVersions(); setInitialized(false); },
    onError: (err) => toast.error(`Failed to revert — ${err.message}`),
  });

  const updateMutation = trpc.proposals.update.useMutation({
    onSuccess: () => { toast.success("Draft saved — All changes have been saved"); setHasChanges(false); setSaving(false); refetchVersions(); },
    onError: (err) => { toast.error(`Failed to save — ${err.message}`); setSaving(false); },
  });

  const sendMutation = trpc.proposals.send.useMutation({
    onSuccess: (data) => {
      toast.success(`Proposal sent! — ${data.emailSent ? `Sent to ${clientEmail} via ${humanizeEmailMethod(data.emailMethod)}` : "Proposal marked as sent. Email delivery pending."}`);
      if (multiDept && departments.filter(d => d.enabled && d.email).length > 0) sendDeptEmailsMutation.mutate({ proposalId, origin: window.location.origin });
      utils.proposals.getById.invalidate({ id: proposalId }); utils.proposals.list.invalidate(); refetchDeptApprovals();
      setTimeout(() => navigate("/proposals"), 2000);
    },
    onError: (err) => { toast.error(`Failed to send — ${err.message}`); setSending(false); },
  });

  const sendDeptEmailsMutation = trpc.departmentApprovals.sendEmails.useMutation({
    onSuccess: (data) => { toast.success(`Department emails sent — ${data.sentCount}/${data.totalWithEmail} emails delivered`); refetchDeptApprovals(); },
    onError: (err) => toast.error(`Failed to send department emails — ${err.message}`),
  });

  const emailPreviewMutation = trpc.proposals.emailPreview.useMutation({
    onSuccess: (data) => { setEmailPreviewHtml(data.html); setEmailPreviewSubject(data.subject); setShowEmailPreview(true); },
    onError: (err) => toast.error(`Failed to generate preview — ${err.message}`),
  });

  const createDeptBatchMutation = trpc.departmentApprovals.createBatch.useMutation({ onSuccess: () => refetchDeptApprovals() });

  /*  Editable state  */
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [multiDept, setMultiDept] = useState(false);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [newClientCompany, setNewClientCompany] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientIndustry, setNewClientIndustry] = useState("");
  const [newClientTitle, setNewClientTitle] = useState("");
  const [proposalType, setProposalType] = useState<"promo" | "print" | "promo_print">("promo_print");
  const [deliveryMethod, setDeliveryMethod] = useState<"email" | "webstore" | "both">("email");
  const [validDays, setValidDays] = useState(30);
  const [approvalRouting, setApprovalRouting] = useState<"parallel" | "sequential">("parallel");

  /*  UI state  */
  const [showProductModal, setShowProductModal] = useState(false);
  /**
   * When non-null, the Price Matrix modal is open for this specific product.
   * Only products with a resolved `dbProductId` can have client pricing configured,
   * so the trigger button is disabled for ad-hoc rows that haven't been linked
   * to a catalog product yet.
   */
  const [priceMatrixProduct, setPriceMatrixProduct] = useState<
    { productId: number; productName: string; productImageUrl?: string | null } | null
  >(null);
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("All");
  const [showAddDept, setShowAddDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptContact, setNewDeptContact] = useState("");
  const [newDeptEmail, setNewDeptEmail] = useState("");
  const [previewMode, setPreviewMode] = useState(startInPreview);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState("");
  const [emailPreviewSubject, setEmailPreviewSubject] = useState("");
  const [proofingOpen, setProofingOpen] = useState(true);
  const [selectedProofProduct, setSelectedProofProduct] = useState<number>(0);
  const [proofGenerating, setProofGenerating] = useState(false);
  const [proofHistory, setProofHistory] = useState<{ product: string; timestamp: string; status: string }[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proofingReturnHandled, setProofingReturnHandled] = useState(false);

  /*  Preview mode state  */
  const pvProducts = products.map(getPreviewProduct).filter(pp => pp.image);
  const [pvSelected, setPvSelected] = useState<PreviewProduct | null>(null);
  const [pvActiveTab, setPvActiveTab] = useState<"price" | "size">("price");
  const [pvInfoTab, setPvInfoTab] = useState<"product" | "additional">("product");
  const [pvColor, setPvColor] = useState("");
  const [pvSize, setPvSize] = useState("");
  const [pvLogo, setPvLogo] = useState("");
  const [pvQty, setPvQty] = useState(1);
  const [pvOrderItems, setPvOrderItems] = useState<OrderItem[]>([]);
  const [pvShowSummary, setPvShowSummary] = useState(false);
  const [pvMessage, setPvMessage] = useState("");

  const selectCls = "h-9 px-3 text-[12px] border border-mt-border rounded-md outline-none focus:border-primary bg-white text-mt-ink-2 font-medium w-full";

  /*  Derived  */
  const clientHasWebstore = useMemo(() => {
    if (!proposalData?.clientId || !dbStores) return false;
    return dbStores.some((s: DbStore) => s.clientId === proposalData.clientId);
  }, [proposalData?.clientId, dbStores]);

  const dbProductCategories = useMemo(() => {
    if (!dbProducts) return ["All"];
    const cats = Array.from(new Set(dbProducts.map((p: DbProduct) => p.category).filter(Boolean)));
    return ["All", ...cats];
  }, [dbProducts]);

  const filteredDbProducts = useMemo(() => {
    if (!dbProducts) return [];
    return dbProducts.filter((p: DbProduct) =>
      !products.some(ep => ep.dbProductId === p.id) &&
      (productCategory === "All" || p.category === productCategory) &&
      (p.name?.toLowerCase().includes(productSearch.toLowerCase()) || p.sku?.toLowerCase().includes(productSearch.toLowerCase()))
    );
  }, [dbProducts, products, productCategory, productSearch]);

  const productTotal = products.reduce((sum, p) => sum + p.qty * p.price, 0);
  const totalUnits = products.reduce((sum, p) => sum + p.qty, 0);
  const displayId = proposalId > 0 ? `P-${1100 + proposalId}` : "";

  /*  Initialize from DB  */
  useEffect(() => {
    if (proposalData && !initialized) {
      setTitle(proposalData.title || "");
      setClient(proposalData.client?.companyName || "");
      setClientContact(proposalData.client?.contactName || "");
      setClientEmail(proposalData.client?.contactEmail || "");
      setBudget(proposalData.estimatedValue ? `$${Number(proposalData.estimatedValue).toLocaleString()}` : "");
      setNotes(proposalData.notes || "");
      setMultiDept(proposalData.multiDepartment || false);
      setStripeEnabled(proposalData.stripeCheckout || false);
      setProposalType((proposalData.proposalType as "promo" | "print" | "promo_print") || "promo_print");
      setDeliveryMethod((proposalData.deliveryMethod as "email" | "webstore" | "both") || "email");
      setValidDays(proposalData.validDays ?? 30);
      setApprovalRouting((proposalData.approvalRouting as "parallel" | "sequential") || "parallel");
      const editorProducts: Product[] = (proposalData.products || []).map((pp) => ({
        name: pp.product?.name || "Unknown Product", sku: pp.product?.sku ?? "",
        qty: pp.quantity || 1,
        price: pp.unitPrice ? Number(pp.unitPrice) : (pp.product?.basePrice ? Number(pp.product.basePrice) : 0),
        decoration: pp.decorationType || (Array.isArray(pp.product?.decorationMethods) ? pp.product.decorationMethods.join(", ") : (pp.product?.decorationMethods || "Standard")),
        imageUrl: pp.product?.imageUrl || undefined,
        proofStatus: pp.proof?.status === "approved" ? "ready" as const : "none" as const,
        proofUrl: pp.proof?.proofImageUrl || undefined, dbProductId: pp.productId,
      }));
      setProducts(editorProducts);
      setInitialized(true);
      setTimeout(() => setHasChanges(false), 0);
    }
  }, [proposalData, initialized]);

  useEffect(() => {
    if (dbDeptApprovals && dbDeptApprovals.length > 0 && initialized) {
      setDepartments(dbDeptApprovals.map((da: DeptApproval) => ({ name: da.departmentName, contact: da.contactName || "", email: da.contactEmail || "", enabled: true, dbId: da.id, status: da.status || "pending", emailSentAt: da.emailSentAt })));
    }
  }, [dbDeptApprovals, initialized]);

  useEffect(() => {
    if (returnFromProofing && initialized && !proofingReturnHandled) {
      setProofingReturnHandled(true);
      toast.success("Returned from Proofing Studio — Your proposal has been restored. Proof statuses are updated.");
      utils.proposals.getById.invalidate({ id: proposalId });
      const url = new URL(window.location.href);
      url.searchParams.delete("returnFromProofing");
      window.history.replaceState({}, "", url.toString());
    }
  }, [returnFromProofing, initialized, proofingReturnHandled]);

  useEffect(() => {
    if (previewMode && pvProducts.length > 0 && !pvSelected) {
      const first = pvProducts[0];
      setPvSelected(first); setPvColor(first.colors[0]); setPvSize(first.sizes[0]); setPvLogo(first.logoPositions[0]);
    }
  }, [previewMode, pvProducts.length]);

  useEffect(() => {
    if (initialized) setHasChanges(true);
  }, [title, client, clientContact, clientEmail, budget, notes, multiDept, stripeEnabled, products, departments, proposalType, deliveryMethod, validDays, approvalRouting]);

  /*  Handlers  */
  const buildProductsPayload = () => products.filter(p => p.dbProductId).map(p => ({ productId: p.dbProductId!, quantity: p.qty, unitPrice: p.price.toFixed(2), decorationType: Array.isArray(p.decoration) ? p.decoration.join(", ") : (p.decoration || "Standard") }));

  const handleSave = () => {
    setSaving(true);
    updateMutation.mutate({ id: proposalId, title, notes, multiDepartment: multiDept, stripeCheckout: stripeEnabled, estimatedValue: productTotal.toFixed(2), proposalType, deliveryMethod, validDays, approvalRouting, products: buildProductsPayload() });
  };

  const handleSendToClient = (contactIds: number[]) => {
    setSending(true);
    updateMutation.mutate({ id: proposalId, title, notes, multiDepartment: multiDept, stripeCheckout: stripeEnabled, estimatedValue: productTotal.toFixed(2), proposalType, deliveryMethod, validDays, approvalRouting, products: buildProductsPayload() }, {
      onSuccess: () => {
        const enabledDepts = departments.filter(d => d.enabled);
        sendMutation.mutate({
          id: proposalId,
          origin: window.location.origin,
          contactIds: contactIds.length > 0 ? contactIds : undefined,
          departments: multiDept ? enabledDepts.map(d => ({ name: d.name, contact: d.contact || undefined, email: d.email || undefined })) : undefined,
        });
      },
      onError: () => { setSending(false); toast.error("Failed to save before sending"); },
    });
  };

  const handleOpenProofingStudio = () => {
    const productIds = products.filter(p => p.dbProductId).map(p => p.dbProductId).join(",");
    navigate(`/virtual-proofing?proposalId=${proposalId}&clientId=${proposalData?.clientId || ""}&productIds=${productIds}&return=edit-proposal`);
  };

  const handleEmailPreview = () => {
    emailPreviewMutation.mutate({ proposalTitle: title, clientName: clientContact, clientCompany: client, estimatedValue: productTotal.toFixed(2), validDays, stripeCheckout: stripeEnabled, multiDepartment: multiDept, notes, products: products.map(p => ({ name: p.name, quantity: p.qty, unitPrice: p.price.toFixed(2), decorationType: Array.isArray(p.decoration) ? p.decoration.join(", ") : (p.decoration || null), imageUrl: p.imageUrl || null, proofImageUrl: p.proofUrl || null, proofStatus: p.proofStatus === "ready" ? "approved" : null })) });
  };

  const removeProduct = (index: number) => { setProducts(products.filter((_, i) => i !== index)); toast.success("Product removed"); };
  const updateQty = (index: number, delta: number) => { const updated = [...products]; updated[index] = { ...updated[index], qty: Math.max(1, updated[index].qty + delta) }; setProducts(updated); };

  const addProductFromDB = (product: { id: number; name: string; sku?: string | null; basePrice?: string | number | null; imageUrl?: string | null; decorationMethods?: string | string[] | null }) => {
    const decoration = Array.isArray(product.decorationMethods)
      ? product.decorationMethods.join(", ")
      : (product.decorationMethods || "Standard");
    setProducts([...products, { name: product.name, sku: product.sku || "", qty: 25, price: product.basePrice ? Number(product.basePrice) : 0, decoration, imageUrl: product.imageUrl || undefined, proofStatus: "none", dbProductId: product.id }]);
    setShowProductModal(false); setProductSearch(""); setProductCategory("All");
    toast.success(`${product.name} added to proposal`);
  };

  const addDepartment = () => {
    if (!newDeptName.trim()) return;
    setDepartments([...departments, { name: newDeptName, contact: newDeptContact, email: newDeptEmail, enabled: true, status: "pending" }]);
    setNewDeptName(""); setNewDeptContact(""); setNewDeptEmail(""); setShowAddDept(false);
    toast.success("Department added");
  };

  const removeDepartment = (index: number) => setDepartments(departments.filter((_, i) => i !== index));
  const handleResendDeptEmails = () => sendDeptEmailsMutation.mutate({ proposalId, origin: window.location.origin });

  const pvSelectProduct = (p: PreviewProduct) => { setPvSelected(p); setPvColor(p.colors[0]); setPvSize(p.sizes[0]); setPvLogo(p.logoPositions[0]); setPvQty(1); setPvActiveTab("price"); setPvInfoTab("product"); setPvMessage(""); };
  const pvAddToList = () => { if (!pvSelected) return; setPvOrderItems(prev => [...prev, { product: pvSelected, qty: pvQty, color: pvColor, size: pvSize, logoPos: pvLogo }]); toast.success(`${pvSelected.name} added to order list`); };
  const pvAddAllToList = () => { const items = pvProducts.map(p => ({ product: p, qty: 1, color: p.colors[0], size: p.sizes[0], logoPos: p.logoPositions[0] })); setPvOrderItems(items); toast.success(`All ${pvProducts.length} products added to order list`); };
  const pvRemoveItem = (idx: number) => setPvOrderItems(prev => prev.filter((_, i) => i !== idx));

  /*  Loading / Error states  */
  if (isLoading) {
    return (
      <DashboardLayout title="Proposals" subtitle="Edit proposal">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 size={32} className="text-primary animate-spin mb-4" />
          <p className="text-[13px] text-mt-ink-3">Loading proposal...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !proposalData) {
    return (
      <DashboardLayout title="Proposals" subtitle="Edit proposal">
        <div className="flex flex-col items-center justify-center py-20">
          <AlertCircle size={48} className="text-[#D4D4D4] mb-4" />
          <p className="text-[15px] font-semibold text-mt-ink-3">{error?.message === "Proposal not found" ? "Proposal not found" : "Failed to load proposal"}</p>
          <p className="text-[12px] text-[#A1A1AA] mt-1">{error?.message || "The proposal may have been deleted or you don't have access."}</p>
          <button onClick={() => navigate("/proposals")} className="mt-4 text-[13px] text-primary font-semibold hover:underline">Back to Proposals</button>
        </div>
      </DashboardLayout>
    );
  }

  /*  Preview Mode  */
  if (previewMode) {
    return (
      <ProposalPreviewMode
        title={title} clientContact={clientContact} clientEmail={clientEmail} validDays={validDays}
        pvProducts={pvProducts} pvSelected={pvSelected} pvActiveTab={pvActiveTab} pvInfoTab={pvInfoTab}
        pvColor={pvColor} pvSize={pvSize} pvLogo={pvLogo} pvQty={pvQty}
        pvOrderItems={pvOrderItems} pvShowSummary={pvShowSummary} pvMessage={pvMessage}
        selectCls={selectCls}
        onExitPreview={() => setPreviewMode(false)}
        onSelectProduct={pvSelectProduct}
        onAddToList={pvAddToList}
        onAddAllToList={pvAddAllToList}
        onRemoveItem={pvRemoveItem}
        onSetPvActiveTab={setPvActiveTab}
        onSetPvInfoTab={setPvInfoTab}
        onSetPvColor={setPvColor}
        onSetPvSize={setPvSize}
        onSetPvLogo={setPvLogo}
        onSetPvQty={setPvQty}
        onSetPvShowSummary={setPvShowSummary}
        onSetPvMessage={setPvMessage}
      />
    );
  }

  /*  Editor Mode  */
  return (
    <DashboardLayout title="Proposals" subtitle="Edit proposal">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-6">
        <button onClick={() => navigate("/proposals")} className="flex items-center gap-2 text-[13px] text-mt-ink-3 hover:text-mt-ink transition-colors">
          <ArrowLeft size={14} /> Back to Proposals
        </button>
        <div className="flex flex-wrap items-center gap-3">
          {hasChanges && <span className="text-[11px] text-[#F59E0B] font-semibold flex items-center gap-1"><AlertCircle size={12} /> Unsaved changes</span>}
          <button onClick={handleSave} disabled={saving || !hasChanges} className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold border border-mt-border text-[#3F3F46] hover:border-primary hover:text-primary transition-all disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {saving ? "Saving..." : "Save Draft"}
          </button>
          <button onClick={handleEmailPreview} disabled={emailPreviewMutation.isPending} className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold border border-mt-border text-[#3F3F46] hover:border-primary hover:text-primary transition-all disabled:opacity-50">
            <MailOpen size={13} /> {emailPreviewMutation.isPending ? "Loading..." : "Email Preview"}
          </button>
          <button onClick={() => setPreviewMode(true)} className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold border border-mt-border text-[#3F3F46] hover:border-primary hover:text-primary transition-all">
            <Eye size={13} /> Preview
          </button>
          <button onClick={() => setShowSendConfirm(true)} disabled={sending || sendMutation.isPending} className="flex items-center gap-2 px-5 py-2 text-[12px] font-semibold text-white transition-opacity disabled:opacity-50" style={{ backgroundColor: 'var(--mt-brand)' }}>
            {(sending || sendMutation.isPending) ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {(sending || sendMutation.isPending) ? "Sending..." : "Send to Client"}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: Editor */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Header Card */}
          <div className="bg-white border border-mt-border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 text-[10px] font-bold text-[#F59E0B] bg-[#FFFBEB] border border-[#FDE68A] tracking-wider uppercase">{proposalData.status === "draft" ? "Draft" : proposalData.status}</span>
                <span className="text-[11px] text-[#A1A1AA] font-mono">{displayId}</span>
              </div>
              <button onClick={() => setShowVersionHistory(!showVersionHistory)} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-mt-ink-3 border border-mt-border hover:border-primary hover:text-primary transition-all">
                <History size={12} /> Version History {versionHistory?.length ? `(${versionHistory.length})` : ""}
              </button>
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-[22px] font-bold text-mt-ink border-0 border-b-2 border-transparent hover:border-mt-border focus:border-primary focus:outline-none pb-1 transition-colors bg-transparent" placeholder="Proposal Title" style={{ fontFamily: "'Albert Sans', sans-serif" }} />

            {/* Client Mode Toggle */}
            <div className="flex items-center gap-2 mt-4 mb-3">
              <button onClick={() => setClientMode("existing")} className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-all border ${clientMode === "existing" ? "border-primary bg-mt-brand-light text-primary" : "border-mt-border text-mt-ink-3 hover:border-primary"}`}><Building2 size={12} /> Existing Client</button>
              <button onClick={() => setClientMode("new")} className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-all border ${clientMode === "new" ? "border-primary bg-mt-brand-light text-primary" : "border-mt-border text-mt-ink-3 hover:border-primary"}`}><UserPlus size={12} /> New Client</button>
            </div>

            {clientMode === "existing" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-1">Client</label><input value={client} onChange={(e) => setClient(e.target.value)} className="w-full px-3 py-2 text-[13px] font-semibold text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-transparent" /></div>
                <div><label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-1">Contact</label><input value={clientContact} onChange={(e) => setClientContact(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-transparent" /></div>
                <div><label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-1">Email</label><input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-transparent" /></div>
                <div><label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-1">Budget</label><input value={budget} onChange={(e) => setBudget(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-transparent" /></div>
              </div>
            ) : (
              <div className="border border-mt-border bg-mt-surface p-4">
                <div className="flex items-center gap-2 mb-3"><UserPlus size={14} className="text-primary" /><p className="text-[13px] font-semibold text-mt-ink">Create New Client</p></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-bold text-primary tracking-wider uppercase block mb-1">Company Name *</label><input value={newClientCompany} onChange={(e) => setNewClientCompany(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-white" placeholder="e.g., Acme Corp" /></div>
                  <div><label className="text-[10px] font-bold text-primary tracking-wider uppercase block mb-1">Contact Name *</label><input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-white" placeholder="e.g., Jane Smith" /></div>
                  <div><label className="text-[10px] font-bold text-primary tracking-wider uppercase block mb-1">Email *</label><input type="email" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-white" placeholder="e.g., jane@acme.com" /></div>
                  <div><label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-1">Phone</label><input value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-white" placeholder="e.g., (555) 123-4567" /></div>
                  <div><label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-1">Industry</label><input value={newClientIndustry} onChange={(e) => setNewClientIndustry(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-white" placeholder="e.g., Healthcare" /></div>
                  <div><label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-1">Title</label><input value={newClientTitle} onChange={(e) => setNewClientTitle(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-white" placeholder="e.g., Marketing Director" /></div>
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <button onClick={() => {
                    if (!newClientCompany.trim() || !newClientName.trim() || !newClientEmail.trim()) { toast.error("Please fill in required fields — Company name, contact name, and email are required"); return; }
                    createClientMutation.mutate({ companyName: newClientCompany, contactName: newClientName, contactEmail: newClientEmail, contactPhone: newClientPhone || undefined, industry: newClientIndustry || undefined, contactTitle: newClientTitle || undefined });
                  }} disabled={createClientMutation.isPending} className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--mt-brand)' }}>
                    {createClientMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                    {createClientMutation.isPending ? "Creating..." : "Create Client"}
                  </button>
                  <button onClick={() => setClientMode("existing")} className="px-4 py-2 text-[12px] font-semibold text-mt-ink-3 border border-mt-border hover:border-[#1A1A1A] transition-colors">Cancel</button>
                </div>
                <div className="mt-3"><label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-1">Budget</label><input value={budget} onChange={(e) => setBudget(e.target.value)} className="w-full px-3 py-2 text-[13px] text-mt-ink border border-mt-border focus:border-primary focus:outline-none bg-white" /></div>
              </div>
            )}
          </div>

          {/* Version History */}
          {showVersionHistory && (
            <div className="bg-white border border-mt-border p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><History size={16} className="text-primary" /><h3 className="text-[15px] font-bold text-mt-ink">Version History</h3><span className="text-[11px] text-[#A1A1AA]">{versionHistory?.length || 0} versions</span></div>
                <button onClick={() => setShowVersionHistory(false)} className="p-1 text-[#A1A1AA] hover:text-mt-ink transition-colors"><X size={16} /></button>
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {(!versionHistory || versionHistory.length === 0) ? (
                  <div className="text-center py-8"><History size={28} className="text-[#D4D4D4] mx-auto mb-2" /><p className="text-[12px] text-[#A1A1AA]">No version history yet</p><p className="text-[10px] text-[#D4D4D4] mt-1">Save your proposal to start tracking changes</p></div>
                ) : (
                  versionHistory.map((v: ProposalVersion, idx: number) => (
                    <div key={v.id} className={`p-3 border transition-colors ${v.action === "sent" ? "border-primary bg-mt-brand-light" : v.action === "reverted" ? "border-[#F59E0B] bg-[#FFFBEB]" : "border-[#F0F0F0] bg-mt-surface"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${v.action === "sent" ? "bg-primary text-white" : v.action === "reverted" ? "bg-[#F59E0B] text-white" : v.action === "created" ? "bg-[#16A34A] text-white" : "bg-[#E5E5E5] text-mt-ink-3"}`}>{v.action}</span>
                          <span className="text-[11px] font-semibold text-mt-ink">{v.authorName}</span>
                          <span className="text-[10px] text-[#A1A1AA]">{v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}</span>
                        </div>
                        {idx > 0 && v.action !== "reverted" && (
                          <button onClick={() => revertMutation.mutate({ proposalId, versionId: v.id })} disabled={revertMutation.isPending} className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-primary border border-primary hover:bg-primary hover:text-white transition-all disabled:opacity-50">
                            <RotateCcw size={10} /> Revert
                          </button>
                        )}
                      </div>
                      <div className="mt-2 space-y-0.5">
                        {(v.changes as string[] || []).map((change: string, ci: number) => (
                          <p key={ci} className="text-[11px] text-mt-ink-3 flex items-center gap-1.5"><ChevronRight size={10} className="text-[#D4D4D4] flex-shrink-0" /> {change}</p>
                        ))}
                      </div>
                      {(v.snapshotProductCount != null || v.snapshotEstimatedValue != null) && (
                        <div className="flex items-center gap-3 mt-2">
                          {v.snapshotProductCount != null && <span className="text-[10px] text-[#A1A1AA]">{v.snapshotProductCount} products</span>}
                          {v.snapshotEstimatedValue != null && <span className="text-[10px] text-[#A1A1AA]">${Number(v.snapshotEstimatedValue).toLocaleString()}</span>}
                          {v.snapshotDepartmentCount != null && v.snapshotDepartmentCount > 0 && <span className="text-[10px] text-[#A1A1AA]">{v.snapshotDepartmentCount} depts</span>}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Products Card */}
          <div className="bg-white border border-mt-border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3"><h3 className="text-[15px] font-bold text-mt-ink">Products</h3><span className="text-[11px] font-semibold text-[#A1A1AA]">{products.length} items</span></div>
              <button onClick={() => setShowProductModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-primary border border-primary hover:bg-primary hover:text-white transition-all"><Plus size={12} /> Add Product</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left">
                <thead>
                  <tr className="border-b border-mt-border">
                    {["Product", "SKU", "Decoration", "Qty", "Unit Price", "Total", "Proof", ""].map((h, i) => (
                      <th key={i} className={`text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase pb-3 pr-4 ${i === 3 ? "text-center" : i >= 4 && i <= 5 ? "text-right" : i === 6 ? "text-center" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, idx) => (
                    <tr key={idx} className="border-b border-[#F0F0F0] hover:bg-mt-surface transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          {p.imageUrl ? (<div className="w-9 h-9 bg-[#F8F8FA] rounded flex items-center justify-center p-0.5 flex-shrink-0 border border-[#F0F0F0]"><img src={p.imageUrl} alt={p.name} className="max-h-full max-w-full object-contain" /></div>) : (<div className="w-9 h-9 bg-gradient-to-br from-primary to-[#8B5CF6] rounded flex items-center justify-center flex-shrink-0"><Package size={14} className="text-white/70" /></div>)}
                          <button onClick={() => { setPreviewMode(true); setTimeout(() => pvSelectProduct(getPreviewProduct(p)), 50); }} className="text-[13px] font-semibold text-mt-ink hover:text-primary transition-colors text-left flex items-center gap-1.5 group">
                            {p.name}<ExternalLink size={10} className="text-[#D4D4D4] group-hover:text-primary transition-colors" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-[12px] text-[#A1A1AA] font-mono">{p.sku}</td>
                      <td className="py-3 pr-4 text-[12px] text-mt-ink-3">{p.decoration}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => updateQty(idx, -5)} className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] border border-mt-border hover:border-primary hover:text-primary text-[11px] transition-colors">&minus;</button>
                          <input value={p.qty} onChange={(e) => { const val = parseInt(e.target.value) || 1; const updated = [...products]; updated[idx] = { ...updated[idx], qty: val }; setProducts(updated); }} className="w-12 text-center text-[12px] font-semibold border border-mt-border py-1 focus:border-primary focus:outline-none" />
                          <button onClick={() => updateQty(idx, 5)} className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] border border-mt-border hover:border-primary hover:text-primary text-[11px] transition-colors">+</button>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-[12px] text-mt-ink text-right">${p.price.toFixed(2)}</td>
                      <td className="py-3 pr-4 text-[13px] font-semibold text-mt-ink text-right">${(p.qty * p.price).toFixed(2)}</td>
                      <td className="py-3 pr-4 text-center">{p.proofStatus === "ready" ? <span className="text-[10px] font-bold text-[#16A34A]">Ready</span> : <span className="text-[10px] text-[#D4D4D4]">&mdash;</span>}</td>
                      <td className="py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              if (!p.dbProductId || !proposalData?.clientId) return;
                              setPriceMatrixProduct({
                                productId: p.dbProductId,
                                productName: p.name,
                                productImageUrl: p.imageUrl ?? null,
                              });
                            }}
                            disabled={!p.dbProductId || !proposalData?.clientId}
                            title={
                              !p.dbProductId
                                ? "Link this row to a catalog product to set client pricing"
                                : !proposalData?.clientId
                                ? "Assign a client to this proposal to set pricing"
                                : "Set client-specific pricing for this product"
                            }
                            className="bg-[#F0EEFF] text-primary hover:bg-[#E5DCFF] px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors active:scale-[0.97]"
                          >
                            <DollarSign size={11} /> Set Pricing
                          </button>
                          <button onClick={() => removeProduct(idx)} className="p-1 text-[#D4D4D4] hover:text-[#EF4444] transition-colors" title="Remove product">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {products.length === 0 && (<div className="text-center py-8"><Package size={32} className="text-[#D4D4D4] mx-auto mb-2" /><p className="text-[13px] text-[#A1A1AA]">No products added yet</p><p className="text-[11px] text-[#D4D4D4] mt-1">Click "Add Product" to get started</p></div>)}
            {products.length > 0 && (
              <div className="mt-4 pt-4 border-t border-mt-border flex items-center justify-between">
                <p className="text-[12px] text-[#A1A1AA]">{totalUnits} total units</p>
                <div className="text-right"><span className="text-[12px] text-[#A1A1AA] mr-3">Proposal Total</span><span className="text-[18px] font-bold text-mt-ink">${productTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>
              </div>
            )}
          </div>

          {/* Proposal Settings */}
          <div className="bg-white border border-mt-border p-6">
            <h3 className="text-[15px] font-bold text-mt-ink mb-4">Proposal Settings</h3>
            <div className="mb-5">
              <label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-2">Proposal Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {([
                  { id: "promo" as const, label: "Promotional", icon: Package, desc: "Branded merchandise" },
                  { id: "print" as const, label: "Print Only", icon: FileText, desc: "Print materials" },
                  { id: "promo_print" as const, label: "Promo + Print", icon: Sparkles, desc: "Combined" },
                ] as const).map(type => {
                  const Icon = type.icon;
                  return (
                    <button key={type.id} onClick={() => setProposalType(type.id)} className={`p-3 text-left transition-all border ${proposalType === type.id ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}>
                      <Icon size={16} className={proposalType === type.id ? "text-primary" : "text-mt-ink-4"} />
                      <p className="text-[12px] font-semibold text-mt-ink mt-1.5">{type.label}</p>
                      <p className="text-[10px] text-[#A1A1AA]">{type.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-2">Delivery Method</label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-mt-surface border border-[#F0F0F0]">
                    <div className="flex items-center gap-2"><Mail size={14} className="text-primary" /><span className="text-[12px] font-semibold text-mt-ink">Email</span></div>
                    <button onClick={() => setDeliveryMethod(deliveryMethod === "email" || deliveryMethod === "both" ? (deliveryMethod === "both" ? "webstore" : "email") : "email")} className="w-10 h-5 rounded-full transition-colors relative" style={{ backgroundColor: deliveryMethod === "email" || deliveryMethod === "both" ? "var(--mt-brand)" : "#D4D4D4" }}>
                      <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ left: deliveryMethod === "email" || deliveryMethod === "both" ? "22px" : "2px" }} />
                    </button>
                  </div>
                  <div className={`flex items-center justify-between p-3 bg-mt-surface border border-[#F0F0F0] ${!clientHasWebstore ? "opacity-50" : ""}`}>
                    <div className="flex items-center gap-2"><Globe size={14} className="text-[#16A34A]" /><span className="text-[12px] font-semibold text-mt-ink">Webstore</span>{!clientHasWebstore && <span className="text-[9px] text-[#A1A1AA]">(no store)</span>}</div>
                    <button disabled={!clientHasWebstore} onClick={() => { if (deliveryMethod === "webstore") setDeliveryMethod("email"); else if (deliveryMethod === "email") setDeliveryMethod("both"); else setDeliveryMethod("email"); }} className="w-10 h-5 rounded-full transition-colors relative disabled:opacity-50" style={{ backgroundColor: deliveryMethod === "webstore" || deliveryMethod === "both" ? "#16A34A" : "#D4D4D4" }}>
                      <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ left: deliveryMethod === "webstore" || deliveryMethod === "both" ? "22px" : "2px" }} />
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-2">Proposal Validity</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {validDaysOptions.map(opt => (
                    <button key={opt.value} onClick={() => setValidDays(opt.value)} className={`px-2 py-2 text-[11px] font-semibold transition-all ${validDays === opt.value ? "bg-primary text-white" : "bg-mt-surface text-mt-ink-3 border border-[#F0F0F0] hover:border-primary"}`}>{opt.label}</button>
                  ))}
                </div>
                <p className="text-[10px] text-[#A1A1AA] mt-2">{validDays === 0 ? "This proposal will have no expiration date." : `Expires ${validDays} days after sending.`}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 bg-mt-surface border border-[#F0F0F0]">
                <div className="flex items-center gap-3"><Users size={16} className="text-primary" /><div><p className="text-[13px] font-semibold text-mt-ink">Multi-Department</p><p className="text-[10px] text-[#A1A1AA]">Route to multiple departments</p></div></div>
                <button onClick={() => setMultiDept(!multiDept)} className="w-10 h-5 rounded-full transition-colors relative" style={{ backgroundColor: multiDept ? "var(--mt-brand)" : "#D4D4D4" }}><div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ left: multiDept ? "22px" : "2px" }} /></button>
              </div>
              <div className="flex items-center justify-between p-4 bg-mt-surface border border-[#F0F0F0]">
                <div className="flex items-center gap-3"><CreditCard size={16} className="text-[#F97316]" /><div><p className="text-[13px] font-semibold text-mt-ink">Stripe Checkout</p><p className="text-[10px] text-[#A1A1AA]">Enable direct payment</p></div></div>
                <button onClick={() => setStripeEnabled(!stripeEnabled)} className="w-10 h-5 rounded-full transition-colors relative" style={{ backgroundColor: stripeEnabled ? "#EA580C" : "#D4D4D4" }}><div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ left: stripeEnabled ? "22px" : "2px" }} /></button>
              </div>
            </div>
          </div>

          {/* Catalog Config */}
          <CatalogConfigPanel proposalId={proposalId} />

          {/* Departments */}
          {multiDept && (
            <div className="bg-white border border-mt-border p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3"><h3 className="text-[15px] font-bold text-mt-ink">Department Routing</h3><span className="text-[11px] font-semibold text-[#A1A1AA]">{departments.length} departments</span></div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 mr-4">
                    <span className="text-[11px] font-semibold text-mt-ink-3">Routing:</span>
                    <button onClick={() => setApprovalRouting(approvalRouting === "parallel" ? "sequential" : "parallel")} className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-all border ${approvalRouting === "sequential" ? "border-primary bg-mt-brand-light text-primary" : "border-mt-border text-mt-ink-3"}`}>
                      <ArrowRightLeft size={12} /> {approvalRouting === "sequential" ? "Sequential" : "Parallel"}
                    </button>
                  </div>
                  {proposalData.status === "sent" && departments.some(d => d.email) && (
                    <button onClick={handleResendDeptEmails} disabled={sendDeptEmailsMutation.isPending} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-primary border border-primary hover:bg-primary hover:text-white transition-all disabled:opacity-50">
                      {sendDeptEmailsMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Resend Emails
                    </button>
                  )}
                  <button onClick={() => setShowAddDept(!showAddDept)} className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-primary border border-primary hover:bg-primary hover:text-white transition-all"><Plus size={12} /> Add Department</button>
                </div>
              </div>
              {approvalRouting === "sequential" && departments.length > 1 && (
                <div className="mb-3 p-3 bg-mt-brand-light border border-mt-border flex items-center gap-2"><Shield size={14} className="text-primary flex-shrink-0" /><p className="text-[11px] text-primary">Departments must approve in order. Each department will be notified only after the previous one approves.</p></div>
              )}
              {showAddDept && (
                <div className="mb-4 p-4 bg-mt-brand-light border border-mt-border flex items-end gap-3">
                  <div className="flex-1"><label className="text-[10px] font-bold text-primary tracking-wider uppercase block mb-1">Department Name</label><input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} className="w-full px-3 py-1.5 text-[13px] border border-mt-border focus:border-primary focus:outline-none" placeholder="e.g., Operations" /></div>
                  <div className="flex-1"><label className="text-[10px] font-bold text-primary tracking-wider uppercase block mb-1">Contact Person</label><input value={newDeptContact} onChange={(e) => setNewDeptContact(e.target.value)} className="w-full px-3 py-1.5 text-[13px] border border-mt-border focus:border-primary focus:outline-none" placeholder="e.g., Jane Doe" /></div>
                  <div className="flex-1"><label className="text-[10px] font-bold text-primary tracking-wider uppercase block mb-1">Contact Email</label><input type="email" value={newDeptEmail} onChange={(e) => setNewDeptEmail(e.target.value)} className="w-full px-3 py-1.5 text-[13px] border border-mt-border focus:border-primary focus:outline-none" placeholder="e.g., jane@acme.com" /></div>
                  <button onClick={addDepartment} className="px-4 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: 'var(--mt-brand)' }}>Add</button>
                  <button onClick={() => setShowAddDept(false)} className="px-3 py-1.5 text-[12px] font-semibold text-mt-ink-3 border border-mt-border">Cancel</button>
                </div>
              )}
              <div className="space-y-2">
                {departments.map((dept, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-mt-surface border border-[#F0F0F0]">
                    <div className="flex items-center gap-3">
                      {approvalRouting === "sequential" && <span className="w-6 h-6 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>}
                      <button onClick={() => { const updated = [...departments]; updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled }; setDepartments(updated); }} className="w-5 h-5 flex items-center justify-center border transition-colors" style={{ backgroundColor: dept.enabled ? "var(--mt-brand)" : "transparent", borderColor: dept.enabled ? "var(--mt-brand)" : "#D4D4D4" }}>
                        {dept.enabled && <Check size={12} className="text-white" />}
                      </button>
                      <div>
                        <p className="text-[13px] font-semibold text-mt-ink">{dept.name}</p>
                        <p className="text-[11px] text-[#A1A1AA]">{dept.contact || "No contact assigned"}{dept.email ? ` · ${dept.email}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {dept.status && dept.status !== "pending" && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${dept.status === "approved" ? "bg-[#F0FDF4] text-[#16A34A]" : "bg-[#FEF2F2] text-[#EF4444]"}`}>
                          {dept.status === "approved" ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {dept.status === "approved" ? "Approved" : "Rejected"}
                        </span>
                      )}
                      {dept.status === "pending" && dept.dbId && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#D97706] flex items-center gap-1"><Clock size={10} /> Pending</span>}
                      {dept.emailSentAt && <span className="text-[9px] text-[#A1A1AA]">Email sent</span>}
                      <button onClick={() => removeDepartment(idx)} className="p-1 text-[#D4D4D4] hover:text-[#EF4444] transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
                {departments.length === 0 && <p className="text-[12px] text-[#A1A1AA] text-center py-6">No departments added. Click "Add Department" to set up routing.</p>}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="bg-white border border-mt-border p-6">
            <h3 className="text-[15px] font-bold text-mt-ink mb-3">Internal Notes</h3>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes about this proposal (visible only to your team)..." className="w-full px-4 py-3 text-[13px] text-[#3F3F46] border border-mt-border focus:border-primary focus:outline-none resize-none leading-relaxed" rows={4} />
          </div>
        </div>

        {/* Right: Proofing Panel */}
        <ProposalProofingPanel
          products={products}
          proofingOpen={proofingOpen}
          selectedProofProduct={selectedProofProduct}
          proofGenerating={proofGenerating}
          proofHistory={proofHistory}
          dbProofs={proposalData.proofs || []}
          onToggleOpen={() => setProofingOpen(!proofingOpen)}
          onSelectProduct={setSelectedProofProduct}
          onOpenStudio={handleOpenProofingStudio}
        />
      </div>

      {/* Modals */}
      <ProposalSendConfirmModal
        show={showSendConfirm}
        clientId={proposalData?.clientId ?? undefined}
        clientContact={clientContact} clientEmail={clientEmail} title={title}
        productTotal={productTotal} deliveryMethod={deliveryMethod} validDays={validDays}
        multiDept={multiDept} departments={departments} approvalRouting={approvalRouting}
        sending={sending} sendPending={sendMutation.isPending}
        onClose={() => setShowSendConfirm(false)}
        onConfirm={handleSendToClient}
      />

      <ProposalEmailPreviewModal
        show={showEmailPreview}
        loading={emailPreviewMutation.isPending}
        html={emailPreviewHtml}
        subject={emailPreviewSubject}
        clientName={clientContact}
        clientEmail={clientEmail}
        onClose={() => setShowEmailPreview(false)}
      />

      <ProposalProductSearchModal
        show={showProductModal}
        productSearch={productSearch}
        productCategory={productCategory}
        categories={dbProductCategories}
        products={filteredDbProducts}
        onClose={() => setShowProductModal(false)}
        onSearchChange={setProductSearch}
        onCategoryChange={setProductCategory}
        onAddProduct={addProductFromDB}
      />

      {priceMatrixProduct && proposalData?.clientId != null && (
        <PriceMatrixModal
          open={priceMatrixProduct !== null}
          onClose={() => setPriceMatrixProduct(null)}
          clientId={proposalData.clientId}
          productId={priceMatrixProduct.productId}
          productName={priceMatrixProduct.productName}
          productImageUrl={priceMatrixProduct.productImageUrl ?? null}
        />
      )}
    </DashboardLayout>
  );
}
