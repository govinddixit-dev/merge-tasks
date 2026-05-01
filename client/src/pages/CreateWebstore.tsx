/**
 * Create Webstore — Multi-Step Wizard
 * State is managed via WebstoreContext (useReducer) so step components
 * read/write only what they need — no prop drilling.
 */

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  Building2, Globe, Store, Package, Palette, CreditCard, Rocket,
  ChevronRight, ChevronLeft, Check, FileText, Shield, Mail, ArrowRight,
  Download, Loader2, CheckCircle2, Monitor, Eye, Clock, Layout,
  Lock, Server, Users, Sparkles, Network
} from "lucide-react";
import { toast } from "sonner";
import { getLogger } from "@/lib/logger";
import {
  Step1CompanyInfo,
  Step2Domain,
  Step3StoreType,
  Step4Divisions,
  Step4Duration,
  Step5Template,
  Step6Catalog,
  Step7Branding,
  Step8Checkout,
  Step9ReviewLaunch,
  SSO_PROVIDERS,
  CHECKOUT_METHODS,
  WebstoreProvider,
  useWebstore,
} from "@/components/webstore";
import { RBAC_TIERS } from "@/components/webstore/types";

const log = getLogger("CreateWebstore");

const STEPS = [
  { id: 1, label: "Company Info", icon: Building2 },
  { id: 2, label: "Domain", icon: Globe },
  { id: 3, label: "Store Type", icon: Store },
  { id: 4, label: "Divisions", icon: Network },
  { id: 5, label: "Duration", icon: Clock },
  { id: 6, label: "Template", icon: Layout },
  { id: 7, label: "Catalog", icon: Package },
  { id: 8, label: "Branding", icon: Palette },
  { id: 9, label: "Checkout", icon: CreditCard },
  { id: 10, label: "Review & Launch", icon: Rocket },
];

const LAST_STEP = 10;

//  Inner wizard (has access to context) 

