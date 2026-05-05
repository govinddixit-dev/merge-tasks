/**
 * StoreManagement.tsx — Store Management Page (thin shell)
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the six tab components for a single store's admin view.
 * All tab content has been extracted to ./StoreManagement/:
 *
 *   StoreManagementTypes.ts — shared types and interfaces
 *   OverviewTab.tsx          — KPI cards, revenue chart, recent orders, AI recs
 *   ProductsTab.tsx          — product table, add-product modal, action menu
 *   OrdersTab.tsx            — order stats, searchable table, CSV export
 *   PreviewTab.tsx           — device switcher, page selector, iframe chrome
 *   UsersTab.tsx             — user list, add/edit/remove/resend-invite
 *   SettingsTab.tsx          — general, SSO, POC, danger zone
 *
 * Route: /store-management/:id
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useMemo, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { TabContent } from "@/components/motion";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft, ExternalLink, Settings as SettingsIcon, Package, ShoppingCart,
  BarChart3, Clock, Zap, Link2, Users, Eye, Pause, Play,
  CalendarPlus, ArrowRightLeft, ChevronRight, Check, AlertTriangle,
  RefreshCw, Smartphone, Tablet, Monitor, Printer, FolderOpen, FileText,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  Tab, PreviewDevice, EffectiveStore, WebstoreRenderStatus,
} from "./StoreManagement/StoreManagementTypes";
import { OverviewTab } from "./StoreManagement/OverviewTab";
import { ProductsTab } from "./StoreManagement/ProductsTab";
import { OrdersTab } from "./StoreManagement/OrdersTab";
import { PreviewTab } from "./StoreManagement/PreviewTab";
import { UsersTab } from "./StoreManagement/UsersTab";
import { PrintProductsTab } from "./StoreManagement/PrintProductsTab";
import { PrintRequestsTab } from "./StoreManagement/PrintRequestsTab";
import { MediaTab } from "./StoreManagement/MediaTab";
import { RendersTab } from "./StoreManagement/RendersTab";
import { SettingsTab } from "./StoreManagement/SettingsTab";

export default function StoreManagement() {
  const [, params] = useRoute("/store-management/:id");
  const [, navigate] = useLocation();
  const storeId = params?.id || "";

  const numericId = parseInt(storeId);
  const isNumeric = !isNaN(numericId);

  // ─── Data queries ──────────────────────────────────────────────────────────
  const { data: dbStore, isLoading: dbStoreLoading } = trpc.stores.getById.useQuery(
    { id: numericId },
    { enabled: isNumeric }
  );
  const { data: _dbProductsRaw } = trpc.products.list.useQuery();
  const dbProducts = _dbProductsRaw?.items ?? [];
  const { data: _dbOrdersRaw } = trpc.orders.list.useQuery();
  const dbOrders = _dbOrdersRaw?.items ?? [];

  // ─── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // ─── Products state ────────────────────────────────────────────────────────
  const [productSearch, setProductSearch] = useState("");
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [addProductSearch, setAddProductSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [productMenuOpen, setProductMenuOpen] = useState<number | null>(null);
  const [editingProductPrice, setEditingProductPrice] = useState<{ id: number; price: string } | null>(null);

  // ─── Orders state ──────────────────────────────────────────────────────────
  const [orderSearch, setOrderSearch] = useState("");

  // ─── Preview state ─────────────────────────────────────────────────────────
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("mobile");
  const [previewPage, setPreviewPage] = useState("/store/home");
  const [previewKey, setPreviewKey] = useState(0);

  // ─── AI Recommendations state ──────────────────────────────────────────────
  const [selectedRecDept, setSelectedRecDept] = useState<string | undefined>(undefined);
  const [recsExpanded, setRecsExpanded] = useState(true);

  // ─── Settings state ────────────────────────────────────────────────────────
  const [editingSettings, setEditingSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    name: "", welcomeMessage: "", primaryColor: "", senderName: "", senderEmail: "",
  });
  const [savingSettings, setSavingSettings] = useState(false);

  // ─── POC state ─────────────────────────────────────────────────────────────
  const [editingPoc, setEditingPoc] = useState(false);
  const [pocForm, setPocForm] = useState({ name: "", email: "" });

  // ─── Users state ───────────────────────────────────────────────────────────
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [addUserForm, setAddUserForm] = useState({
    name: "", email: "", role: "employee" as "admin" | "manager" | "employee" | "intern",
    department: "", spendingLimit: "",
  });
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);

  // ─── Pop-up store state ────────────────────────────────────────────────────
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [newEndDate, setNewEndDate] = useState("");
  const [converting, setConverting] = useState(false);

  // ─── Users query ───────────────────────────────────────────────────────────
  const { data: storeUsersData, refetch: refetchUsers } = trpc.storeProvisioning.listUsers.useQuery(
    { storeId: numericId },
    { enabled: isNumeric && activeTab === "users" }
  );

  // ─── Store mutations (used in header actions) ──────────────────────────────
  const utils = trpc.useUtils();
  const updateStoreMut = trpc.stores.update.useMutation({
    onSuccess: () => utils.stores.getById.invalidate({ id: numericId }),
    onError: (e) => toast.error(e.message),
  });

  // ─── Derived data ──────────────────────────────────────────────────────────
  const effectiveProducts = useMemo(() => {
    if (isNumeric && dbStore?.products?.length) {
      return dbStore.products.map((p: {
        id: number;
        name: string;
        sku: string | null;
        category: string | null;
        basePrice: string | null;
        customPrice?: string | null;
        imageUrl?: string | null;
        status: string | null;
        webstoreRenderStatus?: WebstoreRenderStatus | null;
        webstoreRenderedAt?: Date | string | null;
        webstoreRenderedImageUrl?: string | null;
        renderApproved?: boolean;
        renderOverrideUrl?: string | null;
        trackInventory?: boolean;
        stockQuantity?: number | null;
        sortOrder?: number;
        featured?: boolean;
        styleGroup?: string | null;
        colorName?: string | null;
        colorHex?: string | null;
        swatchUrl?: string | null;
        isVariantPrimary?: boolean;
        effectiveRenderStatus?: WebstoreRenderStatus | "awaiting_analysis" | string | null;
      }) => {
        const priceSource = p.customPrice ?? p.basePrice;
        const stock =
          p.trackInventory && typeof p.stockQuantity === "number"
            ? p.stockQuantity
            : 0;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku || `SKU-${p.id}`,
          category: p.category || "General",
          price: priceSource ? `$${priceSource}` : "$0.00",
          basePrice: p.basePrice ?? null,
          imageUrl: p.imageUrl ?? null,
          stock,
          status: p.status === "active" ? "Active" : p.status || "Active",
          webstoreRenderStatus: p.webstoreRenderStatus ?? null,
          effectiveRenderStatus: (p.effectiveRenderStatus ?? null) as WebstoreRenderStatus | "awaiting_analysis" | null,
          webstoreRenderedAt: p.webstoreRenderedAt ?? null,
          webstoreRenderedImageUrl: p.webstoreRenderedImageUrl ?? null,
          renderApproved: p.renderApproved ?? false,
          renderOverrideUrl: p.renderOverrideUrl ?? null,
          trackInventory: p.trackInventory ?? false,
          stockQuantity: p.stockQuantity ?? null,
          sortOrder: p.sortOrder ?? 0,
          featured: p.featured ?? false,
          styleGroup: p.styleGroup ?? null,
          colorName: p.colorName ?? null,
          colorHex: p.colorHex ?? null,
          swatchUrl: p.swatchUrl ?? null,
          isVariantPrimary: p.isVariantPrimary ?? false,
        };
      });
    }
    return [];
  }, [isNumeric, dbStore]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return effectiveProducts;
    return effectiveProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase())
    );
  }, [productSearch, effectiveProducts]);

  const effectiveOrders = useMemo(() => {
    if (!isNumeric) return [];
    const storeOrders = dbOrders.filter((o: { storeId: number | null }) => o.storeId === numericId);
    return storeOrders.map((o: { orderNumber: string; id: number; createdAt: Date; shippingName: string | null; client: { companyName: string } | null; total: string | null; status: string | null; paymentMethod: string | null }) => ({
      id: o.orderNumber || `ORD-${o.id}`,
      dbId: o.id,
      date: new Date(o.createdAt).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      }),
      customer: o.shippingName || o.client?.companyName || "Unknown",
      items: 1,
      total: o.total
        ? `$${parseFloat(o.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
        : "$0.00",
      status:
        (o.status || "pending").charAt(0).toUpperCase() +
        (o.status || "pending").slice(1),
      method: o.paymentMethod
        ? o.paymentMethod
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c: string) => c.toUpperCase())
        : "Credit Card",
    }));
  }, [isNumeric, dbOrders, numericId]);

  const filteredOrders = useMemo(() => {
    if (!orderSearch) return effectiveOrders;
    return effectiveOrders.filter(
      (o) =>
        o.id.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customer.toLowerCase().includes(orderSearch.toLowerCase())
    );
  }, [orderSearch, effectiveOrders]);

  const availableProducts = useMemo(() => {
    if (!isNumeric) return [];
    const assignedIds = new Set((dbStore?.storeProducts || []).map((sp: { productId: number }) => sp.productId));
    return dbProducts.filter((p) => !assignedIds.has(p.id));
  }, [isNumeric, dbStore, dbProducts]);

  const filteredAvailableProducts = useMemo(() => {
    if (!addProductSearch) return availableProducts;
    return availableProducts.filter(
      (p: { name: string; sku: string | null }) =>
        p.name.toLowerCase().includes(addProductSearch.toLowerCase()) ||
        (p.sku || "").toLowerCase().includes(addProductSearch.toLowerCase())
    );
  }, [addProductSearch, availableProducts]);

  // ─── Loading / not-found states ────────────────────────────────────────────
  if (isNumeric && dbStoreLoading) {
    return (
      <DashboardLayout title="Loading..." subtitle="">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#6C47FF] border-t-transparent mb-4" />
          <p className="text-[15px] text-mt-ink-3">Loading store...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!dbStore) {
    return (
      <DashboardLayout title="Store Not Found" subtitle="">
        <div className="flex flex-col items-center justify-center py-20">
          <AlertTriangle size={48} className="text-[#D4D4D4] mb-4" />
          <p className="text-[15px] text-mt-ink-3 mb-4">Store not found</p>
          <button onClick={() => navigate("/webstores")} className="sq-action-btn primary">
            Back to Stores
          </button>
        </div>
      </DashboardLayout>
    );
  }

  // ─── Effective store (derived from DB record) ──────────────────────────────
  const effectiveStore: EffectiveStore = {
    id: String(dbStore?.id || ""),
    name: dbStore?.name || "Untitled Store",
    domain: dbStore?.slug ? `${dbStore.slug}.mergetasks.com` : "—",
    employees: 0,
    tier: "Standard",
    status:
      dbStore?.status === "active"
        ? "Live"
        : dbStore?.status === "inactive"
        ? "Paused"
        : dbStore?.status || "Draft",
    gmv: (() => {
      if (!isNumeric) return "$0";
      const storeOrders = dbOrders.filter((o: { storeId: number | null }) => o.storeId === numericId);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentOrders = storeOrders.filter(
        (o: { createdAt: Date }) => new Date(o.createdAt) >= thirtyDaysAgo
      );
      const total = recentOrders.reduce(
        (sum: number, o: { total: string | null }) => sum + parseFloat(o.total || "0"),
        0
      );
      return total > 0
        ? `$${total.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : "$0";
    })(),
    sso: dbStore?.ssoEnabled ? "SSO Enabled" : "None",
    storeType: dbStore?.storeType || "promotional",
    durationType: (dbStore?.storeType === "popup" ? "popup" : "permanent") as
      | "permanent"
      | "popup",
    popupStart: dbStore?.startDate
      ? new Date(dbStore.startDate).toISOString().split("T")[0]
      : undefined,
    popupEnd: dbStore?.endDate
      ? new Date(dbStore.endDate).toISOString().split("T")[0]
      : undefined,
    monthlyOrders: effectiveOrders.length,
    totalProducts: effectiveProducts.length,
    avgOrderValue: (() => {
      if (!isNumeric) return "$0";
      const storeOrders = dbOrders.filter((o: { storeId: number | null }) => o.storeId === numericId);
      if (storeOrders.length === 0) return "$0";
      const total = storeOrders.reduce(
        (sum: number, o: { total: string | null }) => sum + parseFloat(o.total || "0"),
        0
      );
      return `$${(total / storeOrders.length).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    })(),
    conversionRate: "0%",
    pocName: dbStore?.client?.contactName || "—",
    pocEmail: dbStore?.client?.contactEmail || "—",
    createdDate: dbStore?.createdAt
      ? new Date(dbStore.createdAt).toISOString().split("T")[0]
      : "—",
  };

  const isPopup = effectiveStore.durationType === "popup";
  const daysRemaining =
    isPopup && effectiveStore.popupEnd
      ? Math.max(
          0,
          Math.ceil(
            (new Date(effectiveStore.popupEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          )
        )
      : null;
  const totalDays =
    isPopup && effectiveStore.popupStart && effectiveStore.popupEnd
      ? Math.ceil(
          (new Date(effectiveStore.popupEnd).getTime() -
            new Date(effectiveStore.popupStart).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : null;
  const progressPct =
    totalDays && daysRemaining !== null
      ? Math.min(100, Math.max(0, ((totalDays - daysRemaining) / totalDays) * 100))
      : 0;

  // ─── Tab definitions ───────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 size={14} /> },
    { id: "products", label: "Products", icon: <Package size={14} /> },
    { id: "orders", label: "Orders", icon: <ShoppingCart size={14} /> },
    { id: "preview", label: "Live Preview", icon: <Eye size={14} /> },
    { id: "users", label: "Users", icon: <Users size={14} /> },
    { id: "print", label: "Print Products", icon: <Printer size={14} /> },
    { id: "print-requests", label: "Print Requests", icon: <FileText size={14} /> },
    { id: "media", label: "Media", icon: <FolderOpen size={14} /> },
    { id: "renders", label: "Renders", icon: <ImageIcon size={14} /> },
    { id: "settings", label: "Settings", icon: <SettingsIcon size={14} /> },
  ];

  // ─── Pop-up action handlers ────────────────────────────────────────────────
  const handleConvert = () => {
    if (!isNumeric) return;
    setConverting(true);
    updateStoreMut.mutate(
      { id: numericId, status: "active" },
      {
        onSuccess: () => {
          setConverting(false);
          setShowConvertModal(false);
          toast.success("Store converted to permanent!", {
            description: `${effectiveStore.name} is now a permanent store with no expiration.`,
          });
        },
        onError: (e) => {
          setConverting(false);
          toast.error(e.message);
        },
      }
    );
  };

  const handleExtend = () => {
    if (!newEndDate) return;
    if (isNumeric) {
      updateStoreMut.mutate(
        { id: numericId, status: "active" },
        {
          onSuccess: () => {
            setShowExtendModal(false);
            toast.success("Campaign extended!", {
              description: `New end date: ${new Date(newEndDate).toLocaleDateString("en-US", {
                month: "long", day: "numeric", year: "numeric",
              })}`,
            });
          },
          onError: (e) => toast.error(e.message),
        }
      );
    } else {
      setShowExtendModal(false);
      toast.success("Campaign extended!", {
        description: `New end date: ${new Date(newEndDate).toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric",
        })}`,
      });
    }
  };

  const handlePauseToggle = () => {
    if (isNumeric) {
      const newStatus = isPaused ? "active" : "inactive";
      updateStoreMut.mutate(
        { id: numericId, status: newStatus },
        {
          onSuccess: () => {
            setIsPaused(!isPaused);
            toast.success(isPaused ? "Store resumed" : "Store paused", {
              description: isPaused
                ? "The store is now visible to employees again."
                : "The store is hidden from employees. Orders in progress will still be fulfilled.",
            });
          },
          onError: (e) => toast.error(e.message),
        }
      );
    } else {
      setIsPaused(!isPaused);
      toast.success(isPaused ? "Store resumed" : "Store paused");
    }
  };

  const handleCloseStore = () => {
    if (isNumeric) {
      updateStoreMut.mutate(
        { id: numericId, status: "inactive" },
        {
          onSuccess: () =>
            toast.success("Store closed", {
              description:
                "The pop-up has been marked as ended. All order history is preserved.",
            }),
          onError: (e) => toast.error(e.message),
        }
      );
    } else {
      toast.success("Store closed", {
        description: "The pop-up has been marked as ended. All order history is preserved.",
      });
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout title="" subtitle="">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate("/webstores")}
          className="flex items-center gap-1.5 text-[12px] text-mt-ink-4 hover:text-mt-ink-2 transition-colors mb-4"
        >
          <ArrowLeft size={14} /> Back to Stores
        </button>

        <div className="flex flex-col sm:flex-row items-start justify-between gap-4 sm:gap-0">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-[22px] font-bold text-mt-ink">{effectiveStore.name}</h1>
              <span
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                  effectiveStore.status === "Live"
                    ? "bg-[#F0FDF4] text-[#16A34A]"
                    : effectiveStore.status === "Scheduled"
                    ? "bg-[#EFF6FF] text-[#3B82F6]"
                    : effectiveStore.status === "Expired"
                    ? "bg-mt-surface-2 text-mt-ink-3"
                    : "bg-[#FEF3C7] text-[#D97706]"
                }`}
              >
                {effectiveStore.status}
              </span>
              {isPopup && (
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#F5F3FF] text-primary flex items-center gap-1">
                  <Clock size={10} /> Pop-Up
                </span>
              )}
              {effectiveStore.linkedTo && (
                <span className="text-[11px] text-mt-ink-4 flex items-center gap-1">
                  <Link2 size={11} /> Linked to {effectiveStore.linkedTo}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[12px] text-mt-ink-4">
              <span>{effectiveStore.domain}</span>
              <span>·</span>
              <span>{effectiveStore.tier}</span>
              <span>·</span>
              <span>{effectiveStore.employees.toLocaleString()} employees</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`https://${effectiveStore.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sq-action-btn flex items-center gap-1.5 text-[12px]"
            >
              <ExternalLink size={13} /> Visit Store
            </a>
            {isPopup && (
              <>
                <button
                  className="sq-action-btn flex items-center gap-1.5 text-[12px]"
                  onClick={() => setShowExtendModal(true)}
                >
                  <CalendarPlus size={13} /> Extend
                </button>
                <button
                  className="sq-action-btn flex items-center gap-1.5 text-[12px]"
                  onClick={() => setShowConvertModal(true)}
                >
                  <ArrowRightLeft size={13} /> Convert to Permanent
                </button>
                <button
                  className="sq-action-btn flex items-center gap-1.5 text-[12px] text-[#EF4444] border-[#EF4444]/30 hover:bg-[#FEF2F2]"
                  onClick={handleCloseStore}
                >
                  <Zap size={13} /> Close Store
                </button>
              </>
            )}
            <button
              className="sq-action-btn flex items-center gap-1.5 text-[12px]"
              onClick={handlePauseToggle}
            >
              {isPaused ? <Play size={13} /> : <Pause size={13} />}
              {isPaused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>

        {/* Pop-up progress bar */}
        {isPopup && totalDays && (
          <div className="mt-4 bg-white rounded-lg border border-mt-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-semibold text-mt-ink-3">Campaign Progress</span>
              <div className="flex items-center gap-3 text-[11px] text-mt-ink-4">
                <span>
                  {effectiveStore.popupStart
                    ? new Date(effectiveStore.popupStart).toLocaleDateString("en-US", {
                        month: "short", day: "numeric",
                      })
                    : "—"}
                </span>
                <ChevronRight size={10} />
                <span>
                  {effectiveStore.popupEnd
                    ? new Date(effectiveStore.popupEnd).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })
                    : "—"}
                </span>
              </div>
            </div>
            <div className="w-full bg-mt-surface-2 rounded-full h-2">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {daysRemaining !== null && daysRemaining > 0 && (
              <span className="text-[11px] font-semibold text-[#D97706] mt-1 block">
                {daysRemaining} days remaining
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div
        className="flex items-center gap-1 mb-6 overflow-x-auto flex-nowrap"
        style={{ borderBottom: "1px solid #E5E5E5" }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition-colors relative whitespace-nowrap ${
              activeTab === tab.id
                ? "text-mt-ink"
                : "text-mt-ink-4 hover:text-mt-ink-2"
            }`}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <motion.span
                layoutId="storeManagementTabs"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <TabContent tabKey={activeTab}>
      {activeTab === "overview" && (
        <OverviewTab
          effectiveStore={effectiveStore}
          effectiveOrders={effectiveOrders}
          isNumeric={isNumeric}
          dbStore={dbStore}
          numericId={numericId}
          selectedRecDept={selectedRecDept}
          setSelectedRecDept={setSelectedRecDept}
          recsExpanded={recsExpanded}
          setRecsExpanded={setRecsExpanded}
          onViewAllOrders={() => setActiveTab("orders")}
        />
      )}

      {activeTab === "products" && (
        <ProductsTab
          effectiveProducts={effectiveProducts}
          filteredProducts={filteredProducts}
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          isNumeric={isNumeric}
          numericId={numericId}
          dbStore={dbStore}
          dbProducts={dbProducts}
          productMenuOpen={productMenuOpen}
          setProductMenuOpen={setProductMenuOpen}
          editingProductPrice={editingProductPrice}
          setEditingProductPrice={setEditingProductPrice}
          showAddProductModal={showAddProductModal}
          setShowAddProductModal={setShowAddProductModal}
          addProductSearch={addProductSearch}
          setAddProductSearch={setAddProductSearch}
          selectedProductIds={selectedProductIds}
          setSelectedProductIds={setSelectedProductIds}
          filteredAvailableProducts={filteredAvailableProducts}
          availableProducts={availableProducts}
          onProductsChanged={() => utils.stores.getById.invalidate({ id: numericId })}
        />
      )}

      {activeTab === "orders" && (
        <OrdersTab
          effectiveOrders={effectiveOrders}
          filteredOrders={filteredOrders}
          orderSearch={orderSearch}
          setOrderSearch={setOrderSearch}
          effectiveStore={{ gmv: effectiveStore.gmv, name: effectiveStore.name }}
        />
      )}

      {activeTab === "preview" && (
        <PreviewTab
          effectiveStore={{ domain: effectiveStore.domain }}
          previewDevice={previewDevice}
          setPreviewDevice={setPreviewDevice}
          previewPage={previewPage}
          setPreviewPage={setPreviewPage}
          previewKey={previewKey}
          setPreviewKey={setPreviewKey}
        />
      )}

      {activeTab === "users" && (
        <UsersTab
          isNumeric={isNumeric}
          numericId={numericId}
          storeUsersData={storeUsersData}
          refetchUsers={refetchUsers}
          showAddUserModal={showAddUserModal}
          setShowAddUserModal={setShowAddUserModal}
          editingUser={editingUser}
          setEditingUser={setEditingUser}
          addUserForm={addUserForm}
          setAddUserForm={setAddUserForm}
          removingUserId={removingUserId}
          setRemovingUserId={setRemovingUserId}
        />
      )}

      {activeTab === "print" && isNumeric && (
        <PrintProductsTab storeId={numericId} />
      )}

      {activeTab === "print-requests" && isNumeric && (
        <PrintRequestsTab storeId={numericId} />
      )}

      {activeTab === "media" && isNumeric && (
        <MediaTab storeId={numericId} />
      )}

      {activeTab === "renders" && isNumeric && (
        <RendersTab storeId={numericId} />
      )}

      {activeTab === "settings" && (
        <SettingsTab
          effectiveStore={effectiveStore}
          isNumeric={isNumeric}
          numericId={numericId}
          dbStore={dbStore}
          editingSettings={editingSettings}
          setEditingSettings={setEditingSettings}
          settingsForm={settingsForm}
          setSettingsForm={setSettingsForm}
          savingSettings={savingSettings}
          setSavingSettings={setSavingSettings}
          editingPoc={editingPoc}
          setEditingPoc={setEditingPoc}
          pocForm={pocForm}
          setPocForm={setPocForm}
          onStoreDeleted={() => navigate("/webstores")}
        />
      )}
      </TabContent>

      {/* Convert to Permanent Modal */}
      {showConvertModal && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => setShowConvertModal(false)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <span className="w-10 h-10 rounded-lg bg-mt-brand-light flex items-center justify-center">
                <ArrowRightLeft size={20} className="text-primary" />
              </span>
              <div>
                <h3 className="text-[16px] font-bold text-mt-ink">Convert to Permanent Store</h3>
                <p className="text-[12px] text-mt-ink-4">
                  Remove the expiration date and make this store permanent
                </p>
              </div>
            </div>
            <div className="bg-mt-brand-light rounded-lg p-4 mb-4">
              <p className="text-[13px] text-mt-ink-2 leading-relaxed">
                This will convert <strong>{effectiveStore.name}</strong> from a pop-up shop to a
                permanent store. The campaign timeline will be removed, and the store will remain
                active indefinitely.
              </p>
              <ul className="mt-3 space-y-1.5">
                {[
                  "All products, orders, and analytics will be preserved",
                  "The store URL and domain will remain the same",
                  effectiveStore.linkedTo
                    ? `The tab in ${effectiveStore.linkedTo}'s store will become permanent`
                    : "No linked store changes needed",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-mt-ink-2">
                    <Check size={12} className="text-primary mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowConvertModal(false)}
                className="flex-1 py-2.5 text-[13px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConvert}
                disabled={converting}
                className="flex-1 py-2.5 text-[13px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {converting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Converting...
                  </>
                ) : (
                  "Convert to Permanent"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Campaign Modal */}
      {showExtendModal && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => setShowExtendModal(false)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <span className="w-10 h-10 rounded-lg bg-[#FEF3C7] flex items-center justify-center">
                <CalendarPlus size={20} className="text-[#D97706]" />
              </span>
              <div>
                <h3 className="text-[16px] font-bold text-mt-ink">Extend Campaign</h3>
                <p className="text-[12px] text-mt-ink-4">
                  Set a new end date for this pop-up shop
                </p>
              </div>
            </div>
            <div className="mb-4">
              <label className="text-[12px] font-semibold text-mt-ink-2 mb-1.5 block">
                Current End Date
              </label>
              <div className="text-[14px] font-semibold text-mt-ink p-3 bg-mt-surface-2 rounded-lg">
                {effectiveStore.popupEnd
                  ? new Date(effectiveStore.popupEnd).toLocaleDateString("en-US", {
                      weekday: "long", month: "long", day: "numeric", year: "numeric",
                    })
                  : "—"}
              </div>
            </div>
            <div className="mb-6">
              <label className="text-[12px] font-semibold text-mt-ink-2 mb-1.5 block">
                New End Date
              </label>
              <input
                type="date"
                className="w-full p-3 text-[14px] border border-mt-border rounded-lg outline-none focus:border-[#D97706] focus:ring-1 focus:ring-[#D97706] transition-all"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                min={effectiveStore.popupEnd || undefined}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowExtendModal(false)}
                className="flex-1 py-2.5 text-[13px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExtend}
                disabled={!newEndDate}
                className="flex-1 py-2.5 text-[13px] font-semibold text-white rounded-lg bg-[#D97706] hover:bg-[#B45309] transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                Extend Campaign
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
