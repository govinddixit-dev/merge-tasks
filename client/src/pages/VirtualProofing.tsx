import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Upload, Sparkles, RotateCcw, ZoomIn, ZoomOut,
  Download, Check, X, Loader2, Eye, Trash2,
  ArrowLeft, ArrowRight, Search, GripVertical,
  Shirt, Clock, CheckCircle2, AlertCircle,
  Building2, Star, Plus, Image as ImageIcon,
  Maximize2, Minimize2, RotateCw, Box, Layers,
  CheckSquare, Square, XCircle
} from "lucide-react";
import { getLogger } from "@/lib/logger";
import type { RouterOutput } from "@/lib/trpc";
import { VirtualProofingViewer } from "@/components/proofing/VirtualProofingViewer";
import { ProofRevisionDialog } from "@/components/proofing/ProofRevisionDialog";
import { GroupedProductGrid } from "@/components/products/GroupedProductGrid";

type DbClient = RouterOutput["clients"]["list"]["items"][number];
type DbProduct = RouterOutput["products"]["list"]["items"][number];
type ProofResult = RouterOutput["proofing"]["list"][number];
type ClientLogo = RouterOutput["proofing"]["listClientLogos"][number];

const log = getLogger("VirtualProofing");

const DECORATION_METHODS = [
  { id: "embroidery", label: "Embroidery", icon: "🧵", color: "#8B5CF6" },
  { id: "screen_print", label: "Screen Print", icon: "🖨️", color: "#3B82F6" },
  { id: "laser_engraving", label: "Laser Engraving", icon: "⚡", color: "#EF4444" },
  { id: "heat_transfer", label: "Heat Transfer", icon: "🔥", color: "#F59E0B" },
  { id: "dtg", label: "DTG Print", icon: "🎨", color: "#10B981" },
  { id: "sublimation", label: "Sublimation", icon: "💎", color: "#EC4899" },
  { id: "deboss", label: "Deboss", icon: "📐", color: "#6366F1" },
  { id: "patch", label: "Patch", icon: "🏷️", color: "#14B8A6" },
] as const;

type Step = "select_client" | "select_logo" | "select_products" | "review" | "rendering" | "results";

