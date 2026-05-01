import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { TableSkeleton } from "@/components/motion";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, ExternalLink, ChevronRight, Check, CheckCircle, Loader2, Eye, X, Search, ChevronLeft, Filter, Clock, Zap, Link2, Trash2, Sparkles, Users, Mail, UserPlus, RefreshCw, Shield, User, Pencil, Power, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { RouterOutput } from "@/lib/trpc";

// Infer the store list item type directly from the tRPC router output
type StoreListItem = RouterOutput["stores"]["list"]["items"][number];

const ROWS_PER_PAGE = 12;

/**
 * Per-row activity cell — lightweight counts of orders + active members.
 * Runs a dedicated query per row; renders 0 while loading (no skeleton
 * because the row height is already driven by other cells).
 */
function StoreStatsCell({ storeId }: { storeId: number }) {
  const { data } = trpc.stores.getStats.useQuery({ storeId });
  const orders = data?.orders ?? 0;
  const users = data?.users ?? 0;
  return (
    <div className="flex items-center gap-4">
      <span className="text-[11px] text-mt-ink-4 flex items-center gap-1">
        <ShoppingBag size={11} /> {orders} orders
      </span>
      <span className="text-[11px] text-mt-ink-4 flex items-center gap-1">
        <Users size={11} /> {users} members
      </span>
    </div>
  );
}

