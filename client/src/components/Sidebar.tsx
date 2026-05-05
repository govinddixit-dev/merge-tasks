import { useState, useEffect, useContext } from "react";
import type { ComponentType, SVGProps } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { LogOut } from "lucide-react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { SidebarContext } from "@/contexts/SidebarContext";
import {
  LayoutDashboard,
  Store,
  FileText,
  Search,
  BarChart3,
  Settings,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Menu,
  X,
  Gift,
  Printer,
  Sparkles,
  Users,
  Zap,
  ShieldCheck,
  Truck,
  BrainCircuit,
  FolderOpen,
  Receipt,
  FileSpreadsheet,
  Bot,
  Inbox,
} from "lucide-react";

/**
 * Z-Index Scale
 *
 * z-[1]       navigation-menu viewport indicator (shadcn)
 * z-40/z-50   in-page slide-ins, dropdown backdrops, floating widgets (below sidebar)
 * z-[60]      webstore mobile drawer overlay, AI assistant FAB + panel
 * z-[9999]    mobile top bar (must sit above all page content)
 * z-[10000]   mobile sidebar backdrop
 * z-[10001]   mobile sidebar drawer (must sit above backdrop)
 * z-[10002]   modals and dialog overlays (must sit above the sidebar drawer)
 *
 */

/** Shared type for all Lucide icon components used in navigation */
type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

interface NavChild {
  path: string;
  label: string;
  icon: LucideIcon;
  tab?: string;
  /** If set, parent is considered "active" when the current location starts with any of these prefixes. */
  matchPrefixes?: string[];
}

interface NavItem {
  /**
   * Primary path. For parent groups this is the canonical representative route
   * (also used as the sidebar row key). Activating the parent does NOT navigate
   * — parents only expand/collapse — so for groups this just needs to be unique.
   */
  path: string;
  label: string;
  icon: LucideIcon;
  children?: NavChild[];
}

const navItems: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/clients", label: "Clients", icon: Users },
  { path: "/webstores", label: "Stores", icon: Store },
  { path: "/proposals", label: "Proposals", icon: FileText },
  {
    path: "/curation",
    label: "Product Curation",
    icon: Search,
    children: [
      { path: "/curation", label: "Promotional Items", icon: Gift, tab: "promo" },
      { path: "/curation", label: "Print Items", icon: Printer, tab: "print" },
      { path: "/virtual-proofing", label: "Virtual Proofing", icon: Sparkles },
    ],
  },
  {
    path: "/documents",
    label: "Documents",
    icon: FolderOpen,
    children: [
      { path: "/documents/estimates", label: "Estimates", icon: FileSpreadsheet, matchPrefixes: ["/documents/estimates", "/estimates"] },
      { path: "/documents/invoices", label: "Invoices", icon: Receipt, matchPrefixes: ["/documents/invoices", "/invoices"] },
      { path: "/purchase-orders", label: "Purchase Orders", icon: Truck, matchPrefixes: ["/purchase-orders"] },
    ],
  },
  {
    path: "/ai",
    label: "AI",
    icon: Bot,
    children: [
      { path: "/agent-inbox", label: "Inbox", icon: Inbox, matchPrefixes: ["/agent-inbox"] },
      { path: "/ai-insights", label: "Insights", icon: Zap, matchPrefixes: ["/ai-insights"] },
    ],
  },
  { path: "/reports", label: "Reports", icon: BarChart3 },
  { path: "/settings", label: "Settings", icon: Settings },
];

/**
 * Does `loc` match one of the child's declared prefixes (or, absent that, the
 * child's primary path)? Used for active highlighting of nested items.
 */
function childMatchesLocation(child: NavChild, loc: string): boolean {
  const prefixes = child.matchPrefixes ?? [child.path];
  return prefixes.some((p) => loc === p || loc.startsWith(`${p}/`));
}

/** Parent is "active" when any of its children match the current location. */
function parentIsActive(item: NavItem, loc: string): boolean {
  if (!item.children) return false;
  return item.children.some((c) => childMatchesLocation(c, loc));
}

