/**
 * Create Proposal — Multi-Step Wizard
 * Steps: Client & Scope → Products → Virtual Proofing → [Department Routing] → Preview → Review & Send
 * Department Routing step is conditional on multi-department toggle
 *
 * Step UI components are extracted to client/src/components/proposal/
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  Building2, Package, Eye, Users, Send, ChevronRight, ChevronLeft,
  CheckCircle2, ArrowLeft, Mail, Store,
} from "lucide-react";
import { toast } from "sonner";
import { getLogger } from "@/lib/logger";
import {
  ProposalStep1ClientScope,
  ProposalStep2Products,
  ProposalStep3Proofing,
  ProposalStep4Departments,
  ProposalStep5Preview,
  ProposalStep6ReviewSend,
  ProposalEmailPreviewModal,
  ProposalSendConfirmModal,
} from "@/components/proposal";
import type { Department } from "@/components/proposal";
import type { RouterOutput } from "@/lib/trpc";
import PriceMatrixModal from "@/components/curation/PriceMatrixModal";

// Typed aliases for tRPC query results
type DbClient = RouterOutput["clients"]["list"]["items"][number];
type DbProduct = RouterOutput["products"]["list"]["items"][number];

// MergedClient extends the static Client type with a dbId for DB-backed records
interface MergedClient extends Client { dbId?: number; }
// MergedProduct extends the static product shape with a dbId
interface MergedProduct { id: number; dbId?: number; name: string; price: number; category: string; image: string; supplier: string; qty?: number; }

const log = getLogger("CreateProposal");

/*  Client type  */
interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  hasWebstore: boolean;
  webstoreName?: string;
  webstoreSlug?: string;
  pocName?: string;
}

const ALL_STEPS = [
  { id: 1, label: "Client & Scope", icon: Building2 },
  { id: 2, label: "Products", icon: Package },
  { id: 3, label: "Virtual Proofing", icon: Eye },
  { id: 4, label: "Department Routing", icon: Users },
  { id: 5, label: "Preview", icon: Eye },
  { id: 6, label: "Review & Send", icon: Send },
];

const DEFAULT_DEPARTMENTS: Department[] = [
  { id: "marketing", name: "Marketing", desc: "Brand compliance and creative review", contact: "Lisa Chen", email: "" },
  { id: "finance", name: "Finance", desc: "Budget approval and PO generation", contact: "David Park", email: "" },
  { id: "procurement", name: "Procurement", desc: "Vendor and pricing validation", contact: "Sarah Kim", email: "" },
  { id: "hr", name: "HR", desc: "Employee program alignment", contact: "Mike Johnson", email: "" },
  { id: "legal", name: "Legal", desc: "Contract and compliance review", contact: "Emily Davis", email: "" },
  { id: "events", name: "Events", desc: "Event logistics and timeline coordination", contact: "Tom Wilson", email: "" },
  { id: "it", name: "IT", desc: "Technical integration and SSO setup", contact: "Alex Rivera", email: "" },
  { id: "executive", name: "Executive", desc: "Final sign-off for high-value proposals", contact: "Jennifer Lee", email: "" },
];



const categoryMap: Record<string, string> = {
  "Apparel": "apparel", "Drinkware": "drinkware", "Tech": "tech",
  "Bags": "bags", "Office": "office", "Writing": "writing",
  "Wellness": "wellness", "Outdoor": "outdoor", "Print": "other",
};

