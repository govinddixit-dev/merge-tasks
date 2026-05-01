import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bell, AlertTriangle, Clock, ShoppingCart, CheckCircle2, Package,
  TrendingUp, X, Settings, ChevronRight, Zap, Users, FileText, Trash2
} from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

//  Type map from backend notification types to UI config 

type BackendNotifType =
  | "proposal_sent" | "proposal_viewed" | "proposal_approved" | "proposal_declined"
  | "order_placed" | "order_shipped" | "order_delivered"
  | "store_order" | "store_user_joined"
  | "payment_received" | "invoice_overdue"
  | "approval_requested" | "approval_granted" | "approval_denied"
  | "ai_insight" | "system";

const typeConfig: Record<BackendNotifType, { icon: typeof Bell; color: string; bg: string }> = {
  proposal_sent:      { icon: FileText,       color: 'var(--mt-brand)', bg: "#F5F3FF" },
  proposal_viewed:    { icon: FileText,       color: "#2563EB", bg: "#EFF6FF" },
  proposal_approved:  { icon: CheckCircle2,   color: "#16A34A", bg: "#F0FDF4" },
  proposal_declined:  { icon: AlertTriangle,  color: "#EF4444", bg: "#FEF2F2" },
  order_placed:       { icon: ShoppingCart,   color: "#16A34A", bg: "#F0FDF4" },
  order_shipped:      { icon: Package,        color: "#2563EB", bg: "#EFF6FF" },
  order_delivered:    { icon: CheckCircle2,   color: "#16A34A", bg: "#F0FDF4" },
  store_order:        { icon: ShoppingCart,   color: "#16A34A", bg: "#F0FDF4" },
  store_user_joined:  { icon: Users,          color: 'var(--mt-brand)', bg: "#F5F3FF" },
  payment_received:   { icon: TrendingUp,     color: "#16A34A", bg: "#F0FDF4" },
  invoice_overdue:    { icon: AlertTriangle,  color: "#EF4444", bg: "#FEF2F2" },
  approval_requested: { icon: Clock,          color: "#D97706", bg: "#FFFBEB" },
  approval_granted:   { icon: CheckCircle2,   color: "#16A34A", bg: "#F0FDF4" },
  approval_denied:    { icon: X,              color: "#EF4444", bg: "#FEF2F2" },
  ai_insight:         { icon: Zap,            color: 'var(--mt-brand)', bg: "#F5F3FF" },
  system:             { icon: Zap,            color: "#737373", bg: "#F5F5F5" },
};

const NOTIFICATION_REFETCH_INTERVAL_MS = 15_000;
const NOTIFICATION_STALE_TIME_MS = 60_000;

function getConfig(type: string) {
  return typeConfig[type as BackendNotifType] || typeConfig.system;
}

