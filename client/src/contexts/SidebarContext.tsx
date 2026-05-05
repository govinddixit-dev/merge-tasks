import * as React from "react";

export const SidebarContext = React.createContext<{
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}>({ collapsed: false, setCollapsed: () => {} });

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem('mt_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const set = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem('mt_sidebar_collapsed', String(v)); } catch {}
  };
  return <SidebarContext.Provider value={{ collapsed, setCollapsed: set }}>{children}</SidebarContext.Provider>;
}