export default function VirtualProofing() {
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("select_client");

  // Client & logo
  // selectedClient: null = no client, { id: -1 } = standalone mode (no client selected)
  const [selectedClient, setSelectedClient] = useState<DbClient | null>(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [logoName, setLogoName] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Multi-product selection
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [productSearch, setProductSearch] = useState("");

  // Rendering state
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderTotal, setRenderTotal] = useState(0);

  // Proof results
  const [proofResults, setProofResults] = useState<ProofResult[]>([]);
  const [selectedProofId, setSelectedProofId] = useState<number | null>(null);
  const [fullscreenProof, setFullscreenProof] = useState<string | null>(null);

  // URL params
  const [proposalId, setProposalId] = useState<number | null>(null);
  const [autoSelectedClient, setAutoSelectedClient] = useState(false);
  const [returnToProposal, setReturnToProposal] = useState(false);
  const [returnPath, setReturnPath] = useState<string>("create-proposal");

  // tRPC queries
  const { data: _dbProductsRaw } = trpc.products.list.useQuery();
  const dbProducts = _dbProductsRaw?.items ?? [];
  const { data: _dbClientsRaw } = trpc.clients.list.useQuery();
  const dbClients = (_dbClientsRaw && 'items' in _dbClientsRaw ? _dbClientsRaw.items : null) ?? [];
  const { data: existingProofs = [], refetch: refetchProofs } = trpc.proofing.list.useQuery();
  const { data: clientLogos = [], refetch: refetchLogos } = trpc.proofing.listClientLogos.useQuery(
    { clientId: selectedClient?.id ?? 0 },
    { enabled: !!selectedClient?.id && selectedClient.id > 0 }
  );

  // tRPC mutations
  const uploadClientLogoMut = trpc.proofing.uploadClientLogo.useMutation();
  const uploadLogoMut = trpc.proofing.uploadLogo.useMutation();
  const bulkCreateMut = trpc.proofing.bulkCreate.useMutation();
  const bulkRenderMut = trpc.proofing.bulkRender.useMutation();
  const createProofMut = trpc.proofing.create.useMutation();
  const renderProofMut = trpc.proofing.renderProof.useMutation();
  const updateStatusMut = trpc.proofing.updateStatus.useMutation();
  const approveAllMut = trpc.proofing.approveAll.useMutation();
  const deleteProofMut = trpc.proofing.delete.useMutation();
  const reviseProofMut = trpc.proofing.reviseProof.useMutation();

  // 3D Viewer state
  const [viewerProof, setViewerProof] = useState<ProofResult | null>(null);
  const [viewerRotation, setViewerRotation] = useState({ x: 0, y: 0 });
  const [viewerZoom, setViewerZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const viewerRef = useRef<HTMLDivElement>(null);

  // Revision dialog state
  const [revisionProofId, setRevisionProofId] = useState<number | null>(null);
  const [revisionText, setRevisionText] = useState("");
  const [isRevising, setIsRevising] = useState(false);

  // Parse URL params
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const returnParam = params.get("return");
    const proposalIdParam = params.get("proposalId");
    if (proposalIdParam) setProposalId(parseInt(proposalIdParam, 10));
    if (returnParam === "proposal" || returnParam === "create-proposal" || returnParam === "edit-proposal") {
      setReturnToProposal(true);
      setReturnPath(returnParam);
    }

    if (autoSelectedClient || !dbClients.length) return;
    const clientIdParam = params.get("clientId");
    const productIdsParam = params.get("productIds");

    if (clientIdParam) {
      const clientId = parseInt(clientIdParam, 10);
      const client = dbClients.find((c: DbClient) => c.id === clientId);
      if (client) {
        setSelectedClient(client);
        setStep("select_logo");
        setAutoSelectedClient(true);
        toast.info(`Client pre-selected: ${client.companyName}`);
      }
    }

    if (productIdsParam) {
      const ids = productIdsParam.split(",").map(Number).filter(n => !isNaN(n));
      setSelectedProductIds(new Set(ids));
    }
  }, [dbClients, searchString, autoSelectedClient]);

  // Build product list from DB
  const allProducts = useMemo(() => {
    const seenNames = new Map<string, { id: number; name: string; category: string; imageUrl: string | null; price: string }>();
    for (const p of dbProducts) {
      const key = (p.name || "").toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.set(key, {
          id: p.id,
          name: p.name,
          category: p.category || "other",
          imageUrl: p.imageUrl ?? null,
          price: `$${p.basePrice || "0"}`,
        });
      }
    }
    return Array.from(seenNames.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [dbProducts]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return allProducts;
    const s = productSearch.toLowerCase();
    return allProducts.filter((p) =>
      p.name.toLowerCase().includes(s) || p.category.toLowerCase().includes(s)
    );
  }, [allProducts, productSearch]);

  const filteredClients = useMemo(() => {
    if (!clientSearch) return dbClients;
    const s = clientSearch.toLowerCase();
    return dbClients.filter((c: DbClient) =>
      c.companyName?.toLowerCase().includes(s) || c.contactName?.toLowerCase().includes(s)
    );
  }, [dbClients, clientSearch]);

  // Logo upload
  const handleLogoFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/svg+xml", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(jpe?g|png|svg|webp|gif)$/i)) {
      toast.error("Please upload an image file (JPEG, PNG, SVG, WebP, GIF)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File is too large. Maximum size is 10MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    setLogoName(file.name);
    setIsUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      if (selectedClient?.id && selectedClient.id > 0) {
        const result = await uploadClientLogoMut.mutateAsync({
          clientId: selectedClient.id,
          fileName: file.name,
          fileData: base64,
          mimeType: file.type || "image/png",
          fileSize: file.size,
          isPrimary: clientLogos.length === 0,
        });
        setLogoUrl(result.logoUrl);
        refetchLogos();
        toast.success("Logo uploaded and saved to client library");
      } else {
        const result = await uploadLogoMut.mutateAsync({
          fileName: file.name,
          fileData: base64,
          mimeType: file.type || "image/png",
        });
        setLogoUrl(result.url);
        toast.success("Logo uploaded");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err) || "Couldn't upload the logo");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [uploadClientLogoMut, uploadLogoMut, selectedClient, clientLogos, refetchLogos]);

  const handleSelectExistingLogo = useCallback((logo: ClientLogo) => {
    setLogoUrl(logo.logoUrl);
    setLogoName(logo.logoName);
    setLogoPreview(logo.logoUrl);
    toast.success(`Selected: ${logo.logoName}`);
  }, []);

  // Toggle product selection
  const toggleProduct = useCallback((id: number) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedProductIds(new Set(filteredProducts.map((p) => p.id)));
  }, [filteredProducts]);

  const deselectAll = useCallback(() => {
    setSelectedProductIds(new Set());
  }, []);

  //  Bulk Generate Proofs 
  const handleBulkGenerate = useCallback(async () => {
    if (selectedProductIds.size === 0) {
      toast.error("Please select at least one product");
      return;
    }
    setIsRendering(true);
    setStep("rendering");
    setRenderTotal(selectedProductIds.size);
    setRenderProgress(0);

    try {
      // Step 1: Bulk create proof records
      const productIds = Array.from(selectedProductIds);
      const created = await bulkCreateMut.mutateAsync({
        proposalId: proposalId ?? undefined,
        clientId: selectedClient && selectedClient.id > 0 ? selectedClient.id : undefined,
        logoUrl: logoUrl || undefined,
        logoName: logoName || undefined,
        productIds,
      });

      if (created.length === 0) {
        toast.error("No proofs could be created. Make sure products exist in your catalog.");
        setStep("select_products");
        setIsRendering(false);
        return;
      }

      // Step 2: Render proofs one by one (for progress tracking)
      const results: ProofResult[] = [];
      for (let i = 0; i < created.length; i++) {
        setRenderProgress(i + 1);
        try {
          const rendered = await renderProofMut.mutateAsync({ proofId: created[i].id });
          results.push(rendered);
            } catch (err: unknown) {
          log.error(`Failed to render proof for ${created[i].productName}:`, err);
          results.push({ ...created[i], status: "draft" } as ProofResult);
        }
      }

      setProofResults(results);
      setStep("results");
      refetchProofs();
      const successCount = results.filter(r => r.status === "ready").length;
      toast.success(`${successCount} of ${results.length} proofs generated successfully`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err) || "Couldn't generate the proofs");
      setStep("select_products");
    } finally {
      setIsRendering(false);
    }
  }, [selectedProductIds, proposalId, selectedClient, logoUrl, logoName, bulkCreateMut, renderProofMut, refetchProofs]);

  //  Approve / Reject Individual 
  const handleApproveProof = useCallback(async (proofId: number) => {
    try {
      const updated = await updateStatusMut.mutateAsync({ id: proofId, status: "approved" });
      setProofResults(prev => prev.map(p => p.id === proofId ? { ...p, ...updated } : p));
      refetchProofs();
      toast.success("Proof approved");
    } catch {
      toast.error("Couldn't approve the proof");
    }
  }, [updateStatusMut, refetchProofs]);

  const handleRejectProof = useCallback((proofId: number) => {
    setRevisionProofId(proofId);
    setRevisionText("");
  }, []);

  const handleSubmitRevision = useCallback(async () => {
    if (!revisionProofId || !revisionText.trim()) return;
    setIsRevising(true);
    setProofResults(prev => prev.map(p => p.id === revisionProofId ? { ...p, status: "rendering" } : p));
    try {
      const updated = await reviseProofMut.mutateAsync({
        proofId: revisionProofId,
        revisionNotes: revisionText.trim(),
      });
      setProofResults(prev => prev.map(p => p.id === revisionProofId ? { ...p, ...updated } : p));
      refetchProofs();
      toast.success("Proof revised with your notes");
      setRevisionProofId(null);
      setRevisionText("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err) || "Couldn't revise the proof");
      setProofResults(prev => prev.map(p => p.id === revisionProofId ? { ...p, status: "revision_requested" } : p));
    } finally {
      setIsRevising(false);
    }
  }, [revisionProofId, revisionText, reviseProofMut, refetchProofs]);

  // 3D Viewer handlers
  const handleViewerMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handleViewerMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setViewerRotation(prev => ({
      x: Math.max(-30, Math.min(30, prev.x - dy * 0.3)),
      y: prev.y + dx * 0.3,
    }));
    setDragStart({ x: e.clientX, y: e.clientY });
  }, [isDragging, dragStart]);

  const handleViewerMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const openViewer = useCallback((proof: ProofResult) => {
    setViewerProof(proof);
    setViewerRotation({ x: 0, y: 0 });
    setViewerZoom(1);
  }, []);

  //  Approve All 
  const handleApproveAll = useCallback(async () => {
    const readyProofs = proofResults.filter(p => p.status === "ready");
    if (readyProofs.length === 0) {
      toast.info("No proofs ready to approve");
      return;
    }
    try {
      await approveAllMut.mutateAsync({ proofIds: readyProofs.map(p => p.id) });
      setProofResults(prev => prev.map(p =>
        p.status === "ready" ? { ...p, status: "approved", approvedAt: new Date() } : p
      ));
      refetchProofs();
      toast.success(`${readyProofs.length} proofs approved`);
    } catch {
      toast.error("Couldn't approve all proofs");
    }
  }, [proofResults, approveAllMut, refetchProofs]);

  //  Re-render a single proof 
  const handleReRender = useCallback(async (proofId: number) => {
    try {
      setProofResults(prev => prev.map(p => p.id === proofId ? { ...p, status: "rendering" } : p));
      const rendered = await renderProofMut.mutateAsync({ proofId });
      setProofResults(prev => prev.map(p => p.id === proofId ? { ...p, ...rendered } : p));
      refetchProofs();
      toast.success("Proof re-generated");
    } catch {
      setProofResults(prev => prev.map(p => p.id === proofId ? { ...p, status: "draft" } : p));
      toast.error("Couldn't re-generate the proof");
    }
  }, [renderProofMut, refetchProofs]);

  //  Delete proof 
  const handleDeleteProof = useCallback(async (proofId: number) => {
    try {
      await deleteProofMut.mutateAsync({ id: proofId });
      setProofResults(prev => prev.filter(p => p.id !== proofId));
      refetchProofs();
      toast.success("Proof deleted");
    } catch {
      toast.error("Couldn't delete the proof");
    }
  }, [deleteProofMut, refetchProofs]);

  //  Export PNG 
  const handleExportPNG = useCallback(async (proofImageUrl: string, productName: string) => {
    try {
      const response = await fetch(proofImageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `proof-${productName.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Proof exported as PNG");
    } catch {
      toast.error("Couldn't export the proof");
    }
  }, []);

  // Reset
  const resetStudio = useCallback(() => {
    setStep("select_client");
    setSelectedClient(null);
    setLogoUrl("");
    setLogoName("");
    setLogoPreview("");
    setSelectedProductIds(new Set());
    setProofResults([]);
    setSelectedProofId(null);
    setClientSearch("");
    setProductSearch("");
    setProposalId(null);
    setReturnToProposal(false);
  }, []);

  // Status badge
  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-600",
      rendering: "bg-blue-100 text-blue-700",
      ready: "bg-green-100 text-green-700",
      approved: "bg-purple-100 text-purple-700",
      revision_requested: "bg-orange-100 text-orange-700",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${styles[status] || styles.draft}`}>
        {status === "revision_requested" ? "Revision" : status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  // Step indicator
  const steps = [
    { id: "select_client", label: "Client", num: 1 },
    { id: "select_logo", label: "Logo", num: 2 },
    { id: "select_products", label: "Products", num: 3 },
    { id: "results", label: "Review & Approve", num: 4 },
  ];
  const stepOrder = ["select_client", "select_logo", "select_products", "rendering", "results"];
  const currentStepIndex = stepOrder.indexOf(step);

  const approvedCount = proofResults.filter(p => p.status === "approved").length;
  const readyCount = proofResults.filter(p => p.status === "ready").length;
  const totalCount = proofResults.length;

  return (
    <DashboardLayout title="Virtual Proofing Studio">
      <div className="p-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Virtual Proofing Studio</h1>
            <p className="text-sm text-gray-500 mt-1">
              AI-powered bulk product mockup generation with decoration effects
              {proposalId && <span className="ml-2 text-indigo-600 font-medium">(Proposal #{proposalId})</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {returnToProposal && (
              <button
                onClick={() => {
                  if (returnPath === "edit-proposal") navigate(`/edit-proposal/${proposalId}?returnFromProofing=1`);
                  else if (returnPath === "create-proposal") navigate(`/create-proposal?proposalId=${proposalId}&returnFromProofing=1`);
                  else if (returnPath === "proposal") navigate(`/proposals/${proposalId}?returnFromProofing=1`);
                  else navigate(`/proposals`);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 hover:border-indigo-300 transition-all duration-150"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Proposal
              </button>
            )}
            <button
              onClick={resetStudio}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" /> New Session
            </button>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-6">
          {steps.map((s, i) => {
            const sIndex = stepOrder.indexOf(s.id);
            const isActive = step === s.id || (step === "rendering" && s.id === "results");
            const isPast = currentStepIndex > sIndex;
            return (
              <React.Fragment key={s.id}>
                {i > 0 && <div className={`flex-1 h-px ${isPast ? "bg-indigo-400" : "bg-gray-200"}`} />}
                <button
                  onClick={() => { if (isPast || isActive) setStep(s.id as Step); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    isActive ? "bg-indigo-600 text-white shadow-md" : isPast ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200" : "bg-gray-100 text-gray-400"
                  } ${isPast || isActive ? "cursor-pointer" : "cursor-default"}`}
                >
                  {isPast ? <CheckCircle2 className="w-4 h-4" /> : <span>{s.num}</span>}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/*  Step 1: Select Client  */}
        {step === "select_client" && (
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Select a Client</h2>
            <p className="text-sm text-gray-500 mb-4">Choose the client this proof session is for</p>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search clients..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {filteredClients.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 mb-4">No clients found.</p>
                <button
                  onClick={() => { setSelectedClient({ id: -1, companyName: "Standalone" } as DbClient); setStep("select_logo"); }}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                >
                  Continue Without Client
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                  {filteredClients.map((client: DbClient) => (
                    <button
                      key={client.id}
                      onClick={() => { setSelectedClient(client); setStep("select_logo"); }}
                      className="border border-gray-200 rounded-xl p-4 text-left hover:border-indigo-400 hover:shadow-md transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{client.companyName}</p>
                          <p className="text-xs text-gray-500 truncate">{client.contactName} — {client.contactEmail}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setSelectedClient({ id: -1, companyName: "Standalone" } as DbClient); setStep("select_logo"); }}
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Skip — continue without selecting a client
                </button>
              </>
            )}
          </div>
        )}

        {/*  Step 2: Select / Upload Logo  */}
        {step === "select_logo" && (
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => { setStep("select_client"); setSelectedClient(null); }} className="p-1.5 rounded-lg hover:bg-gray-100">
                <ArrowLeft className="w-5 h-5 text-gray-500" />
              </button>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedClient && selectedClient.id > 0 ? `Logo for ${selectedClient.companyName}` : "Upload Logo / Artwork"}
                </h2>
                <p className="text-sm text-gray-500">Select an existing logo or upload a new one</p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.svg,.webp,.gif,image/jpeg,image/png,image/svg+xml,image/webp,image/gif"
              onChange={handleLogoFileChange}
              className="hidden"
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                {/* Existing Client Logos */}
                {selectedClient && selectedClient.id > 0 && clientLogos.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4" />
                      {selectedClient.companyName}'s Logo Library ({clientLogos.length})
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      {clientLogos.map((logo: ClientLogo) => (
                        <button
                          key={logo.id}
                          onClick={() => handleSelectExistingLogo(logo)}
                          className={`relative border rounded-xl p-3 text-center hover:border-indigo-400 hover:shadow-md transition-all ${
                            logoUrl === logo.logoUrl ? "border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50" : "border-gray-200"
                          }`}
                        >
                          <img src={logo.logoUrl} alt={logo.logoName} className="w-full h-16 object-contain mb-2" />
                          <p className="text-xs text-gray-600 truncate">{logo.logoName}</p>
                          {logoUrl === logo.logoUrl && (
                            <div className="absolute inset-0 bg-indigo-500/10 rounded-xl flex items-center justify-center">
                              <CheckCircle2 className="w-6 h-6 text-indigo-600" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Upload */}
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Upload Logo
                </h3>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all"
                >
                  {isUploading ? (
                    <div className="flex flex-col items-center">
                      <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-3" />
                      <p className="text-sm font-medium text-gray-700">Uploading...</p>
                    </div>
                  ) : logoPreview && logoUrl ? (
                    <div className="flex flex-col items-center">
                      <img src={logoPreview} alt="Logo" className="max-h-24 max-w-40 object-contain mb-3" />
                      <p className="text-sm font-medium text-green-600">{logoName}</p>
                      <p className="text-xs text-gray-500 mt-1">Click to change</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <Upload className="w-10 h-10 text-gray-400 mb-3" />
                      <p className="text-sm font-medium text-gray-700">Click to browse files</p>
                      <p className="text-xs text-gray-500 mt-1">JPEG, PNG, SVG, WebP — max 10MB</p>
                    </div>
                  )}
                </button>

                <button
                  onClick={() => {
                    if (!logoUrl) toast.info("Proceeding without a logo — AI will generate a sample decoration");
                    setStep("select_products");
                  }}
                  disabled={isUploading}
                  className="mt-4 w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  Continue to Select Products <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Right: Preview */}
              <div className="bg-gray-50 rounded-xl p-6 flex flex-col items-center justify-center">
                <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider font-medium">Selected Logo Preview</p>
                {logoPreview ? (
                  <>
                    <div className="w-48 h-48 bg-white rounded-xl border border-gray-200 flex items-center justify-center p-4 mb-4">
                      <img src={logoPreview} alt="Selected Logo" className="max-h-full max-w-full object-contain" />
                    </div>
                    <p className="text-sm font-medium text-gray-900">{logoName}</p>
                  </>
                ) : (
                  <div className="w-48 h-48 bg-white rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-4 mb-4">
                    <ImageIcon className="w-12 h-12 text-gray-300 mb-2" />
                    <p className="text-xs text-gray-400 text-center">No logo selected</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/*  Step 3: Select Products (Multi-Select)  */}
        {step === "select_products" && (
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setStep("select_logo")} className="p-1.5 rounded-lg hover:bg-gray-100">
                <ArrowLeft className="w-5 h-5 text-gray-500" />
              </button>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900">Select Products for Proofing</h2>
                <p className="text-sm text-gray-500">Select multiple products to generate proofs in bulk. AI will auto-detect the best decoration method for each.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-indigo-600">{selectedProductIds.size} selected</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mb-4">
              <button onClick={deselectAll} className="px-3 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors duration-150">
                Clear selection
              </button>
            </div>

            {allProducts.length === 0 ? (
              <div className="text-center py-16">
                <Shirt className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">No Products in Catalog</h3>
                <p className="text-sm text-gray-500 mb-4">Add products to your catalog first, then return here to generate proofs.</p>
                <button
                  onClick={() => navigate("/product-curation")}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors duration-150"
                >
                  Go to Product Curation
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <GroupedProductGrid
                    selectedIds={Array.from(selectedProductIds)}
                    onChange={(next) => setSelectedProductIds(new Set(next))}
                    showSearch
                    emptyTitle="No products match"
                    emptyDescription="Try a different search term."
                  />
                </div>

                {/* Generate Button */}
                <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-500">
                    {selectedProductIds.size} product{selectedProductIds.size !== 1 ? "s" : ""} selected for proofing
                  </p>
                  <button
                    onClick={handleBulkGenerate}
                    disabled={selectedProductIds.size === 0}
                    className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md"
                  >
                    <Sparkles className="w-4 h-4" />
                    Generate {selectedProductIds.size} Proof{selectedProductIds.size !== 1 ? "s" : ""}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/*  Rendering Progress  */}
        {step === "rendering" && (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <div className="max-w-md mx-auto">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 animate-spin" style={{ animationDuration: "3s" }}>
                  <div className="absolute inset-1 rounded-full bg-white" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-indigo-600" />
                </div>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Generating Proofs</h2>
              <p className="text-sm text-gray-500 mb-6">
                AI is rendering photorealistic mockups for {renderTotal} product{renderTotal !== 1 ? "s" : ""}...
              </p>

              {/* Progress bar */}
              <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-purple-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${renderTotal > 0 ? (renderProgress / renderTotal) * 100 : 0}%` }}
                />
              </div>
              <p className="text-sm font-medium text-gray-700">
                {renderProgress} of {renderTotal} complete
              </p>
              <p className="text-xs text-gray-400 mt-2">Each proof takes 10–20 seconds</p>
            </div>
          </div>
        )}

        {/*  Step 4: Review & Approve Results  */}
        {step === "results" && (
          <>
            {/* 3D Interactive Viewer Modal */}
            {viewerProof && (
              <VirtualProofingViewer
                proof={viewerProof}
                onClose={() => setViewerProof(null)}
                onDownload={handleExportPNG}
              />
            )}

            {/* Revision Notes Dialog */}
            {revisionProofId !== null && (
              <ProofRevisionDialog
                revisionText={revisionText}
                isRevising={isRevising}
                onTextChange={setRevisionText}
                onSubmit={handleSubmitRevision}
                onCancel={() => setRevisionProofId(null)}
              />
            )}

            {/* Fullscreen overlay (legacy fallback) */}
            {fullscreenProof && !viewerProof && (
              <div className="fixed inset-0 z-[10002] bg-black/90 flex items-center justify-center" onClick={() => setFullscreenProof(null)}>
                <button onClick={() => setFullscreenProof(null)} className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white">
                  <Minimize2 className="w-5 h-5" />
                </button>
                <img src={fullscreenProof} alt="Fullscreen Proof" className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl p-6">
              {/* Header with stats */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Review & Approve Proofs</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {approvedCount} approved, {readyCount} ready for review, {totalCount} total
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {readyCount > 0 && (
                    <button
                      onClick={handleApproveAll}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 flex items-center gap-2 shadow-md"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Approve All ({readyCount})
                    </button>
                  )}
                  {returnToProposal && (
                    <button
                     onClick={() => {
                  if (returnPath === "edit-proposal") navigate(`/edit-proposal/${proposalId}?returnFromProofing=1`);
                  else if (returnPath === "proposal") navigate(`/proposals/${proposalId}?returnFromProofing=1`);
                  else if (returnPath === "create-proposal" && proposalId) navigate(`/create-proposal?proposalId=${proposalId}&returnFromProofing=1`);
                  else navigate(`/create-proposal?returnFromProofing=1`);
                }}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 flex items-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back to Proposal
                    </button>
                  )}
                </div>
              </div>

              {/* Summary bar */}
              <div className="flex gap-4 mb-6">
                <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{approvedCount}</p>
                  <p className="text-xs text-green-600 font-medium">Approved</p>
                </div>
                <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-700">{readyCount}</p>
                  <p className="text-xs text-blue-600 font-medium">Ready</p>
                </div>
                <div className="flex-1 bg-orange-50 border border-orange-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-orange-700">{proofResults.filter(p => p.status === "revision_requested").length}</p>
                  <p className="text-xs text-orange-600 font-medium">Revision</p>
                </div>
                <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-700">{proofResults.filter(p => p.status === "draft" || (p as ProofResult & { renderError?: string }).renderError).length}</p>
                  <p className="text-xs text-gray-600 font-medium">Failed</p>
                </div>
              </div>

              {/* Proof Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {proofResults.map((proof) => (
                  <div
                    key={proof.id}
                    className={`border rounded-xl overflow-hidden transition-all ${
                      proof.status === "approved" ? "border-green-300 bg-green-50/30" :
                      proof.status === "ready" ? "border-blue-200" :
                      proof.status === "rendering" ? "border-blue-300 bg-blue-50/30" :
                      proof.status === "revision_requested" ? "border-orange-300 bg-orange-50/30" :
                      "border-gray-200"
                    }`}
                  >
                    {/* Image */}
                    <div className="relative bg-gray-50 h-48 flex items-center justify-center group">
                      {proof.status === "rendering" ? (
                        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                      ) : proof.proofImageUrl ? (
                        <>
                          <img
                            src={proof.proofImageUrl}
                            alt={proof.productName}
                            className="h-full w-full object-contain p-2"
                          />
                          {/* Hover toolbar */}
                          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-full px-2 py-1 shadow-md opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openViewer(proof)} className="p-1 hover:bg-gray-100 rounded-full" title="3D Viewer">
                              <Box className="w-3.5 h-3.5 text-gray-600" />
                            </button>
                            <button onClick={() => setFullscreenProof(proof.proofImageUrl)} className="p-1 hover:bg-gray-100 rounded-full" title="Fullscreen">
                              <Maximize2 className="w-3.5 h-3.5 text-gray-600" />
                            </button>
                            <button onClick={() => handleExportPNG(proof.proofImageUrl ?? "", proof.productName)} className="p-1 hover:bg-gray-100 rounded-full" title="Download">
                              <Download className="w-3.5 h-3.5 text-gray-600" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="text-center">
                          <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-1" />
                          <p className="text-xs text-gray-500">{(proof as ProofResult & { renderError?: string }).renderError || "No image"}</p>
                        </div>
                      )}

                      {/* Status badge overlay */}
                      <div className="absolute top-2 right-2">
                        {statusBadge(proof.status)}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-3">
                      <p className="text-sm font-semibold text-gray-900 truncate">{proof.productName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {DECORATION_METHODS.find(d => d.id === proof.decorationMethod)?.icon}{" "}
                        {DECORATION_METHODS.find(d => d.id === proof.decorationMethod)?.label || proof.decorationMethod}
                      </p>
                      {proof.revisionNotes && proof.status === "revision_requested" && (
                        <p className="text-xs text-orange-600 mt-1 bg-orange-50 rounded px-2 py-1 line-clamp-2">
                          Revision: {proof.revisionNotes}
                        </p>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mt-3">
                        {proof.status === "ready" && (
                          <>
                            <button
                              onClick={() => handleApproveProof(proof.id)}
                              className="flex-1 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 flex items-center justify-center gap-1"
                            >
                              <Check className="w-3 h-3" /> Approve
                            </button>
                            <button
                              onClick={() => handleRejectProof(proof.id)}
                              className="flex-1 py-1.5 border border-orange-300 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-50 flex items-center justify-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" /> Revise
                            </button>
                          </>
                        )}
                        {proof.status === "approved" && (
                          <div className="flex-1 py-1.5 bg-green-100 text-green-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Approved
                          </div>
                        )}
                        {(proof.status === "draft" || proof.status === "revision_requested") && (
                          <button
                            onClick={() => handleReRender(proof.id)}
                            className="flex-1 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 flex items-center justify-center gap-1"
                          >
                            <Sparkles className="w-3 h-3" /> Re-generate
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteProof(proof.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {proofResults.length === 0 && (
                <div className="text-center py-12">
                  <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">No proofs generated yet</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