export default function Webstores() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  // Confirmation modal state — rendered via the shared ConfirmDialog.
  // Publish is a non-destructive go-live (primary/purple); Take Offline
  // and Delete are destructive (filled black).
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant: "destructive" | "primary";
    action: "offline" | "publish" | "delete";
  } | null>(null);
  const [removeUserTarget, setRemoveUserTarget] = useState<{ id: number; label: string } | null>(null);

  const { data: storesList, isLoading } = trpc.stores.list.useQuery();
  const utils = trpc.useUtils();
  const updateStore = trpc.stores.update.useMutation({
    onSuccess: () => { utils.stores.list.invalidate(); toast.success("Store updated"); },
    onError: (err: any) => toast.error(err.message),
  });
  const deleteStore = trpc.stores.delete.useMutation({
    onSuccess: () => {
      utils.stores.list.invalidate();
      toast.success("Store deleted");
      setSelectedStoreId(null);
    },
    onError: (err) => {
      toast.error("Failed to delete: " + err.message);
    },
  });

  const aiOptimize = trpc.stores.aiOptimize.useMutation({
    onSuccess: (data) => {
      utils.stores.list.invalidate();
      toast.success("AI optimization complete — tagline, description, and categories updated");
    },
    onError: (err) => {
      toast.error("AI optimization couldn't complete: " + err.message);
    },
  });

  // Handle branded confirmation modal actions
  const handleConfirmAction = () => {
    if (!confirmModal || !selectedStore) return;
    const action = confirmModal.action;
    setConfirmModal(null);
    if (action === "offline") {
      updateStore.mutate({ id: selectedStore.id, status: "draft" });
    } else if (action === "publish") {
      updateStore.mutate({ id: selectedStore.id, status: "active" });
    } else if (action === "delete") {
      deleteStore.mutate({ id: selectedStore.id });
    }
  };

  // User management state
  const [showUsersPanel, setShowUsersPanel] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  type StoreUserRole = 'admin' | 'manager' | 'employee' | 'intern';
  const [newUser, setNewUser] = useState<{ name: string; email: string; role: StoreUserRole; department: string }>(
    { name: '', email: '', role: 'employee', department: '' }
  );

  // Fetch store users when a store is selected and panel is open
  const { data: storeUsersData, refetch: refetchUsers } = trpc.storeAuth.listUsers.useQuery(
    { storeId: selectedStoreId! },
    { enabled: !!selectedStoreId && showUsersPanel }
  );

  const addUser = trpc.storeAuth.addUser.useMutation({
    onSuccess: () => {
      refetchUsers();
      setAddingUser(false);
      setNewUser({ name: '', email: '', role: 'employee' as const, department: '' });
      toast.success('User added');
    },
    onError: (err) => toast.error(err.message),
  });

  const removeUser = trpc.storeAuth.removeUser.useMutation({
    onSuccess: () => {
      refetchUsers();
      toast.success('User removed');
    },
    onError: (err) => toast.error(err.message),
  });

  const resendInvite = trpc.storeProvisioning.resendInvite.useMutation({
    onSuccess: (data) => {
      if (data.emailSent) {
        toast.success('Set-password email sent');
      } else {
        toast.warning('User added but email could not be sent');
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const stores: StoreListItem[] = storesList?.items ?? [];

  const filteredStores = useMemo(() => {
    return stores.filter(s => {
      const name = s.name || "";
      const clientName = s.client?.companyName || "";
      const slug = s.slug || "";
      const matchesSearch =
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        slug.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = typeFilter === "All" || s.storeType === typeFilter.toLowerCase();
      const matchesStatus = statusFilter === "All" || s.status === statusFilter.toLowerCase();
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [stores, searchQuery, typeFilter, statusFilter]);

  const totalPages = Math.ceil(filteredStores.length / ROWS_PER_PAGE);
  const paginatedStores = filteredStores.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const activeCount = stores.filter(s => s.status === "active").length;
  const setupCount = stores.filter(s => s.status === "setup").length;
  const popupCount = stores.filter(s => s.storeType === "popup").length;

  const selectedStore = selectedStoreId ? stores.find(s => s.id === selectedStoreId) : null;

  return (
    <DashboardLayout title="Stores" subtitle="Manage enterprise client stores">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-mt-brand-light text-primary">
            {activeCount} Active
          </span>
          <span className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-mt-surface-2 text-mt-ink-3">
            {setupCount} Setup
          </span>
          {popupCount > 0 && (
            <span className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-[#FEF3C7] text-[#D97706]">
              {popupCount} Pop-Up
            </span>
          )}
        </div>
        <Link href="/create-webstore">
          <span className="sq-action-btn primary flex items-center gap-2">
            <Plus size={14} /> Create New Store
          </span>
        </Link>
      </div>

      {/* Search and filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mt-ink-4" />
          <input
            className="w-full pl-10 pr-4 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-[#C4C4C4]"
            placeholder="Search stores..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={13} className="text-mt-ink-4" />
          {["All", "Active", "Setup", "Inactive"].map((t) => (
            <button
              key={t}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors ${
                statusFilter === t
                  ? "bg-[#1A1A1A] text-white"
                  : "bg-mt-surface-2 text-mt-ink-3 hover:bg-[#EBEBEB]"
              }`}
              onClick={() => { setStatusFilter(t); setCurrentPage(1); }}
            >
              {t}
            </button>
          ))}
          <div className="w-px h-5 bg-[#E5E5E5] mx-1" />
          {["All", "Permanent", "Popup"].map((d) => (
            <button
              key={d}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors ${
                typeFilter === d
                  ? "bg-[#D97706] text-white"
                  : "bg-mt-surface-2 text-mt-ink-3 hover:bg-[#EBEBEB]"
              }`}
              onClick={() => { setTypeFilter(d); setCurrentPage(1); }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-mt-border overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} columns={7} />
        ) : filteredStores.length === 0 ? (
          stores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-14 h-14 rounded-full bg-mt-brand-light flex items-center justify-center mb-4">
                <Eye size={24} className="text-primary" />
              </div>
              <p className="text-[14px] font-semibold text-mt-ink mb-1">No stores created</p>
              <p className="text-[12px] text-mt-ink-3 mb-4">Create your first store to get started</p>
              <Link href="/create-webstore">
                <span className="sq-action-btn primary flex items-center gap-2">
                  <Plus size={14} /> Create Store
                </span>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-14 h-14 rounded-full bg-mt-surface-2 flex items-center justify-center mb-4">
                <Search size={22} className="text-mt-ink-4" />
              </div>
              <p className="text-[14px] font-semibold text-mt-ink mb-1">No stores match your filters</p>
              <p className="text-[12px] text-mt-ink-3 mb-4">Try adjusting your search or filters</p>
              <button
                type="button"
                className="text-[12px] font-semibold text-primary hover:underline transition-colors duration-150"
                onClick={() => { setSearchQuery(""); setTypeFilter("All"); setStatusFilter("All"); setCurrentPage(1); }}
              >
                Clear filters
              </button>
            </div>
          )
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
                  {["Store Name", "Client", "Type", "Slug", "SSO", "Activity", "Status", ""].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedStores.map((store, i) => (
                  <tr
                    key={store.id}
                    className="hover:bg-mt-surface transition-colors duration-100 cursor-pointer"
                    style={{ borderBottom: i < paginatedStores.length - 1 ? "1px solid #F5F5F5" : "none" }}
                    onClick={() => setSelectedStoreId(store.id)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-mt-ink">{store.name}</span>
                        {store.storeType === "popup" && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] flex items-center gap-0.5">
                            <Zap size={8} /> POP-UP
                          </span>
                        )}
                      </div>
                      {/* TODO: popupStartDate/popupEndDate not yet in stores schema */}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-mt-ink-2">
                      {store.client?.companyName || "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                        store.storeType === "popup" ? "bg-[#FEF3C7] text-[#D97706]" : "bg-[#F0FDF4] text-[#16A34A]"
                      }`}>
                        {store.storeType === "popup" ? "Pop-Up" : "Permanent"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-mt-ink-3">
                      {store.slug ? (
                        <a
                          href={`https://app.mergetasks.com/s/${store.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-primary hover:underline flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={11} />
                          app.mergetasks.com/s/{store.slug}
                        </a>
                      ) : (
                        <span className="text-[#D4D4D4]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-mt-ink-3">
                      {store.ssoEnabled ? (store.ssoProvider || "Enabled") : "None"}
                    </td>
                    <td className="px-5 py-3.5">
                      <StoreStatsCell storeId={store.id} />
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          store.status === "active" ? "bg-[#16A34A]" :
                          store.status === "setup" ? "bg-[#D97706]" :
                          "bg-[#A3A3A3]"
                        }`} />
                        <span className={`${
                          store.status === "active" ? "text-[#16A34A]" :
                          store.status === "setup" ? "text-[#D97706]" :
                          "text-mt-ink-4"
                        }`}>
                          {store.status === "active" ? "Active" : store.status === "setup" ? "Setup" : "Inactive"}
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <ChevronRight size={14} className="text-[#D4D4D4]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid #F0F0F0" }}>
                <span className="text-[12px] text-mt-ink-4">
                  Showing {(currentPage - 1) * ROWS_PER_PAGE + 1}–{Math.min(currentPage * ROWS_PER_PAGE, filteredStores.length)} of {filteredStores.length} stores
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="p-1.5 rounded-md hover:bg-mt-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft size={14} className="text-mt-ink-2" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      className={`w-8 h-8 rounded-md text-[12px] font-semibold transition-colors ${
                        page === currentPage ? "bg-[#1A1A1A] text-white" : "text-mt-ink-3 hover:bg-mt-surface-2"
                      }`}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    className="p-1.5 rounded-md hover:bg-mt-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    <ChevronRight size={14} className="text-mt-ink-2" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Store Detail Panel — slide-in side panel without backdrop overlay */}
      {selectedStore && (
        <>
          {/* Clickable backdrop — transparent, no blur/dim */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setSelectedStoreId(null)}
          />
          {/* Side panel */}
          <div
            className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-white overflow-y-auto shadow-2xl border-l border-mt-border"
            style={{ animation: "slideInRight 0.2s ease-out", height: "100vh", top: 0 }}
          >
            {/* Accent bar */}
            <div className="h-1" style={{ backgroundColor: selectedStore.primaryColor || "var(--mt-brand)" }} />
            <div className="p-5 sm:p-8">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-[15px]"
                    style={{ backgroundColor: selectedStore.primaryColor || "var(--mt-brand)" }}
                  >
                    {(selectedStore.name || "S").charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-mt-ink leading-tight">{selectedStore.name}</h2>
                    <p className="text-[11px] text-mt-ink-4">{selectedStore.client?.companyName || ""}</p>
                  </div>
                </div>
                <button className="p-1.5 hover:bg-mt-surface-2 rounded-lg transition-colors" onClick={() => setSelectedStoreId(null)}>
                  <X size={18} className="text-mt-ink-4" />
                </button>
              </div>

              {/* Status badge */}
              <div className="flex items-center gap-2 mb-5">
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={{
                    backgroundColor: selectedStore.status === "active" ? "#ECFDF5" : "#FEF3C7",
                    color: selectedStore.status === "active" ? "#059669" : "#D97706",
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: selectedStore.status === "active" ? "#059669" : "#D97706" }} />
                  {(selectedStore.status || "active").charAt(0).toUpperCase() + (selectedStore.status || "active").slice(1)}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-mt-surface-2 text-mt-ink-3 font-medium">
                  {selectedStore.storeType === "popup" ? "Pop-Up" : "Permanent"}
                </span>
              </div>

              <div className="space-y-0">
                <DetailRow label="Slug" value={selectedStore.slug || "—"} />
                <DetailRow label="SSO" value={selectedStore.ssoEnabled ? (selectedStore.ssoProvider || "Enabled") : "None"} />
                {/* TODO: checkoutEnabled not yet in stores schema — always shows Enabled for now */}
                <DetailRow label="Checkout" value="Enabled" />
                {/* TODO: productCount is not on stores table — add a storeProducts count query */}
                <DetailRow label="Products" value="—" />
              </div>

              {/* Users Section */}
              <div className="mt-5 pt-4" style={{ borderTop: "1px solid #F0F0F0" }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider">Store Users</h3>
                  <button
                    onClick={() => setShowUsersPanel(!showUsersPanel)}
                    className="text-[11px] font-medium text-primary hover:text-primary/90 transition-colors"
                  >
                    {showUsersPanel ? 'Hide' : 'Manage'}
                  </button>
                </div>

                {showUsersPanel && (
                  <div className="space-y-2 mb-4">
                    {/* Existing users */}
                    {storeUsersData && storeUsersData.length > 0 ? (
                      storeUsersData.map(u => (
                        <div key={u.id} className="flex items-center justify-between p-3 bg-mt-surface rounded-lg border border-[#F0F0F0]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              {u.role === 'admin' ? <Shield size={12} className="text-primary" /> : <User size={12} className="text-primary" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-mt-ink truncate">{u.name || u.email}</p>
                              <p className="text-[10px] text-mt-ink-4 truncate">{u.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-mt-surface-2 text-mt-ink-3 font-medium uppercase">
                              {u.role}
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                              u.status === 'active' ? 'bg-[#ECFDF5] text-[#059669]'
                              : u.status === 'invited' ? 'bg-[#FEF3C7] text-[#D97706]'
                              : 'bg-[#FEF2F2] text-[#EF4444]'
                            }`}>
                              {u.status || 'active'}
                            </span>
                            {(u.status === 'invited' || !u.passwordHash) && (
                              <button
                                onClick={() => resendInvite.mutate({ storeUserId: u.id, origin: window.location.origin })}
                                className="p-1 hover:bg-[#F0F0F0] rounded transition-colors"
                                title="Resend set-password email"
                              >
                                <Mail size={12} className="text-primary" />
                              </button>
                            )}
                            <button
                              onClick={() => setRemoveUserTarget({ id: u.id, label: u.name || u.email })}
                              className="p-1 hover:bg-[#FEF2F2] rounded transition-colors"
                            >
                              <X size={12} className="text-mt-ink-4 hover:text-[#EF4444]" />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 bg-mt-surface rounded-lg border border-dashed border-mt-border-2">
                        <Users size={16} className="mx-auto text-mt-ink-4 mb-1" />
                        <p className="text-[11px] text-mt-ink-4">No users assigned yet</p>
                      </div>
                    )}

                    {/* Add user form */}
                    {addingUser ? (
                      <div className="p-3 bg-[#F5F0FF] rounded-lg border border-primary/20">
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input
                            className="px-2.5 py-2 text-[12px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary transition-all"
                            placeholder="Full name"
                            value={newUser.name}
                            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                          />
                          <input
                            className="px-2.5 py-2 text-[12px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary transition-all"
                            placeholder="Email address"
                            value={newUser.email}
                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                          />
                          <select
                            className="px-2.5 py-2 text-[12px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary transition-all"
                            value={newUser.role}
                               onChange={(e) => setNewUser({ ...newUser, role: e.target.value as StoreUserRole })}>
                            <option value="admin">Admin (POC)</option>
                            <option value="manager">Manager</option>
                            <option value="employee">Employee</option>
                            <option value="intern">Intern</option>
                          </select>
                          <input
                            className="px-2.5 py-2 text-[12px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary transition-all"
                            placeholder="Department (optional)"
                            value={newUser.department}
                            onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (!newUser.name || !newUser.email) {
                                toast.error('Name and email are required');
                                return;
                              }
                              addUser.mutate({
                                storeId: selectedStore.id,
                                email: newUser.email,
                                name: newUser.name,
                                role: newUser.role,
                                department: newUser.department || undefined,
                              });
                            }}
                            disabled={addUser.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                          >
                            {addUser.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            Add & Send Invite
                          </button>
                          <button
                            onClick={() => { setAddingUser(false); setNewUser({ name: '', email: '', role: 'employee' as const, department: '' }); }}
                            className="px-3 py-1.5 text-[11px] font-medium text-mt-ink-3 hover:text-mt-ink transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingUser(true)}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-primary border border-dashed border-primary/30 rounded-lg hover:bg-[#F5F0FF] transition-colors"
                      >
                        <UserPlus size={14} />
                        Add User
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-5 pt-4" style={{ borderTop: "1px solid #F0F0F0" }}>
                <h3 className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-3">Quick Actions</h3>
                <div className="flex flex-col gap-1.5">
                  <button
                    className="w-full text-left px-3.5 py-3 text-[13px] flex items-center justify-between rounded-lg border border-mt-border hover:bg-mt-surface transition-colors"
                    onClick={() => navigate(`/store-management/${selectedStore.id}`)}
                  >
                    <span className="flex items-center gap-2.5 font-medium text-mt-ink">
                      <Eye size={14} className="text-primary" /> Manage Store
                    </span>
                    <ChevronRight size={14} className="text-[#D4D4D4]" />
                  </button>
                  <button
                    className="w-full text-left px-3.5 py-3 text-[13px] flex items-center justify-between rounded-lg border border-primary/20 hover:bg-[#F5F0FF] transition-colors"
                    onClick={() => {
                      toast.info("AI is optimizing your store...", { duration: 8000 });
                      aiOptimize.mutate({ storeId: selectedStore.id });
                    }}
                    disabled={aiOptimize.isPending}
                  >
                    <span className="flex items-center gap-2.5 font-medium text-primary">
                      {aiOptimize.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {aiOptimize.isPending ? "Optimizing..." : "AI Optimize Store"}
                    </span>
                    <ChevronRight size={14} className="text-[#D4D4D4]" />
                  </button>
                  <button
                    className="w-full text-left px-3.5 py-3 text-[13px] flex items-center justify-between rounded-lg border border-mt-border hover:bg-mt-surface transition-colors"
                    onClick={() => navigate(`/store-preview/${selectedStore.id}`)}
                  >
                    <span className="flex items-center gap-2.5 font-medium text-mt-ink">
                      <Pencil size={14} className="text-primary" /> Edit
                    </span>
                    <ChevronRight size={14} className="text-[#D4D4D4]" />
                  </button>
                  <Link href={`/s/${selectedStore.slug}`}>
                    <button
                      className="w-full text-left px-3.5 py-3 text-[13px] flex items-center justify-between rounded-lg border border-mt-border hover:bg-mt-surface transition-colors"
                    >
                      <span className="flex items-center gap-2.5 font-medium text-mt-ink">
                        <ExternalLink size={14} className="text-primary" /> Preview Live Store
                      </span>
                      <ChevronRight size={14} className="text-[#D4D4D4]" />
                    </button>
                  </Link>
                  {selectedStore.status === "draft" && (
                    <button
                      className="w-full text-left px-3.5 py-3 text-[13px] flex items-center justify-between rounded-lg border border-[#16A34A]/20 hover:bg-[#F0FDF4] transition-colors"
                      onClick={() => setConfirmModal({
                        title: "Publish this store?",
                        description: "The store will go live and be accessible to all authorized users. You can take it offline at any time.",
                        confirmLabel: "Publish",
                        variant: "primary",
                        action: "publish",
                      })}
                    >
                      <span className="flex items-center gap-2.5 font-medium text-[#16A34A]">
                        <CheckCircle size={14} /> Publish
                      </span>
                      <ChevronRight size={14} className="text-[#D4D4D4]" />
                    </button>
                  )}
                  {selectedStore.status === "active" && (
                    <button
                      className="w-full text-left px-3.5 py-3 text-[13px] flex items-center justify-between rounded-lg border border-[#F59E0B]/20 hover:bg-[#FFFBEB] transition-colors"
                      onClick={() => setConfirmModal({
                        title: "Take this store offline?",
                        description: "The store will no longer be accessible to users. You can republish it at any time.",
                        confirmLabel: "Take Offline",
                        variant: "destructive",
                        action: "offline",
                      })}
                    >
                      <span className="flex items-center gap-2.5 font-medium text-[#D97706]">
                        <Power size={14} /> Take Offline
                      </span>
                      <ChevronRight size={14} className="text-[#D4D4D4]" />
                    </button>
                  )}
                  <button
                    className="w-full text-left px-3.5 py-3 text-[13px] flex items-center justify-between rounded-lg border border-[#EF4444]/20 hover:bg-[#FEF2F2] transition-colors"
                    onClick={() => setConfirmModal({
                      title: "Delete this store?",
                      description: "All store data, products, and user assignments will be permanently removed. This cannot be undone.",
                      confirmLabel: "Delete",
                      variant: "destructive",
                      action: "delete",
                    })}
                  >
                    <span className="flex items-center gap-2.5 font-medium text-[#EF4444]">
                      <Trash2 size={14} /> Delete Store
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Store lifecycle confirmations — publish / offline / delete */}
      <ConfirmDialog
        open={confirmModal !== null}
        title={confirmModal?.title ?? ""}
        description={confirmModal?.description}
        confirmLabel={confirmModal?.confirmLabel ?? "Confirm"}
        confirmVariant={confirmModal?.variant ?? "destructive"}
        loading={updateStore.isPending || deleteStore.isPending}
        onCancel={() => setConfirmModal(null)}
        onConfirm={handleConfirmAction}
      />
      {/* Remove store user */}
      <ConfirmDialog
        open={removeUserTarget !== null}
        title="Remove this user from the store?"
        description={
          removeUserTarget
            ? <>{removeUserTarget.label} will lose access immediately. You can reinvite them any time.</>
            : null
        }
        confirmLabel="Remove"
        loading={removeUser.isPending}
        onCancel={() => setRemoveUserTarget(null)}
        onConfirm={() => {
          if (!removeUserTarget) return;
          removeUser.mutate(
            { id: removeUserTarget.id },
            { onSettled: () => setRemoveUserTarget(null) },
          );
        }}
      />
    </DashboardLayout>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5" style={{ borderBottom: "1px solid #F5F5F5" }}>
      <span className="text-[12px] font-medium text-mt-ink-4">{label}</span>
      <span className="text-[13px] font-semibold text-mt-ink">{value}</span>
    </div>
  );
}
