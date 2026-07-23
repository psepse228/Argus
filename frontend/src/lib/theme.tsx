"use client";
import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "gold" | "mono" | "teal";
const STORAGE_KEY = "argus-theme";
const THEMES: Theme[] = ["gold", "mono", "teal"];

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: "gold",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("gold");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored && THEMES.includes(stored)) applyTheme(stored);
  }, []);

  function applyTheme(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    window.localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  }

  return <ThemeContext.Provider value={{ theme, setTheme: applyTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export const THEME_LABELS: Record<Theme, string> = {
  gold: "Gold",
  mono: "Mono",
  teal: "Teal",
};