function CreateWebstoreInner() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [maxReachedStep, setMaxReachedStep] = useState(1);
  const { state, set, dispatch } = useWebstore();

  //  Real data from DB 
  const { data: _dbClientsRaw } = trpc.clients.list.useQuery();
  const dbClients = (_dbClientsRaw && 'items' in _dbClientsRaw ? _dbClientsRaw.items : null) ?? [];
  const { data: _dbProductsRaw } = trpc.products.list.useQuery();
  const dbProducts = _dbProductsRaw?.items ?? [];
  const { data: _dbStoresRaw } = trpc.stores.list.useQuery();
  const dbStores = _dbStoresRaw?.items ?? [];
  const { data: distBranding } = trpc.branding.get.useQuery();
  const createStore = trpc.stores.create.useMutation();
  const assignProducts = trpc.stores.assignProducts.useMutation();
  const aiOptimize = trpc.stores.aiOptimize.useMutation();

  const selectedClient = dbClients.find(c => c.id === state.selectedClientId);
  const companyName = selectedClient?.companyName || "";

  // Auto-select first 5 active products on first load
  useEffect(() => {
    if (!state.autoSelected && dbProducts.length > 0 && state.addedProductIds.length === 0) {
      set("autoSelected", true);
      set("addedProductIds", dbProducts.filter(p => p.status === "active").slice(0, 5).map(p => p.id));
    }
  }, [dbProducts, state.autoSelected, state.addedProductIds.length]);

  const permanentStores = useMemo(() =>
    dbStores.filter(s => s.storeType === "permanent" && s.status === "active").map(s => ({
      id: String(s.id),
      name: s.name,
      domain: `${s.slug}.mergetasks.com`,
    })),
    [dbStores]
  );

  const filteredCatalogProducts = useMemo(() => {
    let filtered = dbProducts.filter(p => p.status === "active");
    if (state.selectedCategories.length > 0) {
      filtered = filtered.filter(p => state.selectedCategories.includes(p.category || ""));
    }
    if (state.catalogSearch) {
      const s = state.catalogSearch.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(s) ||
        (p.sku && p.sku.toLowerCase().includes(s)) ||
        (p.category && p.category.toLowerCase().includes(s))
      );
    }
    return filtered;
  }, [dbProducts, state.selectedCategories, state.catalogSearch]);

  const displayDomain = state.useCustomDomain && state.customDomain
    ? state.customDomain
    : state.subdomain
      ? `${state.subdomain.toLowerCase().replace(/\s+/g, "-")}.mergetasks.com`
      : companyName
        ? `${companyName.toLowerCase().replace(/\s+/g, "-")}.mergetasks.com`
        : "client.mergetasks.com";

  const tierLabel = (() => {
    if (state.ssoProvider === "microsoft" || state.ssoProvider === "okta") {
      return state.employeeCount && parseInt(state.employeeCount) > 5000 ? "Enterprise+" : "Enterprise";
    }
    if (state.ssoProvider === "google") return "Professional";
    return "Starter";
  })();

  const deploySteps = [
    "Creating tenant...",
    "Provisioning DNS...",
    "Importing data...",
    "AI optimizing storefront...",
    "Applying branding...",
    state.ssoProvider !== "none" ? "Generating SSO setup link..." : "Configuring email login...",
  ];

  const validateStep = (s: number): string | null => {
    switch (s) {
      case 1:
        if (!state.selectedClientId) return "Please select a client to continue.";
        if (state.pocEnabled && state.pocs.length > 0 && !state.pocs[0].name) return "Please enter a name for the Point of Contact.";
        if (state.pocEnabled && state.pocs.length > 0 && !state.pocs[0].email) return "Please enter an email for the Point of Contact.";
        return null;
      case 2:
        if (!state.subdomain && !companyName) return "Please enter a subdomain for the store.";
        if (state.subdomain && state.subdomainAvailable === false)
          return "This subdomain isn't available. Please pick another one.";
        return null;
      case 3:
        if (!state.enablePromo && !state.enablePrint)
          return "Please select a store type before continuing.";
        return null;
      case 4:
        if (state.multiDivisionEnabled && state.divisions.length === 0)
          return "Add at least one division, or turn multi-division off to continue.";
        if (state.multiDivisionEnabled && state.divisions.some(d => !d.name.trim()))
          return "Every division needs a name.";
        if (state.multiDivisionEnabled && state.divisions.some(d => !d.pocEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.pocEmail || "")))
          return "Every division needs a valid POC email address.";
        return null;
      case 5:
        if (state.storeDuration === "popup" && (!state.popupStartDate || !state.popupEndDate))
          return "Please set both a start and end date for the pop-up store.";
        return null;
      case 7:
        if (state.addedProductIds.length === 0 && state.catalogBlocks.every(b => b.subCategories.every(sc => sc.productIds.length === 0)))
          return "Please add at least one product to the catalog.";
        return null;
      case 8:
        if (!state.brandColor && !state.heroBannerUrl)
          return "Please configure at least a brand color or upload a hero banner for branding.";
        return null;
      default:
        return null;
    }
  };

  // Pre-flight checks shown on the final step before Launch is allowed
  const preflightErrors = useMemo(() => {
    const errors: { step: number; label: string; message: string }[] = [];
    if (!state.selectedClientId)
      errors.push({ step: 1, label: "Client", message: "No client selected" });
    if (!state.subdomain && !companyName)
      errors.push({ step: 2, label: "Domain", message: "No subdomain configured" });
    if (
      state.addedProductIds.length === 0 &&
      state.catalogBlocks.every(b => b.subCategories.every(sc => sc.productIds.length === 0))
    )
      errors.push({ step: 7, label: "Catalog", message: "No products added to the store" });
    if (state.storeDuration === "popup" && state.popupStartDate && state.popupEndDate &&
      new Date(state.popupEndDate) <= new Date(state.popupStartDate))
      errors.push({ step: 5, label: "Duration", message: "Pop-up end date must be after start date" });
    if (state.multiDivisionEnabled && state.divisions.length === 0)
      errors.push({ step: 4, label: "Divisions", message: "Multi-division is on but no divisions were added" });
    if (state.pocEnabled && state.pocs.length > 0 && state.pocs[0].email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.pocs[0].email))
      errors.push({ step: 1, label: "POC Email", message: "POC email address is not valid" });
    return errors;
  }, [state.selectedClientId, state.subdomain, companyName, state.addedProductIds, state.catalogBlocks,
      state.storeDuration, state.popupStartDate, state.popupEndDate, state.pocEnabled, state.pocs]);

  const canLaunch = preflightErrors.length === 0;

  // Multi-division requires SSO — if no SSO, Step 4 (Divisions) is hidden entirely.
  const hasSso = state.ssoProvider !== "none" && state.ssoProvider !== "";

  // If SSO is removed after enabling multi-division, auto-clear to keep state consistent.
  useEffect(() => {
    if (!hasSso && state.multiDivisionEnabled) {
      dispatch({ type: "SET_MULTI_DIVISION_ENABLED", enabled: false });
      dispatch({ type: "SET_DIVISIONS", divisions: [] });
    }
  }, [hasSso, state.multiDivisionEnabled, dispatch]);

  const handleNext = () => {
    const err = validateStep(step);
    if (err) { toast.error(err); return; }
    if (step < LAST_STEP) {
      let next = step + 1;
      // Skip Divisions step when SSO is not configured
      if (next === 4 && !hasSso) next = 5;
      setStep(next);
      setMaxReachedStep(prev => Math.max(prev, next));
    }
  };

  /**
   * Skip the divisions step intentionally: clear any divisions the user
   * typed, preserve the multi-division toggle (so the store keeps the
   * flag), and advance without firing step-4 validation (which would
   * otherwise reject an empty division list).
   */
  const handleSkipDivisions = () => {
    dispatch({ type: "SET_DIVISIONS", divisions: [] });
    if (step === 4 && step < LAST_STEP) {
      const next = step + 1;
      setStep(next);
      setMaxReachedStep(prev => Math.max(prev, next));
    }
  };
  const handleBack = () => {
    if (step > 1) {
      let prev = step - 1;
      if (prev === 4 && !hasSso) prev = 3;
      setStep(prev);
    }
  };

  // Save as draft and navigate to preview
  const handleSaveDraftAndPreview = async () => {
    if (!state.selectedClientId) { toast.error("Please select a client first."); return; }
    try {
      const slug = (state.subdomain || companyName || "store")
        .toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const store = await createStore.mutateAsync({
        clientId: state.selectedClientId,
        name: companyName || "New Store",
        slug: `${slug}-draft-${Date.now()}`,
        storeType: state.storeDuration === "popup" ? "popup" : "permanent",
        primaryColor: state.brandColor,
        bannerUrl: state.heroBannerUrl || undefined,
        stripeEnabled: state.enabledCheckout.includes("cc"),
        rbacEnabled: state.rbacEnabled,
        multiDepartment: state.budgetEnabled,
        // TODO: approvalEnabled has no DB column yet — leave unmapped
        // until a `approvalEnabled` / `approvalWorkflow` field is added
        // to stores. Do not silently drop it elsewhere.
        ssoEnabled: false,
        ssoProvider: "none" as const,
        status: "draft" as const,
        template: (state.selectedTemplate as "classic" | "modern" | "minimal") || "modern",
        origin: window.location.origin,
      });
      set("createdStoreId", store.id);
      if (state.addedProductIds.length > 0) {
        await assignProducts.mutateAsync({ storeId: store.id, products: state.addedProductIds.map(pid => ({ productId: pid })) });
      }
      try { await aiOptimize.mutateAsync({ storeId: store.id }); } catch {}
      navigate(`/store-preview/${store.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save draft.");
    }
  };

  const handleLaunch = async () => {
    if (!state.selectedClientId) { toast.error("Please select a client before launching."); return; }
    if (!state.subdomain && !companyName) { toast.error("Please set a subdomain for the store."); return; }
    if (state.addedProductIds.length === 0) { toast.error("Please add at least one product to the store."); return; }

    set("deploying", true);
    set("deployStep", 0);

    try {
      const slug = (state.subdomain || companyName || "store")
        .toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

      const isNoSSO = state.ssoProvider === "none" || state.ssoProvider === "";
      const initialUsers: { name: string; email: string; role: "admin" | "manager" | "employee" | "intern"; department?: string }[] = [];
      if (isNoSSO && state.pocEnabled) {
        for (const poc of state.pocs) {
          if (poc.name && poc.email) initialUsers.push({ name: poc.name, email: poc.email, role: "admin" });
        }
        for (const emp of state.storeEmployees) {
          if (emp.name && emp.email) initialUsers.push({ name: emp.name, email: emp.email, role: (emp.role as "admin" | "employee" | "manager") || "employee", department: emp.department || undefined });
        }
      }

      // TODO(phase-1.5): reintroduce divisions payload once the create-store
      // mutation accepts the new location hierarchy. The `divisions` field
      // was dropped from the mutation input when the divisions table was
      // removed in migration 0082.

      // When multi-division is enabled, seed division POCs as initial store admins
      // so they receive Tier 2 branded invites on launch.
      if (state.multiDivisionEnabled) {
        for (const d of state.divisions) {
          if (d.pocEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.pocEmail)) {
            initialUsers.push({ name: `${d.name} POC`, email: d.pocEmail.trim(), role: "admin", department: d.name });
          }
        }
      }

      const store = await createStore.mutateAsync({
        clientId: state.selectedClientId,
        name: companyName || "New Store",
        slug,
        storeType: state.storeDuration === "popup" ? "popup" : "permanent",
        primaryColor: state.brandColor,
        bannerUrl: state.heroBannerUrl || undefined,
        stripeEnabled: state.enabledCheckout.includes("cc"),
        rbacEnabled: state.rbacEnabled,
        multiDepartment: state.budgetEnabled,
        // TODO: approvalEnabled has no DB column yet — leave unmapped
        // until a `approvalEnabled` / `approvalWorkflow` field is added
        // to stores. Do not silently drop it elsewhere.
        ssoEnabled: state.ssoProvider !== "none" && state.ssoProvider !== "",
        ssoProvider: state.ssoProvider === "microsoft" ? "microsoft_entra" as const
          : state.ssoProvider === "google" ? "google_workspace" as const
          : state.ssoProvider === "okta" ? "okta" as const
          : "none" as const,
        startDate: state.popupStartDate ? new Date(state.popupStartDate) : undefined,
        endDate: state.popupEndDate ? new Date(state.popupEndDate) : undefined,
        linkedStoreId: state.linkToPermanent && state.linkedStoreId ? Number(state.linkedStoreId) : undefined,
        status: "active",
        template: (state.selectedTemplate as "classic" | "modern" | "minimal") || "modern",
        initialUsers: initialUsers.length > 0 ? initialUsers : undefined,
        origin: window.location.origin,
      });

      set("createdStoreId", store.id);
      set("deployStep", 1);

      if (state.addedProductIds.length > 0) {
        await assignProducts.mutateAsync({ storeId: store.id, products: state.addedProductIds.map(pid => ({ productId: pid })) });
      }
      set("deployStep", 2);
      set("deployStep", 3);

      try {
        const aiResult = await aiOptimize.mutateAsync({ storeId: store.id });
        if (aiResult) {
          set("aiTagline", aiResult.tagline || "");
          set("aiHeroHeadline", aiResult.heroHeadline || "");
          set("aiHeroSubtitle", aiResult.heroSubtitle || "");
          set("aiTemplateSuggestion", aiResult.templateSuggestion || "");
          set("aiIndustryTheme", aiResult.industryTheme || "");
        }
      } catch (aiErr: unknown) {
        log.warn("[AI Optimize] Non-critical failure:", aiErr);
      }
      set("deployStep", 4);

      let s = 5;
      const interval = setInterval(() => {
        if (s >= deploySteps.length) {
          clearInterval(interval);
          set("deployStep", deploySteps.length);
          set("deployed", true);
          set("deploying", false);
        } else {
          set("deployStep", s);
          s++;
        }
      }, 700);
    } catch (err: unknown) {
      log.error("Store creation failed:", err);
      set("deploying", false);
      set("deployStep", -1);
      toast.error(err instanceof Error ? err.message : "Failed to create store. Please try again.");
    }
  };

  //  Deployed Success View 
  if (state.deployed) {
    const isSSO = state.ssoProvider !== "none" && state.ssoProvider !== "";
    return (
      <DashboardLayout title="Store Created" subtitle={`${companyName || "New Client"} is live`}>
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <div className="w-20 h-20 rounded-full bg-[#F0FDF4] flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 size={40} className="text-[#16A34A]" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-mt-ink mb-2">{companyName || "New Client"} is Live!</h1>
            <p className="text-[14px] text-mt-ink-3">
              Store deployed at <span className="font-semibold text-primary">{displayDomain}</span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white border border-mt-border rounded-xl p-5">
              <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-1">Tier</p>
              <p className="text-[16px] font-bold text-mt-ink">{tierLabel}</p>
            </div>
            <div className="bg-white border border-mt-border rounded-xl p-5">
              <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-1">Products</p>
              <p className="text-[16px] font-bold text-mt-ink">{state.addedProductIds.length}</p>
            </div>
            <div className="bg-white border border-mt-border rounded-xl p-5">
              <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-1">Auth</p>
              <p className="text-[16px] font-bold text-mt-ink">{SSO_PROVIDERS.find(p => p.id === state.ssoProvider)?.name || "Email"}</p>
            </div>
          </div>

          {/* AI-Generated Content Highlights */}
          {(state.aiHeroHeadline || state.aiTagline) && (
            <div className="bg-gradient-to-br from-[#F5F3FF] to-[#EDE9FE] border border-[#DDD6FE] rounded-xl p-5 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                  <Sparkles size={14} className="text-white" />
                </div>
                <p className="text-[13px] font-bold text-[#4C1D95]">AI Generated Your Store Content</p>
                {state.aiIndustryTheme && (
                  <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {state.aiIndustryTheme}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {state.aiHeroHeadline && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#7C3AED] mb-0.5">Hero Headline</p>
                    <p className="text-[14px] font-bold text-mt-ink">{state.aiHeroHeadline}</p>
                  </div>
                )}
                {state.aiTagline && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#7C3AED] mb-0.5">Tagline</p>
                    <p className="text-[14px] italic text-[#374151]">&ldquo;{state.aiTagline}&rdquo;</p>
                  </div>
                )}
                {state.aiHeroSubtitle && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#7C3AED] mb-0.5">Hero Subtitle</p>
                    <p className="text-[13px] text-mt-ink-2">{state.aiHeroSubtitle}</p>
                  </div>
                )}
                {state.aiTemplateSuggestion && state.aiTemplateSuggestion !== state.selectedTemplate && (
                  <div className="mt-2 pt-2 border-t border-[#DDD6FE]">
                    <p className="text-[11px] text-[#7C3AED]">
                      AI recommended the <strong>{state.aiTemplateSuggestion}</strong> template for {companyName || "this client"}&apos;s industry
                      &nbsp;&mdash; it was automatically applied to the live store.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {isSSO ? (
            <div className="bg-white border border-mt-border rounded-xl p-6 sm:p-8 mb-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-mt-brand-light flex items-center justify-center flex-shrink-0">
                  <Shield size={24} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-mt-ink mb-1">IT Readiness Packet Generated</h3>
                  <p className="text-[13px] text-mt-ink-3">
                    An automated email has been sent to <span className="font-semibold text-mt-ink">{state.pocEnabled && state.pocs[0]?.name ? state.pocs[0].name : "the POC"}</span> at{" "}
                    <span className="font-semibold text-primary">{state.pocEnabled && state.pocs[0]?.email ? state.pocs[0].email : "poc@company.com"}</span> with the IT Readiness Packet attached.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold text-white"
                  style={{ backgroundColor: 'var(--mt-brand)' }}
                  onClick={() => set("showItPacket", true)}
                >
                  <Download size={14} /> Download IT Packet (PDF)
                </button>
                <button
                  className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink hover:bg-mt-surface"
                  onClick={() => navigate("/it-admin")}
                >
                  <Monitor size={14} /> Preview IT Admin Portal
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-mt-border rounded-xl p-6 sm:p-8 mb-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-[#F0FDF4] flex items-center justify-center flex-shrink-0">
                  <Mail size={24} className="text-[#16A34A]" />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-mt-ink mb-1">Onboarding Email Sent</h3>
                  <p className="text-[13px] text-mt-ink-3">
                    A welcome email has been sent to <span className="font-semibold text-primary">{state.pocEnabled && state.pocs[0]?.email ? state.pocs[0].email : "poc@company.com"}</span> with login credentials and an employee invite link.
                  </p>
                </div>
              </div>
              <button className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink hover:bg-mt-surface">
                <Mail size={14} /> Resend Welcome Email
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold text-white"
              style={{ backgroundColor: "#16A34A" }}
              onClick={() => {
                const slug = (state.subdomain || companyName || "store").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
                window.open(`/s/${slug}`, "_blank");
              }}
            >
              <Eye size={14} /> Visit Live Store
            </button>
            <button
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold text-white"
              style={{ backgroundColor: 'var(--mt-brand)' }}
              onClick={() => state.createdStoreId ? navigate(`/store-management/${state.createdStoreId}`) : navigate("/webstores")}
            >
              Manage Store <ArrowRight size={14} />
            </button>
            <button
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink hover:bg-mt-surface"
              onClick={() => navigate("/webstores")}
            >
              <Monitor size={14} /> View All Stores
            </button>
          </div>

          {/* IT Packet PDF Modal */}
          {state.showItPacket && (
            <div className="fixed inset-0 z-[10002] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
              <div className="w-full max-w-2xl bg-white rounded-xl shadow-lg max-h-[90vh] overflow-y-auto mx-4">
                <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #F0F0F0" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-mt-brand-light flex items-center justify-center">
                      <FileText size={18} className="text-primary" />
                    </div>
                    <div>
                      <h3 className="text-[16px] font-bold text-mt-ink">IT Readiness Packet</h3>
                      <p className="text-[11px] text-mt-ink-3">{companyName || "Client"} — Generated {new Date().toLocaleDateString()}</p>
                    </div>
                  </div>
                  <button onClick={() => set("showItPacket", false)} className="p-1 hover:bg-mt-surface-2 rounded-lg transition-colors">
                    <Check size={18} className="text-mt-ink-4" />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  <div className="bg-primary rounded-lg p-6 text-white">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield size={20} />
                      <span className="text-[18px] font-bold">MergeTasks</span>
                    </div>
                    <h2 className="text-[22px] font-bold mb-1">IT Readiness Packet</h2>
                    <p className="text-white/80 text-[13px]">Prepared for {companyName || "Your Organization"} — {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
                  </div>

                  <div>
                    <h3 className="text-[14px] font-bold text-mt-ink mb-3 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">1</span>
                      Store Configuration
                    </h3>
                    <div className="bg-mt-surface rounded-lg p-4 space-y-2">
                      {[
                        ["Client", companyName || "—"],
                        ["Domain", displayDomain],
                        ["Tier", tierLabel],
                        ["Store Type", [state.enablePromo && "Promotional", state.enablePrint && "Print"].filter(Boolean).join(" + ")],
                        ["Products", `${state.addedProductIds.length} products`],
                        ["Auth", SSO_PROVIDERS.find(p => p.id === state.ssoProvider)?.name || "Email"],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between text-[12px]">
                          <span className="text-mt-ink-3">{label}</span>
                          <span className="font-semibold text-mt-ink">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[14px] font-bold text-mt-ink mb-3 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">2</span>
                      SSO Configuration
                    </h3>
                    <div className="bg-mt-surface rounded-lg p-4 space-y-3">
                      <div className="flex justify-between text-[12px]"><span className="text-mt-ink-3">Provider</span><span className="font-semibold text-mt-ink">{SSO_PROVIDERS.find(p => p.id === state.ssoProvider)?.name || "N/A"}</span></div>
                      <div className="flex justify-between text-[12px]"><span className="text-mt-ink-3">Protocol</span><span className="font-semibold text-mt-ink">{SSO_PROVIDERS.find(p => p.id === state.ssoProvider)?.protocol || "N/A"}</span></div>
                      <div className="text-[12px] mt-2 p-3 bg-white rounded border border-mt-border">
                        <p className="font-semibold text-mt-ink mb-2">Setup Instructions:</p>
                        <ol className="space-y-1.5 text-mt-ink-2">
                          <li>1. Navigate to <span className="font-mono text-primary">admin.mergetasks.com/sso/{companyName?.toLowerCase().replace(/\s+/g, "-") || "client"}</span></li>
                          <li>2. Upload your IdP metadata XML or enter the SSO URL</li>
                          <li>3. Configure attribute mapping (email, name, department)</li>
                          <li>4. Test SSO connection with a pilot user</li>
                          <li>5. Enable SCIM provisioning for auto user sync</li>
                        </ol>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[14px] font-bold text-mt-ink mb-3 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">3</span>
                      DNS Configuration
                    </h3>
                    <div className="bg-mt-surface rounded-lg p-4">
                      <p className="text-[12px] text-mt-ink-2 mb-3">Add the following CNAME record to your DNS provider:</p>
                      <div className="bg-[#1A1A1A] rounded-lg p-4 font-mono text-[12px]">
                        <div className="text-mt-ink-4">; CNAME Record</div>
                        <div className="text-[#16A34A]">Host: <span className="text-white">{displayDomain.split(".")[0]}</span></div>
                        <div className="text-[#16A34A]">Type: <span className="text-white">CNAME</span></div>
                        <div className="text-[#16A34A]">Value: <span className="text-white">edge.mergetasks.com</span></div>
                        <div className="text-[#16A34A]">TTL: <span className="text-white">300</span></div>
                      </div>
                    </div>
                  </div>

                  {state.rbacEnabled && (
                    <div>
                      <h3 className="text-[14px] font-bold text-mt-ink mb-3 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">4</span>
                        RBAC Checkout Configuration
                      </h3>
                      <div className="bg-mt-surface rounded-lg p-4 space-y-3">
                        <p className="text-[12px] text-mt-ink-2">Pre-configured employee tiers (modifiable from Admin Portal).</p>
                        <div className="space-y-2">
                          {RBAC_TIERS.map((tier, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 bg-white rounded-lg border border-mt-border">
                              <div>
                                <p className="text-[12px] font-semibold text-mt-ink">{tier.name}</p>
                                <p className="text-[11px] text-mt-ink-3">{tier.methods.map(m => CHECKOUT_METHODS.find(cm => cm.id === m)?.name).join(", ")}</p>
                              </div>
                              <span className="text-[11px] font-semibold text-mt-ink-2 bg-mt-surface-2 px-2 py-0.5 rounded">{tier.limit}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="text-[14px] font-bold text-mt-ink mb-3 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">{state.rbacEnabled ? "5" : "4"}</span>
                      Security Overview
                    </h3>
                    <div className="bg-mt-surface rounded-lg p-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { icon: Lock, title: "Data Encryption", lines: ["AES-256-GCM for stored credentials", "TLS 1.2+ for all connections"] },
                          { icon: Shield, title: "Payment Security", lines: ["Stripe Checkout Sessions (PCI SAQ A)", "No card data touches our servers"] },
                          { icon: Eye, title: "Session Security", lines: ["Short-lived JWT access tokens", "Refresh token rotation"] },
                          { icon: Users, title: "Access Controls", lines: ["CSRF protection on all mutations", "Rate limiting on all endpoints"] },
                        ].map(({ icon: Icon, title, lines }) => (
                          <div key={title} className="p-3 bg-white rounded-lg border border-mt-border">
                            <div className="flex items-center gap-2 mb-1.5">
                              <Icon size={12} className="text-[#16A34A]" />
                              <p className="text-[11px] font-bold text-mt-ink">{title}</p>
                            </div>
                            {lines.map(l => <p key={l} className="text-[10px] text-mt-ink-3">{l}</p>)}
                          </div>
                        ))}
                      </div>
                      <div className="p-3 bg-white rounded-lg border border-mt-border">
                        <p className="text-[11px] font-bold text-mt-ink mb-2">Payment Processing</p>
                        <p className="text-[10px] text-mt-ink-3">All payment processing is handled by Stripe, a PCI DSS Level 1 certified payment provider. Card data is entered directly on Stripe's hosted checkout page and never passes through our servers.</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-mt-brand-light rounded-lg p-4">
                    <p className="text-[12px] font-semibold text-primary mb-1">Questions?</p>
                    <p className="text-[12px] text-mt-ink-2">Contact your MergeTasks account manager or email <span className="font-semibold text-primary">support@mergetasks.com</span> for IT setup assistance.</p>
                  </div>
                </div>

                <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: "1px solid #F0F0F0" }}>
                  <button onClick={() => set("showItPacket", false)} className="text-[13px] font-semibold text-mt-ink-3 hover:text-mt-ink transition-colors">Close</button>
                  <button
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white"
                    style={{ backgroundColor: 'var(--mt-brand)' }}
                    onClick={async () => {
                      set("generatingPdf", true);
                      try {
                        const { jsPDF } = await import("jspdf");
                        const doc = new jsPDF();
                        const brandName = distBranding?.brandCompanyName || "MergeTasks";
                        const bColor = distBranding?.brandPrimaryColor || "var(--mt-brand)";
                        const hexToRgb = (hex: string) => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)] as const;
                        const [br, bg, bb] = hexToRgb(bColor);
                        let y = 20;
                        doc.setFillColor(br, bg, bb);
                        doc.rect(0, 0, 210, 40, "F");
                        doc.setTextColor(255, 255, 255);
                        doc.setFontSize(20); doc.setFont("helvetica", "bold");
                        doc.text(brandName, 15, 18);
                        doc.setFontSize(14); doc.text("IT Readiness Packet", 15, 28);
                        doc.setFontSize(9); doc.text(`Prepared for ${companyName || "Client"} — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, 15, 36);
                        y = 52;
                        doc.setTextColor("#1A1A1A"); doc.setFontSize(13); doc.setFont("helvetica", "bold");
                        doc.text("1. Store Configuration", 15, y); y += 8;
                        doc.setFontSize(10); doc.setFont("helvetica", "normal");
                        [["Client", companyName || "—"], ["Domain", displayDomain], ["Tier", tierLabel], ["Store Type", [state.enablePromo && "Promotional", state.enablePrint && "Print"].filter(Boolean).join(" + ")], ["Products", `${state.addedProductIds.length} products`], ["Auth", SSO_PROVIDERS.find(p => p.id === state.ssoProvider)?.name || "Email"]].forEach(([label, value]) => {
                          doc.setTextColor("#737373"); doc.text(String(label) + ":", 20, y);
                          doc.setTextColor("#1A1A1A"); doc.setFont("helvetica", "bold"); doc.text(String(value), 70, y);
                          doc.setFont("helvetica", "normal"); y += 6;
                        });
                        y += 6;
                        doc.setTextColor("#1A1A1A"); doc.setFontSize(13); doc.setFont("helvetica", "bold");
                        doc.text("2. SSO Configuration", 15, y); y += 8;
                        doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor("#737373");
                        doc.text(`Provider: ${SSO_PROVIDERS.find(p => p.id === state.ssoProvider)?.name || "N/A"}`, 20, y); y += 6;
                        doc.text(`Protocol: ${SSO_PROVIDERS.find(p => p.id === state.ssoProvider)?.protocol || "N/A"}`, 20, y); y += 8;
                        doc.setTextColor("#1A1A1A"); doc.text("Setup Steps:", 20, y); y += 6;
                        doc.setTextColor("#737373");
                        {
                          const appBase = window.location.origin;
                          const ssoEditorPath = state.createdStoreId
                            ? `${appBase}/stores/${state.createdStoreId}/edit?tab=sso`
                            : `${appBase}/stores — open the store and switch to the SSO tab after launch`;
                          [
                            `Open ${ssoEditorPath}`,
                            "Upload IdP metadata XML or enter SSO URL",
                            "Configure attribute mapping (email, name, department)",
                            "Test SSO connection with a pilot user",
                            "Enable SCIM provisioning for auto user sync",
                          ].forEach((s, i) => { doc.text(`  ${i+1}. ${s}`, 20, y); y += 5; });
                        }
                        y += 6;

                        // Optional: Budget / spending section
                        if (state.budgetEnabled) {
                          doc.setTextColor("#1A1A1A"); doc.setFontSize(13); doc.setFont("helvetica", "bold");
                          doc.text("Budget & Spending Controls", 15, y); y += 8;
                          doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor("#737373");
                          [
                            "Each department has a monthly budget ceiling.",
                            "Store admins manage budget allocations per department.",
                            "Purchases above a user's spending limit require manager approval.",
                            "Budgets reset on the first of each month (configurable).",
                          ].forEach((s) => { doc.text(`  • ${s}`, 20, y); y += 5; });
                          y += 6;
                        }

                        // Optional: Approval workflow section
                        if (state.approvalEnabled) {
                          doc.setTextColor("#1A1A1A"); doc.setFontSize(13); doc.setFont("helvetica", "bold");
                          doc.text("Approval Workflow", 15, y); y += 8;
                          doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor("#737373");
                          [
                            "Purchases over the spending limit route to a designated approver.",
                            "Approvers are notified by email and in the client portal.",
                            "Rejections require a reason and are audit-logged.",
                          ].forEach((s) => { doc.text(`  • ${s}`, 20, y); y += 5; });
                          y += 6;
                        }

                        // Optional: Multi-division configuration section
                        if (state.multiDivisionEnabled && state.divisions.length > 0) {
                          doc.setTextColor("#1A1A1A"); doc.setFontSize(13); doc.setFont("helvetica", "bold");
                          doc.text("Multi-Division Configuration", 15, y); y += 8;
                          doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor("#737373");
                          doc.text(`Divisions: ${state.divisions.length}`, 20, y); y += 6;
                          state.divisions.forEach((d) => {
                            doc.setFont("helvetica", "bold"); doc.setTextColor("#1A1A1A");
                            doc.text(`• ${d.name}`, 20, y); y += 5;
                            doc.setFont("helvetica", "normal"); doc.setTextColor("#737373");
                            if (d.pocEmail) { doc.text(`    POC: ${d.pocEmail}`, 20, y); y += 5; }
                            if (d.departments.length > 0) {
                              doc.text(`    Departments: ${d.departments.join(", ")}`, 20, y); y += 5;
                            }
                          });
                          doc.text("SSO group/attribute -> division mapping is configured per IdP.", 20, y); y += 5;
                          y += 6;
                        }
                        doc.setTextColor("#1A1A1A"); doc.setFontSize(13); doc.setFont("helvetica", "bold");
                        doc.text("3. DNS Configuration", 15, y); y += 8;
                        doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor("#737373");
                        doc.text("Add the following CNAME record:", 20, y); y += 6;
                        doc.setFont("courier", "normal");
                        doc.text(`Host: ${displayDomain.split(".")[0]}`, 25, y); y += 5;
                        doc.text("Type: CNAME", 25, y); y += 5;
                        doc.text("Value: edge.mergetasks.com", 25, y); y += 5;
                        doc.text("TTL: 300", 25, y); y += 8;
                        doc.setFont("helvetica", "normal");
                        doc.setFillColor(br, bg, bb);
                        doc.rect(0, 280, 210, 17, "F");
                        doc.setTextColor(255, 255, 255); doc.setFontSize(8);
                        doc.text(`${brandName} Enterprise Platform`, 15, 289);
                        doc.save(`IT_Readiness_Packet_${companyName?.replace(/\s+/g, "_") || "Client"}.pdf`);
                      } catch (err: unknown) {
                        log.error("PDF generation error:", err);
                      }
                      set("generatingPdf", false);
                    }}
                  >
                    {state.generatingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {state.generatingPdf ? "Generating..." : "Download PDF"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DashboardLayout>
    );
  }

  //  Wizard View 
  return (
    <DashboardLayout title="Create Store" subtitle="Set up a new branded store for your client">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Progress Stepper */}
        <div className="flex items-center justify-between mb-2 overflow-x-auto pb-2 flex-nowrap">
          {STEPS.filter(s => !(s.id === 4 && !hasSso)).map((s, i, arr) => {
            const Icon = s.icon;
            const isActive = step === s.id;
            const isCompleted = maxReachedStep > s.id && step !== s.id;
            return (
              <div key={s.id} className="flex items-center flex-shrink-0">
                <button
                  type="button"
                  className="flex flex-col items-center cursor-pointer"
                  onClick={() => { if (s.id <= maxReachedStep) setStep(s.id); }}
                  disabled={s.id > maxReachedStep}
                  title={isCompleted || isActive ? `Go to ${s.label}` : s.label}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${isCompleted ? "bg-[#16A34A] hover:bg-[#15803D]" : isActive ? "bg-primary" : "bg-mt-surface-2"}`}>
                    {isCompleted ? <Check size={14} color="#FFF" /> : <Icon size={14} className={isActive ? "text-white" : "text-mt-ink-4"} />}
                  </div>
                  <span className={`text-[10px] mt-1.5 font-medium whitespace-nowrap hidden sm:block ${isActive ? "text-primary" : isCompleted ? "text-[#16A34A]" : "text-mt-ink-4"}`}>
                    {s.label}
                  </span>
                </button>
                {i < arr.length - 1 && (
                  <div className={`w-6 sm:w-10 h-[2px] mx-1 ${isCompleted ? "bg-[#16A34A]" : "bg-[#E5E5E5]"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content — each step reads from context via useWebstore() */}
        <div className="bg-white border border-mt-border rounded-xl p-5 sm:p-8">
          {step === 1 && <Step1CompanyInfo dbClients={dbClients} companyName={companyName} />}
          {step === 2 && <Step2Domain companyName={companyName} displayDomain={displayDomain} />}
          {step === 3 && <Step3StoreType />}
          {step === 4 && <Step4Divisions companyName={companyName} onSkip={handleSkipDivisions} />}
          {step === 5 && <Step4Duration permanentStores={permanentStores} companyName={companyName} />}
          {step === 6 && <Step5Template />}
          {step === 7 && (
            <Step6Catalog
              dbProducts={dbProducts}
              filteredCatalogProducts={filteredCatalogProducts}
              toggleCategory={(id) => dispatch({ type: "TOGGLE_CATEGORY", categoryId: id })}
              toggleProduct={(id) => dispatch({ type: "TOGGLE_PRODUCT", productId: id })}
            />
          )}
          {step === 8 && <Step7Branding companyName={companyName} />}
          {step === 9 && <Step8Checkout toggleCheckout={(id) => dispatch({ type: "TOGGLE_CHECKOUT", methodId: id })} />}
          {step === 10 && (
            <Step9ReviewLaunch
              companyName={companyName}
              displayDomain={displayDomain}
              tierLabel={tierLabel}
              permanentStores={permanentStores}
              deploying={state.deploying}
              deployStep={state.deployStep}
              deploySteps={deploySteps}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between">
          <button
            className="sq-action-btn flex items-center gap-2 px-5 py-3"
            onClick={step === 1 ? () => navigate("/webstores") : handleBack}
          >
            <ChevronLeft size={14} /> {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < LAST_STEP ? (
            <button className="sq-action-btn primary flex items-center gap-2 px-6 py-3" onClick={handleNext}>
              Continue <ChevronRight size={14} />
            </button>
          ) : !state.deploying && state.deployStep < 0 ? (
            <div className="flex flex-col items-end gap-3 w-full">
              {/* Pre-flight validation panel — only shown on the final step when there are errors */}
              {step === LAST_STEP && preflightErrors.length > 0 && (
                <div className="w-full p-4 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] mb-1">
                  <p className="text-[12px] font-semibold text-[#DC2626] mb-2">Fix the following before launching:</p>
                  <ul className="space-y-1">
                    {preflightErrors.map((e, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <button
                          className="text-[11px] font-semibold text-[#DC2626] underline underline-offset-2 hover:opacity-70 transition-opacity"
                          onClick={() => { setStep(e.step); setMaxReachedStep(prev => Math.max(prev, e.step)); }}
                        >
                          Step {e.step} — {e.label}
                        </button>
                        <span className="text-[11px] text-[#DC2626]">{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center gap-3">
                {state.createdStoreId ? (
                  <button
                    className="sq-action-btn flex items-center gap-2 px-5 py-3"
                    onClick={() => navigate(`/store-preview/${state.createdStoreId}`)}
                  >
                    <Eye size={14} /> Preview Store
                  </button>
                ) : (
                  <button
                    className="sq-action-btn flex items-center gap-2 px-5 py-3"
                    onClick={handleSaveDraftAndPreview}
                    disabled={createStore.isPending}
                  >
                    {createStore.isPending ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                    {createStore.isPending ? "Saving…" : "Preview Store"}
                  </button>
                )}
                <button
                  className={`sq-action-btn primary flex items-center gap-2 px-6 py-3 transition-opacity ${
                    !canLaunch ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                  onClick={canLaunch ? handleLaunch : () => toast.error("Please fix the issues above before launching.")}
                  title={!canLaunch ? "Fix the issues above before launching" : undefined}
                  disabled={!canLaunch || createStore.isPending}
                  aria-disabled={!canLaunch || createStore.isPending}
                >
                  <Rocket size={14} /> Launch Store
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}

//  Public export — wraps inner wizard with the context provider 

export default function CreateWebstore() {
  return (
    <WebstoreProvider>
      <CreateWebstoreInner />
    </WebstoreProvider>
  );
}