export default function Sidebar() {
  const [location] = useLocation();
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [bannerHeight, setBannerHeight] = useState(0);
  const { user, isAuthenticated, logout } = useAuth();
  const { collapsed, setCollapsed } = useContext(SidebarContext);

  // Agent inbox badge count
  const { data: agentProposals } = trpc.actionApproval.listPending.useQuery(
    { source: "agent" },
    { enabled: isAuthenticated, refetchInterval: 30_000, staleTime: 20_000 },
  );
  const agentBadgeCount = agentProposals?.length ?? 0;

  // No platform banner — banner height is always 0
  useEffect(() => {
    setBannerHeight(0);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  // Auto-expand any parent group whose child matches the current route.
  // Runs on every location change so deep-links land with the correct group open.
  useEffect(() => {
    const shouldExpand = navItems
      .filter((item) => item.children && item.children.length > 0)
      .filter((item) =>
        item.path === "/curation"
          // Legacy: curation's children embed a `?tab=` param, so also expand
          // on /virtual-proofing for parity with the old behavior.
          ? location.startsWith("/curation") || location.startsWith("/virtual-proofing")
          : parentIsActive(item, location),
      )
      .map((item) => item.path);
    if (shouldExpand.length === 0) return;
    setExpandedItems((prev) => {
      const missing = shouldExpand.filter((p) => !prev.includes(p));
      return missing.length > 0 ? [...prev, ...missing] : prev;
    });
  }, [location]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const toggleExpand = (path: string) => {
    setExpandedItems((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className={`${collapsed ? 'px-3' : 'px-5'} pt-5 pb-6 flex items-center justify-between`}>
        {collapsed ? (
          <div className="w-full flex items-center justify-center">
            <div className="overflow-hidden" style={{ width: '28px' }}>
              <img
                src="/logo_clean.png"
                alt="MergeTasks"
                className="h-6 w-auto object-contain object-left"
                style={{ minWidth: '120px' }}
              />
            </div>
          </div>
        ) : (
          <img src="/logo_clean.png" alt="MergeTasks" className="h-5 w-auto object-contain object-left" />
        )}
        {/* Close button on mobile */}
        <button
          onClick={() => setMobileOpen(false)}
          className="xl:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mt-surface-2 text-mt-ink-3"
        >
          <X size={18} />
        </button>
      </div>

      {/* Quick Access label — expanded only */}
      {!collapsed && (
        <div className="px-6 pb-2">
          <span className="text-[11px] font-semibold text-mt-ink-4 tracking-wide uppercase">Quick Access</span>
        </div>
      )}

      {/* Navigation */}
      <nav className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} space-y-0.5`}>
        {navItems.map((item) => {
          const hasChildren = !!item.children && item.children.length > 0;
          const isActive = hasChildren
            ? (item.path === "/curation"
                ? location.startsWith("/curation") || location.startsWith("/virtual-proofing")
                : parentIsActive(item, location))
            : location === item.path;
          const isHovered = hoveredPath === item.path;
          const isExpanded = expandedItems.includes(item.path);
          const Icon = item.icon;

          const rowStyle = {
            backgroundColor: isActive ? '#F5F3FF' : isHovered ? '#FAFAFA' : 'transparent',
            color: isActive ? 'var(--mt-brand)' : isHovered ? '#1A1A1A' : '#525252',
            fontWeight: isActive ? 600 : 400,
          } as const;

          const rowClass = `flex items-center ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'} rounded-lg text-[14px] transition-all duration-150 relative`;

          return (
            <div key={item.path}>
              {/* Parent item */}
              {hasChildren ? (
                <div
                  className={`${rowClass} cursor-pointer select-none`}
                  style={rowStyle}
                  onMouseEnter={() => setHoveredPath(item.path)}
                  onMouseLeave={() => setHoveredPath(null)}
                  onClick={() => {
                    if (collapsed) {
                      // Expand sidebar and open this group in one click.
                      setCollapsed(false);
                      if (!isExpanded) toggleExpand(item.path);
                    } else {
                      toggleExpand(item.path);
                    }
                  }}
                  title={collapsed ? item.label : undefined}
                >
                  {isActive && !collapsed && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                      style={{ backgroundColor: 'var(--mt-brand)' }}
                    />
                  )}
                  <Icon size={18} strokeWidth={isActive ? 2 : 1.5} />
                  {!collapsed && (
                    <>
                      <span>{item.label}</span>
                      <div className="ml-auto">
                        {isExpanded ? (
                          <ChevronDown size={14} className="opacity-50" />
                        ) : (
                          <ChevronRight size={14} className="opacity-50" />
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <Link href={item.path}>
                  <div
                    className={rowClass}
                    style={rowStyle}
                    onMouseEnter={() => setHoveredPath(item.path)}
                    onMouseLeave={() => setHoveredPath(null)}
                    title={collapsed ? item.label : undefined}
                  >
                    {isActive && !collapsed && (
                      <motion.div
                        layoutId="sidebarActive"
                        className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r-full"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <Icon size={18} strokeWidth={isActive ? 2 : 1.5} />
                    {!collapsed && (
                      <>
                        <span>{item.label}</span>
                        {item.path === "/agent-inbox" && agentBadgeCount > 0 && (
                          <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">
                            {agentBadgeCount}
                          </span>
                        )}
                        {isActive && item.path !== "/agent-inbox" && (
                          <ChevronRight size={14} className="ml-auto opacity-50" />
                        )}
                      </>
                    )}
                    {/* Collapsed badge dot for agent inbox — keeps the count signal alive without text */}
                    {collapsed && item.path === "/agent-inbox" && agentBadgeCount > 0 && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-500" />
                    )}
                  </div>
                </Link>
              )}

              {/* Sub-items — hidden when collapsed */}
              {hasChildren && isExpanded && !collapsed && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l-2 border-[#F0F0F0] pl-0">
                  {item.children!.map((child) => {
                    const ChildIcon = child.icon;
                    const childHref = child.tab ? `${child.path}?tab=${child.tab}` : child.path;
                    const childKey = `${item.path}::${childHref}`;
                    const isChildHovered = hoveredPath === childKey;
                    const isChildActive = child.tab
                      ? location === child.path && new URLSearchParams(window.location.search).get('tab') === child.tab
                      : childMatchesLocation(child, location);
                    const showInboxBadge = child.path === "/agent-inbox" && agentBadgeCount > 0;

                    return (
                      <Link
                        key={childKey}
                        href={childHref}
                      >
                        <div
                          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-150 cursor-pointer"
                          style={{
                            backgroundColor: isChildActive ? '#F5F3FF' : isChildHovered ? '#FAFAFA' : 'transparent',
                            color: isChildActive ? 'var(--mt-brand)' : isChildHovered ? 'var(--mt-brand)' : '#737373',
                            fontWeight: isChildActive ? 600 : 400,
                          }}
                          onMouseEnter={() => setHoveredPath(childKey)}
                          onMouseLeave={() => setHoveredPath(null)}
                        >
                          <ChildIcon size={15} strokeWidth={1.5} />
                          <span>{child.label}</span>
                          {showInboxBadge && (
                            <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">
                              {agentBadgeCount}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Platform Admin — visible only to admin role */}
      {user?.role === "admin" && (
        <div className={`${collapsed ? 'px-2' : 'px-3'} pb-2`}>
          <div className="border-t border-mt-border pt-2">
            {!collapsed && (
              <span className="text-[11px] font-semibold text-mt-ink-4 tracking-wide uppercase px-3 block mb-1">Platform</span>
            )}
            <Link href="/platform-admin">
              <div
                className={`flex items-center ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'} rounded-lg text-[14px] transition-all duration-150 relative`}
                style={{
                  backgroundColor: location === '/platform-admin' ? '#F5F3FF' : 'transparent',
                  color: location === '/platform-admin' ? 'var(--mt-brand)' : '#525252',
                  fontWeight: location === '/platform-admin' ? 600 : 400,
                }}
                title={collapsed ? 'Admin Console' : undefined}
              >
                {location === '/platform-admin' && !collapsed && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ backgroundColor: 'var(--mt-brand)' }}
                  />
                )}
                <ShieldCheck size={18} strokeWidth={location === '/platform-admin' ? 2 : 1.5} />
                {!collapsed && <span>Admin Console</span>}
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <div className={`${collapsed ? 'px-2' : 'px-3'} pb-2`}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-end'} gap-2 px-2 py-2 rounded-lg text-mt-ink-4 hover:bg-mt-surface-2 hover:text-mt-ink transition-colors`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Legal footer links — Tier 1 compliance touchpoint. Expanded only. */}
      {!collapsed && (
        <div className="px-6 pb-3 flex items-center gap-2.5">
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[10px] text-mt-ink-4 hover:text-primary transition-colors">Terms</a>
          <span className="text-[10px] text-mt-ink-4">·</span>
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-[10px] text-mt-ink-4 hover:text-primary transition-colors">Privacy</a>
          <span className="text-[10px] text-mt-ink-4">·</span>
          <span className="text-[10px] text-mt-ink-4">© {new Date().getFullYear()} MergeTasks</span>
        </div>
      )}
      {/* User section */}
      <div className={`${collapsed ? 'px-2' : 'px-4'} py-4`} style={{ borderTop: '1px solid #F0F0F0' }}>
        {isAuthenticated && user ? (
          collapsed ? (
            <div className="flex items-center justify-center" title={user.name || user.email || 'User'}>
              <div
                className="w-9 h-9 flex items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ backgroundColor: 'var(--mt-brand)' }}
              >
                {(user.name || user.email || 'U').slice(0, 2).toUpperCase()}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-mt-surface transition-colors duration-150">
              <div
                className="w-9 h-9 flex items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ backgroundColor: 'var(--mt-brand)' }}
              >
                {(user.name || user.email || 'U').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-mt-ink truncate">
                  {user.name || user.email || 'User'}
                </p>
                <p className="text-[11px] text-mt-ink-4 truncate">
                  {user.role === 'admin' ? 'Admin' : 'Distributor'}
                </p>
              </div>
              <button
                onClick={() => logout()}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mt-surface-2 text-mt-ink-4 hover:text-primary transition-colors"
                title="Sign out"
              >
                <LogOut size={15} />
              </button>
            </div>
          )
        ) : (
          <a
            href="/sign-in"
            className={`flex items-center justify-center gap-2 ${collapsed ? 'px-2 py-2' : 'px-3 py-2.5'} rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-[#5438D4] transition-colors`}
            title={collapsed ? 'Sign In' : undefined}
          >
            {collapsed ? 'In' : 'Sign In'}
          </a>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar — positioned below any platform banners.
         Matches the desktop sidebar tone so the chrome reads as one
         surface at mobile widths too. */}
      <div className="xl:hidden fixed left-0 right-0 z-[9999] flex items-center px-4 h-14 shadow-sm" style={{ backgroundColor: '#F3F4F6', borderBottom: '1px solid #E5E5E5', top: bannerHeight > 0 ? `${bannerHeight}px` : '0px' }}>
        <button
          onClick={() => setMobileOpen(true)}
          className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-mt-surface-2 text-mt-ink active:bg-[#EEEBFF] active:text-primary transition-colors"
          aria-label="Open menu"
        >
          <Menu size={22} strokeWidth={2} />
        </button>
        <img src="/logo_clean.png" alt="MergeTasks" className="h-5 object-contain ml-2" />
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="xl:hidden fixed inset-0 bg-black/30 z-[10000]"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — desktop: fixed, mobile: slide-out drawer.
         #F3F4F6 is one step darker than the content canvas (#F9FAFB), so
         the sidebar reads as subtly distinct while still belonging to the
         same shell surface — no mismatched-white seam. */}
      <aside
        className={`
          fixed left-0 top-0 bottom-0 flex flex-col z-[10001]
          ${collapsed ? 'w-[64px]' : 'w-[260px]'}
          transition-all duration-200 ease-in-out
          xl:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{ backgroundColor: '#F3F4F6', borderRight: '1px solid #F0F0F0' }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