function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) !== 1 ? "s" : ""} ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  //  tRPC queries and mutations 
  const utils = trpc.useUtils();

  // Gate polling on tab visibility — stop firing requests when the tab is hidden
  const [isVisible, setIsVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onVisibilityChange = () => setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const { data: notifData, isLoading } = trpc.notifications.list.useQuery(
    { limit: 50 },
    {
      // Poll faster when the panel is open; stop entirely when tab is hidden
      refetchInterval: isVisible ? (open ? NOTIFICATION_REFETCH_INTERVAL_MS : NOTIFICATION_STALE_TIME_MS) : false,
      staleTime: 10000,
    }
  );

  const markReadMut = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
    onError: () => toast.error("Failed to mark as read"),
  });

  const markAllReadMut = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
    onError: () => toast.error("Failed to mark all as read"),
  });

  const deleteMut = trpc.notifications.delete.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
    onError: () => toast.error("Failed to delete notification"),
  });

  type NotifItem = NonNullable<typeof notifData>[number];
  const notifications: NotifItem[] = notifData ?? [];
  const unreadCount = notifications.filter((n: NotifItem) => !n.read).length;
  const displayed = filter === "all" ? notifications : notifications.filter((n: NotifItem) => !n.read);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleMarkRead = (id: number) => {
    markReadMut.mutate({ id });
  };

  const handleMarkAllRead = () => {
    markAllReadMut.mutate();
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteMut.mutate({ id });
  };

  const handleNotifClick = (n: NotifItem) => {
    if (!n.read) handleMarkRead(n.id);
    if (n.actionPath) {
      setOpen(false);
      navigate(n.actionPath);
    }
  };

  return (
    <div className="relative" ref={ref}>
      {/* Bell Button */}
      <button
        className="relative p-2 rounded-full hover:bg-gray-100 transition-colors duration-150"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
      >
        <Bell size={18} className={`text-mt-ink-2 ${unreadCount > 0 ? "animate-wiggle" : ""}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white min-w-[18px] h-[18px] px-1"
            style={{ backgroundColor: "#EF4444" }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-[400px] bg-white rounded-xl shadow-lg border border-mt-border z-50 overflow-hidden"
          style={{ maxHeight: '520px' }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #F0F0F0' }}>
            <div>
              <h3 className="text-[14px] font-bold text-mt-ink">Notifications</h3>
              {unreadCount > 0 && (
                <p className="text-[11px] text-mt-ink-3 mt-0.5">{unreadCount} unread</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                  onClick={handleMarkAllRead}
                  disabled={markAllReadMut.isPending}
                >
                  Mark all read
                </button>
              )}
              <button
                className="p-1.5 rounded-lg hover:bg-mt-surface-2 transition-colors"
                onClick={() => { setOpen(false); navigate("/settings"); }}
                title="Notification Settings"
              >
                <Settings size={14} className="text-mt-ink-4" />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="px-5 pt-3 pb-1 flex gap-1">
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                className={`text-[11px] font-semibold px-3 py-1.5 rounded-md transition-all ${
                  filter === f ? "bg-primary text-white" : "text-mt-ink-3 hover:bg-mt-surface-2"
                }`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : `Unread (${unreadCount})`}
              </button>
            ))}
          </div>

          {/* Notification List */}
          <div className="overflow-y-auto" style={{ maxHeight: '380px' }}>
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-[12px] text-mt-ink-4">Loading notifications...</p>
              </div>
            ) : displayed.length === 0 ? (
              <div className="py-12 text-center">
                <Bell size={24} className="mx-auto text-[#E5E5E5] mb-2" />
                <p className="text-[13px] text-mt-ink-4">
                  {filter === "unread" ? "No unread notifications" : "No notifications yet"}
                </p>
                {filter === "unread" && (
                  <button
                    className="mt-2 text-[11px] text-primary hover:underline"
                    onClick={() => setFilter("all")}
                  >
                    View all
                  </button>
                )}
              </div>
            ) : (
              displayed.map((n: NotifItem) => {
                const config = getConfig(n.type);
                const Icon = config.icon;
                return (
                  <div
                    key={n.id}
                    className={`px-5 py-3.5 flex gap-3 transition-colors cursor-pointer hover:bg-mt-surface group ${
                      !n.read ? "bg-[#FAFBFF]" : ""
                    }`}
                    style={{ borderBottom: '1px solid #F5F5F5' }}
                    onClick={() => handleNotifClick(n)}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
                      style={{ backgroundColor: config.bg }}>
                      <Icon size={14} style={{ color: config.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className={`text-[12px] font-semibold text-mt-ink ${!n.read ? "" : "opacity-70"}`}>
                          {n.title}
                        </h4>
                        {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                      </div>
                      <p className="text-[11px] text-mt-ink-3 mt-0.5 leading-relaxed line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-mt-ink-4">{timeAgo(n.createdAt)}</span>
                        {n.actionLabel && (
                          <span className="text-[10px] font-semibold text-primary flex items-center gap-0.5">
                            {n.actionLabel} <ChevronRight size={8} />
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Delete button — visible on hover */}
                    <button
                      className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#FEF2F2] mt-0.5"
                      onClick={(e) => handleDelete(e, n.id)}
                      title="Delete notification"
                    >
                      <Trash2 size={11} className="text-[#EF4444]" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 text-center" style={{ borderTop: '1px solid #F0F0F0' }}>
            <button
              className="text-[11px] font-semibold text-primary hover:underline"
              onClick={() => { setOpen(false); navigate("/settings"); }}
            >
              Notification Preferences
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