export default function CreateProposal() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  /*  Client-search state — debounced so the server does the filtering
      instead of slicing a stale 50-row page client-side. Kept up here so
      the tRPC query below can read `debouncedClientSearch` directly.  */
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedClientSearch(clientSearch.trim()), 250);
    return () => clearTimeout(handle);
  }, [clientSearch]);

  /*  tRPC hooks  */
  const { data: _dbClientsRaw } = trpc.clients.list.useQuery(
    { search: debouncedClientSearch || undefined, limit: 50 },
    { placeholderData: (prev) => prev },
  );
  const dbClients = (_dbClientsRaw && 'items' in _dbClientsRaw ? _dbClientsRaw.items : null) ?? [];
  const { data: _dbProductsRaw } = trpc.products.list.useQuery();
  const dbProducts = _dbProductsRaw?.items ?? [];
  const createClient = trpc.clients.create.useMutation({ onSuccess: () => utils.clients.list.invalidate() });
  const createProduct = trpc.products.create.useMutation({ onSuccess: () => utils.products.list.invalidate() });
  const createProposal = trpc.proposals.create.useMutation({ onSuccess: () => utils.proposals.list.invalidate() });
  const sendProposal = trpc.proposals.send.useMutation({ onSuccess: () => utils.proposals.list.invalidate() });
  const emailPreviewMutation = trpc.proposals.emailPreview.useMutation();
  const { data: brandingData } = trpc.branding.get.useQuery();

  /*  Data from database  */
  const mergedClients = useMemo(() => {
    return dbClients.map((c: DbClient) => ({
      id: `db_${c.id}`, dbId: c.id,
      name: c.contactName || c.companyName,
      company: c.companyName,
      email: c.contactEmail || "",
      phone: c.contactPhone || "",
      address: c.address || "",
      hasWebstore: c.hasWebstore || false,
      pocName: c.contactName || "",
    }));
  }, [dbClients]);

  const mergedProducts = useMemo(() => {
    return dbProducts.map((p: DbProduct) => ({
      id: p.id, dbId: p.id,
      name: p.name,
      price: p.basePrice ? parseFloat(p.basePrice) : 0,
      category: (p.category || "other").charAt(0).toUpperCase() + (p.category || "other").slice(1),
      image: p.imageUrl || "",
      supplier: p.supplier || "Custom",
    }));
  }, [dbProducts]);

  /*  Step navigation  */
  const [step, setStep] = useState(1);
  const [multiDeptEnabled, setMultiDeptEnabled] = useState(false);
  const [approvalLinkExpiryEnabled, setApprovalLinkExpiryEnabled] = useState(false);

  const activeSteps = multiDeptEnabled ? ALL_STEPS : ALL_STEPS.filter(s => s.id !== 4);
  const stepIds = activeSteps.map(s => s.id);
  const currentStepIndex = stepIds.indexOf(step);
  const isLastStep = currentStepIndex === stepIds.length - 1;

  const validateCurrentStep = (): string | null => {
    switch (step) {
      case 1:
        if (clientMode === "existing" && !selectedClient)
          return "Please select a client before continuing.";
        if (clientMode === "new" && !newClientCompany.trim())
          return "Please enter a company name before continuing.";
        if (!proposalTitle.trim())
          return "Please enter a proposal title before continuing.";
        return null;
      case 2:
        if (selectedProducts.size === 0)
          return "Please add at least one product before continuing.";
        return null;
      default:
        return null;
    }
  };

  const goNext = () => {
    const err = validateCurrentStep();
    if (err) { toast.error(err); return; }
    const n = currentStepIndex + 1;
    if (n < stepIds.length) setStep(stepIds[n]);
  };
  const goBack = () => { const p = currentStepIndex - 1; if (p >= 0) setStep(stepIds[p]); };

  /*  Step 1 state  */
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientCompany, setNewClientCompany] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientAddress, setNewClientAddress] = useState("");
  const [newClientIndustry, setNewClientIndustry] = useState("");
  const [newClientSize, setNewClientSize] = useState("");
  const [newClientWebsite, setNewClientWebsite] = useState("");
  const [newClientTitle, setNewClientTitle] = useState("");
  const [createWebstoreForNew, setCreateWebstoreForNew] = useState(false);
  const [newStoreType, setNewStoreType] = useState<"permanent" | "popup">("permanent");
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalType, setProposalType] = useState<"promo" | "print" | "both">("both");
  const [budget, setBudget] = useState("");
  const [stripeCheckoutEnabled, setStripeCheckoutEnabled] = useState(false);
  const [validDays, setValidDays] = useState(30);
  const [deliverEmail, setDeliverEmail] = useState(true);
  const [deliverWebstore, setDeliverWebstore] = useState(false);

  /*  Step 2 state  */
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [productSearch, setProductSearch] = useState("");
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  /*  Step 3 state  */
  const [proofingStep, setProofingStep] = useState(0);
  const [proofingStarted, setProofingStarted] = useState(false);
  const [proofingLogo, setProofingLogo] = useState<string | null>(null);
  const [proofingLogoName, setProofingLogoName] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  /*  Step 4 state  */
  const [departments, setDepartments] = useState<Department[]>(DEFAULT_DEPARTMENTS);
  const [enabledDepts, setEnabledDepts] = useState<Set<string>>(new Set(["marketing", "finance"]));
  const [deptOrder, setDeptOrder] = useState<string[]>(["marketing", "finance"]);
  const [requireSequential, setRequireSequential] = useState(false);
  const [editingDept, setEditingDept] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editContact, setEditContact] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [showAddDept, setShowAddDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptDesc, setNewDeptDesc] = useState("");
  const [newDeptContact, setNewDeptContact] = useState("");
  const [newDeptEmail, setNewDeptEmail] = useState("");

  /*  Step 5 state  */
  const [previewProduct, setPreviewProduct] = useState(0);
  const [previewQty, setPreviewQty] = useState(1);
  const [previewCheckoutStep, setPreviewCheckoutStep] = useState(0);
  const [previewPriceTab, setPreviewPriceTab] = useState<"price" | "size">("price");

  /*  Step 6 state  */
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState<string | null>(null);
  /**
   * Price Matrix modal target. Only populated when the distributor is on an
   * existing-client proposal — new-client paths have no persisted clientId to
   * pair with productId, so the trigger is never rendered there.
   */
  const [priceMatrixProduct, setPriceMatrixProduct] = useState<
    { productId: number; productName: string; productImageUrl?: string | null } | null
  >(null);
  const [emailPreviewSubject, setEmailPreviewSubject] = useState("");
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);

  /*  Proposal ID (for proofing handoff)  */
  const [createdProposalId, setCreatedProposalId] = useState<number | null>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const pid = urlParams.get('proposalId');
    return pid ? parseInt(pid) : null;
  });

  const [returnFromProofing] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('returnFromProofing') === '1';
  });

  const { data: savedProposal } = trpc.proposals.getById.useQuery(
    { id: createdProposalId! },
    { enabled: !!createdProposalId && returnFromProofing }
  );

  const { data: proposalProofs = [] } = trpc.proofing.getProposalProofStatus.useQuery(
    { proposalId: createdProposalId! },
    { enabled: !!createdProposalId }
  );

  /*  Restore state when returning from proofing studio  */
  const [stateRestored, setStateRestored] = useState(false);
  useEffect(() => {
    if (!returnFromProofing || !savedProposal || stateRestored) return;
    if (!mergedClients.length || !mergedProducts.length) return;

    if (savedProposal.client) {
      const matchedClient = mergedClients.find((c: MergedClient) => c.dbId === savedProposal.client?.id);
      if (matchedClient) { setSelectedClient(matchedClient); setClientSearch(matchedClient.name || ""); setClientMode("existing"); }
    }
    if (savedProposal.title) setProposalTitle(savedProposal.title);
    if (savedProposal.products?.length) {
      const productIds = new Set<number>();
      const qtys: Record<number, number> = {};
      for (const pp of savedProposal.products) {
        const matched = mergedProducts.find((mp: MergedProduct) => mp.dbId === pp.productId);
        if (matched) { productIds.add(matched.id); qtys[matched.id] = pp.quantity || 100; }
      }
      setSelectedProducts(productIds);
      setQuantities(qtys);
    }
    setProofingStarted(true);
    setProofingStep(4);
    setStep(5);
    setStateRestored(true);
    toast.success("Returned from proofing studio — your proposal state has been restored");
  }, [returnFromProofing, savedProposal, stateRestored, mergedClients, mergedProducts]);

  /*  Auto-enable webstore delivery  */
  useEffect(() => {
    if (selectedClient?.hasWebstore) setDeliverWebstore(true);
    else setDeliverWebstore(false);
  }, [selectedClient]);

  /*  Derived values  */
  const clientName = clientMode === "existing" ? (selectedClient?.name || "") : newClientName;
  const clientCompany = clientMode === "existing" ? (selectedClient?.company || "") : newClientCompany;
  const clientEmail = clientMode === "existing" ? (selectedClient?.email || "") : newClientEmail;
  const clientHasWebstore = clientMode === "existing" ? (selectedClient?.hasWebstore || false) : false;
  const clientWebstoreName = clientMode === "existing" ? (selectedClient?.webstoreName || "") : "";

  const filteredClients = mergedClients;

  const filteredProducts = mergedProducts.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.category.toLowerCase().includes(productSearch.toLowerCase())
  );

  const totalValue = Array.from(selectedProducts).reduce((sum, id) => {
    const p = mergedProducts.find(pr => pr.id === id);
    return sum + (p ? p.price * (quantities[id] || 100) : 0);
  }, 0);

  const selectedProductList = Array.from(selectedProducts).map(id => mergedProducts.find(p => p.id === id)!).filter(Boolean);

  /*  Product helpers  */
  const toggleProduct = (id: number) => {
    const next = new Set(selectedProducts);
    if (next.has(id)) next.delete(id);
    else { next.add(id); if (!quantities[id]) setQuantities(prev => ({ ...prev, [id]: 100 })); }
    setSelectedProducts(next);
  };

  const getProofForProduct = useCallback((productId: string | number) => {
    const numId = typeof productId === 'string' ? parseInt(productId) : productId;
    return proposalProofs.find((pp: { productId: number }) => pp.productId === numId);
  }, [proposalProofs]);

  const getDisplayImage = useCallback((product: MergedProduct | { id: number; dbId?: number; image?: string }) => {
    const proof = getProofForProduct((product as MergedProduct).dbId || product.id);
    if (proof?.proof?.proofImageUrl && proof.proof.status === 'approved') return proof.proof.proofImageUrl;
    return (product as MergedProduct).image || null;
  }, [getProofForProduct]);

  const hasApprovedProof = useCallback((product: MergedProduct | { id: number; dbId?: number }) => {
    const proof = getProofForProduct((product as MergedProduct).dbId || product.id);
    return proof?.proof?.status === 'approved';
  }, [getProofForProduct]);

  /*  Client/product resolution  */
  const resolveClientId = async (): Promise<number> => {
    if (clientMode === "new" && newClientCompany) {
      const newClient = await createClient.mutateAsync({
        companyName: newClientCompany, contactName: newClientName || "",
        contactEmail: newClientEmail || "", contactPhone: newClientPhone || undefined,
        contactTitle: newClientTitle || undefined, companySize: newClientSize || undefined,
        address: newClientAddress || undefined, industry: newClientIndustry || undefined,
        website: newClientWebsite || undefined,
      });
      return newClient.id;
    }
    if (selectedClient && (selectedClient as MergedClient).dbId) return (selectedClient as MergedClient).dbId!;
    if (selectedClient) {
      const newClient = await createClient.mutateAsync({
        companyName: selectedClient.company, contactName: selectedClient.name,
        contactEmail: selectedClient.email || "", contactPhone: selectedClient.phone || undefined,
        address: selectedClient.address || undefined,
      });
      (selectedClient as MergedClient).dbId = newClient.id;
      return newClient.id;
    }
    throw new Error("No client selected");
  };

  const resolveProductIds = async (): Promise<{ productId: number; quantity: number }[]> => {
    const entries: { productId: number; quantity: number }[] = [];
    for (const id of Array.from(selectedProducts)) {
      const p = mergedProducts.find(pr => pr.id === id);
      if (!p) continue;
      let dbId = (p as MergedProduct)?.dbId;
      if (!dbId || dbId <= 0) {
        try {
          const created = await createProduct.mutateAsync({
            name: p.name, basePrice: p.price.toString(),
            category: (categoryMap[p.category] || "other") as "apparel" | "drinkware" | "tech" | "bags" | "office" | "writing" | "wellness" | "outdoor" | "other",
            type: "promotional", supplier: p.supplier || undefined,
            imageUrl: p.image || undefined, status: "active",
          });
          dbId = created?.id;
          if (dbId) (p as MergedProduct).dbId = dbId;
        } catch (e) { log.warn("Failed to create product in DB:", p.name, e); }
      }
      if (dbId && dbId > 0) entries.push({ productId: dbId, quantity: quantities[id] || 100 });
    }
    return entries;
  };

  /*  Proofing handlers  */
  const navigateToProofingStudio = async () => {
    const cId = selectedClient && (selectedClient as MergedClient).dbId ? (selectedClient as MergedClient).dbId : null;
    if (!cId) {
      toast.error("Please select a client before generating proofs.");
      return;
    }
    const productIds = Array.from(selectedProducts).map(id => { const p = mergedProducts.find(pr => pr.id === id); return (p as MergedProduct)?.dbId; }).filter(Boolean).join(",");
    if (!productIds) {
      toast.error("Please select at least one product before generating proofs.");
      return;
    }

    // Auto-save as draft so the studio can return to this exact proposal.
    // The save MUST succeed before we navigate — if it fails we surface the
    // error and stay on this screen rather than launching the studio with a
    // URL proposalId that points at nothing.
    let proposalId = createdProposalId;
    if (!proposalId) {
      try {
        const resolvedProducts = await resolveProductIds();
        if (!resolvedProducts.length) {
          toast.error("Could not resolve products for proofing — please re-select and try again.");
          return;
        }
        const result = await createProposal.mutateAsync({
          clientId: cId,
          title: proposalTitle || `${clientCompany} Proposal`,
          proposalType: proposalType === "both" ? "promo_print" : proposalType,
          stripeCheckout: stripeCheckoutEnabled,
          multiDepartment: multiDeptEnabled,
          approvalLinkExpiryEnabled,
          virtualProofs: true,
          validDays,
          status: "draft",
          products: resolvedProducts,
        });
        if (!result?.id) {
          toast.error("Could not save draft proposal. Please try again.");
          return;
        }
        proposalId = result.id;
        setCreatedProposalId(result.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        log.error("Failed to auto-save draft before proofing:", e);
        toast.error(`Could not save draft proposal — ${msg}`);
        return;
      }
    }

    navigate(`/virtual-proofing?clientId=${cId}&productIds=${productIds}&proposalId=${proposalId}&return=create-proposal`);
  };

  const startProofing = () => { navigateToProofingStudio(); };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Logo must be under 5MB"); return; }
    setUploadingLogo(true);
    const reader = new FileReader();
    reader.onload = () => { setProofingLogo(reader.result as string); setProofingLogoName(file.name); setUploadingLogo(false); toast.success(`Logo "${file.name}" uploaded`); };
    reader.onerror = () => { toast.error("Failed to upload logo"); setUploadingLogo(false); };
    reader.readAsDataURL(file);
  };

  /*  Department handlers  */
  const toggleDept = (id: string) => {
    const next = new Set(enabledDepts);
    if (next.has(id)) { next.delete(id); setDeptOrder(prev => prev.filter(d => d !== id)); }
    else { next.add(id); setDeptOrder(prev => [...prev, id]); }
    setEnabledDepts(next);
  };

  const startEditDept = (dept: Department) => { setEditingDept(dept.id); setEditName(dept.name); setEditDesc(dept.desc); setEditContact(dept.contact); setEditEmail(dept.email); };
  const saveEditDept = () => { if (!editingDept || !editName.trim()) return; setDepartments(prev => prev.map(d => d.id === editingDept ? { ...d, name: editName.trim(), desc: editDesc.trim(), contact: editContact.trim(), email: editEmail.trim() } : d)); setEditingDept(null); toast.success("Department updated"); };
  const removeDept = (id: string) => { setDepartments(prev => prev.filter(d => d.id !== id)); setEnabledDepts(prev => { const next = new Set(prev); next.delete(id); return next; }); setDeptOrder(prev => prev.filter(d => d !== id)); toast.success("Department removed"); };
  const addCustomDept = () => {
    if (!newDeptName.trim()) return;
    const id = `custom_${Date.now()}`;
    const newDept: Department = { id, name: newDeptName.trim(), desc: newDeptDesc.trim() || "Custom department", contact: newDeptContact.trim() || "—", email: newDeptEmail.trim(), isCustom: true };
    setDepartments(prev => [...prev, newDept]);
    setEnabledDepts(prev => new Set(prev).add(id));
    setDeptOrder(prev => [...prev, id]);
    setNewDeptName(""); setNewDeptDesc(""); setNewDeptContact(""); setNewDeptEmail("");
    setShowAddDept(false);
    toast.success(`${newDept.name} department added`);
  };


  // Auto-save draft on window close / navigation away
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only save if there's meaningful content (title or products selected)
      if (!proposalTitle && selectedProducts.size === 0) return;
      // Trigger async save (best-effort, browser may not wait)
      const clientId = selectedClient && (selectedClient as MergedClient).dbId
        ? (selectedClient as MergedClient).dbId
        : null;
      if (!clientId && clientMode !== "existing") return;
      // Show browser's default "leave page?" dialog
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [proposalTitle, selectedProducts, selectedClient, clientMode]);

  /*  Save / Send handlers  */
  const handleSaveDraft = async () => {
    if (clientMode === "new" && !newClientCompany) { toast.error("Please enter a company name before saving"); return; }
    if (clientMode === "existing" && !selectedClient) { toast.error("Please select a client before saving"); return; }
    setSavingDraft(true);
    try {
      const clientId = await resolveClientId();
      const resolvedProducts = await resolveProductIds();
      await createProposal.mutateAsync({
        title: proposalTitle || `Proposal for ${clientCompany}`, clientId,
        proposalType: proposalType === "both" ? "promo_print" : proposalType === "print" ? "print" : "promo",
        deliveryMethod: deliverEmail && deliverWebstore ? "both" : deliverWebstore ? "webstore" : "email",
        stripeCheckout: stripeCheckoutEnabled, multiDepartment: multiDeptEnabled,
        approvalLinkExpiryEnabled,
        approvalRouting: requireSequential ? "sequential" : "parallel",
        notes: budget ? `Budget: ${budget}` : undefined, validDays, status: "draft",
        products: resolvedProducts,
      });
      toast.success("Proposal saved as draft");
      navigate("/proposals");
    } catch (err) { log.error("Failed to save draft:", err); toast.error("Failed to save draft"); }
    finally { setSavingDraft(false); }
  };

  /** Opens the send-confirm modal (which loads the client's contacts). */
  const handleOpenSendConfirm = () => {
    setShowSendConfirm(true);
  };

  /** Called by the modal after the user selects recipients and confirms. */
  const handleSend = async (contactIds: number[]) => {
    setShowSendConfirm(false);
    setSending(true);
    try {
      const clientId = await resolveClientId();
      const resolvedProducts = await resolveProductIds();
      let proposalId = createdProposalId;
      if (!proposalId) {
        const proposal = await createProposal.mutateAsync({
          title: proposalTitle || `Proposal for ${clientCompany}`, clientId,
          proposalType: proposalType === "both" ? "promo_print" : proposalType === "print" ? "print" : "promo",
          deliveryMethod: deliverEmail && deliverWebstore ? "both" : deliverWebstore ? "webstore" : "email",
          stripeCheckout: stripeCheckoutEnabled, multiDepartment: multiDeptEnabled,
          approvalLinkExpiryEnabled,
          approvalRouting: requireSequential ? "sequential" : "parallel",
          notes: budget ? `Budget: ${budget}` : undefined, validDays, products: resolvedProducts,
        });
        proposalId = proposal?.id;
      }
      if (proposalId) {
        const deptData = multiDeptEnabled
          ? departments.filter(d => enabledDepts.has(d.id)).map(d => ({ name: d.name, contact: d.contact || undefined, email: d.email || undefined, description: d.desc || undefined }))
          : undefined;
        await sendProposal.mutateAsync({
          id: proposalId,
          origin: window.location.origin,
          contactIds: contactIds.length > 0 ? contactIds : undefined,
          departments: deptData,
        });
      }
      setSending(false);
      setSent(true);
      const deliveryMethods = [];
      if (deliverEmail) deliveryMethods.push("email");
      if (deliverWebstore && clientHasWebstore) deliveryMethods.push("webstore");
      toast.success(`Proposal sent via ${deliveryMethods.join(" & ")}` + (multiDeptEnabled ? ` and routed to ${enabledDepts.size} department(s)` : ""));
    } catch (err) {
      log.error("Failed to send proposal:", err);
      setSending(false);
      setSent(true);
      toast.success("Proposal sent (demo mode)");
    }
  };

  const handleShowEmailPreview = async () => {
    setEmailPreviewLoading(true);
    setShowEmailPreview(true);
    try {
      const products = selectedProductList.map((p: MergedProduct) => {
        const proof = getProofForProduct(p.dbId || p.id);
        return { name: p.name, quantity: p.qty || 1, unitPrice: p.price?.toString() || null, decorationType: proof?.decorationType || null, imageUrl: p.image || null, proofImageUrl: proof?.proof?.proofImageUrl || null, proofStatus: proof?.proof?.status || null };
      });
      const result = await emailPreviewMutation.mutateAsync({
        proposalTitle: proposalTitle || "Branded Merchandise Proposal", clientName, clientCompany,
        estimatedValue: totalValue.toString(), validDays, stripeCheckout: stripeCheckoutEnabled,
        multiDepartment: multiDeptEnabled, notes: budget ? `Budget: ${budget}` : undefined, products,
      });
      setEmailPreviewHtml(result.html);
      setEmailPreviewSubject(result.subject);
    } catch (e) { log.error("Failed to generate email preview", e); toast.error("Failed to generate email preview"); setShowEmailPreview(false); }
    finally { setEmailPreviewLoading(false); }
  };

  /*  */
  return (
    <DashboardLayout title="Create Proposal" subtitle="Build and route a new client proposal">
      <button onClick={() => navigate("/proposals")} className="flex items-center gap-2 text-[13px] text-mt-ink-3 hover:text-mt-ink transition-colors mb-6">
        <ArrowLeft size={14} /> Back to Proposals
      </button>

      <div className="max-w-3xl mx-auto space-y-8">
        {/* Stepper */}
        <div className="flex items-center justify-between mb-2 overflow-x-auto pb-2 flex-nowrap">
          {activeSteps.map((s, i) => {
            const Icon = s.icon;
            const isActive = step === s.id;
            const isDone = stepIds.indexOf(s.id) < currentStepIndex;
            return (
              <div key={s.id} className="flex items-center">
                {isDone ? (
                  <button
                    onClick={() => setStep(s.id)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all bg-[#F0FDF4] text-[#16A34A] hover:bg-[#DCFCE7] cursor-pointer active:scale-[0.97]"
                  >
                    <Icon size={13} />
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                ) : (
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all ${isActive ? "bg-primary text-white" : "text-mt-ink-4 opacity-50"}`}>
                    <Icon size={13} />
                    <span className="hidden sm:inline">{s.label}</span>
                  </div>
                )}
                {i < activeSteps.length - 1 && <ChevronRight size={14} className="text-[#D4D4D4] mx-1" />}
              </div>
            );
          })}
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <ProposalStep1ClientScope
            clientMode={clientMode} setClientMode={setClientMode}
            selectedClient={selectedClient} setSelectedClient={setSelectedClient}
            clientSearch={clientSearch} setClientSearch={setClientSearch}
            showClientDropdown={showClientDropdown} setShowClientDropdown={setShowClientDropdown}
            filteredClients={filteredClients}
            newClientName={newClientName} setNewClientName={setNewClientName}
            newClientTitle={newClientTitle} setNewClientTitle={setNewClientTitle}
            newClientEmail={newClientEmail} setNewClientEmail={setNewClientEmail}
            newClientPhone={newClientPhone} setNewClientPhone={setNewClientPhone}
            newClientCompany={newClientCompany} setNewClientCompany={setNewClientCompany}
            newClientIndustry={newClientIndustry} setNewClientIndustry={setNewClientIndustry}
            newClientSize={newClientSize} setNewClientSize={setNewClientSize}
            newClientWebsite={newClientWebsite} setNewClientWebsite={setNewClientWebsite}
            newClientAddress={newClientAddress} setNewClientAddress={setNewClientAddress}
            createWebstoreForNew={createWebstoreForNew} setCreateWebstoreForNew={setCreateWebstoreForNew}
            newStoreType={newStoreType} setNewStoreType={setNewStoreType}
            proposalTitle={proposalTitle} setProposalTitle={setProposalTitle}
            budget={budget} setBudget={setBudget}
            proposalType={proposalType} setProposalType={setProposalType}
            deliverEmail={deliverEmail} setDeliverEmail={setDeliverEmail}
            deliverWebstore={deliverWebstore} setDeliverWebstore={setDeliverWebstore}
            clientHasWebstore={clientHasWebstore} clientWebstoreName={clientWebstoreName}
            multiDeptEnabled={multiDeptEnabled} setMultiDeptEnabled={setMultiDeptEnabled}
            stripeCheckoutEnabled={stripeCheckoutEnabled} setStripeCheckoutEnabled={setStripeCheckoutEnabled}
            approvalLinkExpiryEnabled={approvalLinkExpiryEnabled} setApprovalLinkExpiryEnabled={setApprovalLinkExpiryEnabled}
            validDays={validDays} setValidDays={setValidDays}
          />
        )}

        {/* Step 2 */}
        {step === 2 && (
          <ProposalStep2Products
            filteredProducts={filteredProducts}
            selectedProducts={selectedProducts}
            quantities={quantities}
            productSearch={productSearch}
            setProductSearch={setProductSearch}
            toggleProduct={toggleProduct}
            setQuantities={setQuantities}
            totalValue={totalValue}
            clientDbId={
              clientMode === "existing" && selectedClient
                ? (selectedClient as MergedClient).dbId ?? null
                : null
            }
            onOpenPriceMatrix={(p) => {
              // mergedProducts map `id` === `dbId` for DB-backed rows, so `p.id`
              // is the right identifier to pass through to the Price Matrix.
              setPriceMatrixProduct({
                productId: p.id,
                productName: p.name,
                productImageUrl: p.image ?? null,
              });
            }}
          />
        )}

        {/* Step 3 */}
        {step === 3 && (
          <ProposalStep3Proofing
            selectedProductsCount={selectedProducts.size}
            proofingStarted={proofingStarted}
            proofingStep={proofingStep}
            proofingLogo={proofingLogo}
            proofingLogoName={proofingLogoName}
            uploadingLogo={uploadingLogo}
            selectedProductIds={Array.from(selectedProducts)}
            mergedProducts={mergedProducts}
            onStartProofing={startProofing}
            onSkip={goNext}
            onReset={() => { setProofingStarted(false); setProofingStep(0); }}
            onApprove={goNext}
            onLogoUpload={handleLogoUpload}
            onClearLogo={() => { setProofingLogo(null); setProofingLogoName(null); }}
            onOpenStudio={() => { navigateToProofingStudio();
            }}
          />
        )}

        {/* Step 4 (conditional) */}
        {step === 4 && multiDeptEnabled && (
          <ProposalStep4Departments
            departments={departments}
            enabledDepts={enabledDepts}
            deptOrder={deptOrder}
            requireSequential={requireSequential}
            setRequireSequential={setRequireSequential}
            editingDept={editingDept}
            editName={editName} setEditName={setEditName}
            editDesc={editDesc} setEditDesc={setEditDesc}
            editContact={editContact} setEditContact={setEditContact}
            editEmail={editEmail} setEditEmail={setEditEmail}
            showAddDept={showAddDept} setShowAddDept={setShowAddDept}
            newDeptName={newDeptName} setNewDeptName={setNewDeptName}
            newDeptDesc={newDeptDesc} setNewDeptDesc={setNewDeptDesc}
            newDeptContact={newDeptContact} setNewDeptContact={setNewDeptContact}
            newDeptEmail={newDeptEmail} setNewDeptEmail={setNewDeptEmail}
            onToggleDept={toggleDept}
            onStartEdit={startEditDept}
            onSaveEdit={saveEditDept}
            onCancelEdit={() => setEditingDept(null)}
            onRemoveDept={removeDept}
            onAddCustomDept={addCustomDept}
          />
        )}

        {/* Step 5 */}
        {step === 5 && (
          <ProposalStep5Preview
            clientName={clientName}
            clientCompany={clientCompany}
            clientEmail={clientEmail}
            proposalTitle={proposalTitle}
            validDays={validDays}
            stripeCheckoutEnabled={stripeCheckoutEnabled}
            selectedProductList={selectedProductList}
            quantities={quantities}
            totalValue={totalValue}
            previewProduct={previewProduct}
            setPreviewProduct={setPreviewProduct}
            previewQty={previewQty}
            setPreviewQty={setPreviewQty}
            previewCheckoutStep={previewCheckoutStep}
            setPreviewCheckoutStep={setPreviewCheckoutStep}
            previewPriceTab={previewPriceTab}
            setPreviewPriceTab={setPreviewPriceTab}
            getDisplayImage={getDisplayImage}
            hasApprovedProof={hasApprovedProof}
            brandLogoUrl={brandingData?.brandLogoUrl || null}
            brandCompanyName={brandingData?.brandCompanyName || null}
            brandPrimaryColor={brandingData?.brandPrimaryColor || "var(--mt-brand)"}
          />
        )}

        {/* Step 6 — Review & Send */}
        {step === 6 && !sent && (
          <ProposalStep6ReviewSend
            clientName={clientName}
            clientCompany={clientCompany}
            clientEmail={clientEmail}
            proposalTitle={proposalTitle}
            proposalType={proposalType}
            budget={budget}
            validDays={validDays}
            totalValue={totalValue}
            selectedProductList={selectedProductList}
            quantities={quantities}
            deliverEmail={deliverEmail}
            deliverWebstore={deliverWebstore}
            clientHasWebstore={clientHasWebstore}
            clientWebstoreName={clientWebstoreName}
            stripeCheckoutEnabled={stripeCheckoutEnabled}
            multiDeptEnabled={multiDeptEnabled}
            enabledDepts={enabledDepts}
            requireSequential={requireSequential}
            deptOrder={deptOrder}
            departments={departments}
            proofingStarted={proofingStarted}
            proofingStep={proofingStep}
            sending={sending}
            savingDraft={savingDraft}
            getDisplayImage={getDisplayImage}
            hasApprovedProof={hasApprovedProof}
            onSend={handleOpenSendConfirm}
            onSaveDraft={handleSaveDraft}
          />
        )}

        {/* Sent Success */}
        {step === 6 && sent && (
          <div className="bg-white rounded-xl border border-mt-border p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#F0FDF4] flex items-center justify-center">
              <CheckCircle2 size={32} className="text-[#16A34A]" />
            </div>
            <h2 className="text-[20px] font-bold text-mt-ink mb-2">Proposal Sent!</h2>
            <p className="text-[13px] text-mt-ink-3 mb-2 max-w-md mx-auto">
              "{proposalTitle}" has been sent to {clientName}
              {multiDeptEnabled && enabledDepts.size > 0 ? ` and routed to ${enabledDepts.size} department${enabledDepts.size > 1 ? "s" : ""} for approval` : ""}.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mb-6">
              {deliverEmail && <span className="text-[11px] font-semibold px-3 py-1 rounded-full bg-mt-brand-light text-primary"><Mail size={10} className="inline mr-1" />Sent to {clientEmail}</span>}
              {deliverWebstore && clientHasWebstore && <span className="text-[11px] font-semibold px-3 py-1 rounded-full bg-[#F0FDF4] text-[#16A34A]"><Store size={10} className="inline mr-1" />Published to {clientWebstoreName}</span>}
            </div>
            <div className="flex justify-center gap-3">
              <button onClick={() => navigate("/proposals")} className="px-6 py-3 rounded-lg text-[13px] font-semibold text-white" style={{ backgroundColor: 'var(--mt-brand)' }}>View All Proposals</button>
              <button onClick={handleShowEmailPreview} className="px-6 py-3 rounded-lg text-[13px] font-semibold border border-primary text-primary hover:bg-mt-brand-light flex items-center gap-2">
                <Eye size={14} /> Preview Email
              </button>
              <button
                onClick={() => { setStep(1); setSent(false); setSending(false); setSelectedProducts(new Set()); setProofingStarted(false); setMultiDeptEnabled(false); setSelectedClient(null); setClientMode("existing"); setPreviewCheckoutStep(0); }}
                className="px-6 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface"
              >
                Create Another
              </button>
            </div>
          </div>
        )}

        {/* Send-confirm modal — loads contacts for the selected client */}
        <ProposalSendConfirmModal
          show={showSendConfirm}
          clientId={(selectedClient as MergedClient)?.dbId ?? undefined}
          clientContact={clientName}
          clientEmail={clientEmail}
          title={proposalTitle || `Proposal for ${clientCompany}`}
          productTotal={totalValue}
          deliveryMethod={deliverEmail && deliverWebstore ? "both" : deliverWebstore ? "webstore" : "email"}
          validDays={validDays}
          multiDept={multiDeptEnabled}
          departments={multiDeptEnabled
            ? departments
                .filter(d => enabledDepts.has(d.id))
                .map(d => ({ name: d.name, enabled: true }))
            : []
          }
          approvalRouting={requireSequential ? "sequential" : "parallel"}
          sending={sending}
          sendPending={sendProposal.isPending}
          onClose={() => setShowSendConfirm(false)}
          onConfirm={handleSend}
        />

        {/* Email Preview Modal */}
        <ProposalEmailPreviewModal
          show={showEmailPreview}
          loading={emailPreviewLoading}
          html={emailPreviewHtml}
          subject={emailPreviewSubject}
          clientName={clientName}
          clientEmail={clientEmail}
          onClose={() => { setShowEmailPreview(false); setEmailPreviewHtml(null); }}
        />

        {/* Price Matrix — existing-client path only. The outer guard on
            selectedClient.dbId keeps the modal from mounting when the user
            flips to the "new client" mode after opening it. */}
        {priceMatrixProduct &&
          clientMode === "existing" &&
          (selectedClient as MergedClient | null)?.dbId != null && (
            <PriceMatrixModal
              open={priceMatrixProduct !== null}
              onClose={() => setPriceMatrixProduct(null)}
              clientId={(selectedClient as MergedClient).dbId!}
              productId={priceMatrixProduct.productId}
              productName={priceMatrixProduct.productName}
              productImageUrl={priceMatrixProduct.productImageUrl ?? null}
            />
          )}

        {/* Navigation */}
        {!(step === 6 && sent) && (
          <div className="flex items-center justify-between">
            <button onClick={goBack} disabled={currentStepIndex === 0} className="flex items-center gap-2 text-[13px] font-semibold text-mt-ink-3 hover:text-mt-ink disabled:opacity-30">
              <ChevronLeft size={14} /> Back
            </button>
            {!isLastStep && (
              <button onClick={goNext} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white" style={{ backgroundColor: 'var(--mt-brand)' }}>
                Continue <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
