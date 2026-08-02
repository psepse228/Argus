"use client";
import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "crimson" | "mono" | "teal" | "crimson-light" | "mono-light" | "teal-light";
const STORAGE_KEY = "argus-theme";
const THEMES: Theme[] = ["crimson", "mono", "teal", "crimson-light", "mono-light", "teal-light"];

/** Two sections, dark and light -- same three accent identities in each,
 * not six unrelated themes. See ThemeSwitcher for the grouped UI. */
export const DARK_THEMES: Theme[] = ["crimson", "mono", "teal"];
export const LIGHT_THEMES: Theme[] = ["crimson-light", "mono-light", "teal-light"];

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
  "crimson-light": "Crimson",
  "mono-light": "Mono",
  "teal-light": "Teal",
};
