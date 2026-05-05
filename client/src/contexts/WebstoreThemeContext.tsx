/**
 * WebstoreThemeContext — dark/light mode toggle for the webstore.
 * Extracted from WebstoreLayout for single-responsibility.
 */
import { createContext, useContext, useState, ReactNode } from "react";

interface WebstoreThemeContextType {
  isDark: boolean;
  toggle: () => void;
  /** Derived colour values for inline styles — use CSS variables where possible */
  bg: string;
  fg: string;
  mutedFg: string;
  borderColor: string;
}

const WebstoreThemeContext = createContext<WebstoreThemeContextType>({
  isDark: false,
  toggle: () => {},
  bg: "#FFFFFF",
  fg: "#1A1A1A",
  mutedFg: "#737373",
  borderColor: "#E5E5E5",
});

export function WebstoreThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(false);
  const toggle = () => setIsDark(d => !d);

  const bg = isDark ? "#1A1A1A" : "#FFFFFF";
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#6B6B76" : "#737373";
  const borderColor = isDark ? "#1C1C24" : "#E5E5E5";

  return (
    <WebstoreThemeContext.Provider value={{ isDark, toggle, bg, fg, mutedFg, borderColor }}>
      {children}
    </WebstoreThemeContext.Provider>
  );
}

export function useWebstoreTheme() {
  return useContext(WebstoreThemeContext);
}
