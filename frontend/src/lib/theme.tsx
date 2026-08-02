"use client";
import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "crimson" | "mono" | "teal" | "light";
const STORAGE_KEY = "argus-theme";
const THEMES: Theme[] = ["crimson", "mono", "teal", "light"];

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: "crimson",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("crimson");

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
  crimson: "Crimson",
  mono: "Mono",
  teal: "Teal",
  light: "Light",
};
