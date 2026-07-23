"use client";
import { useTheme, THEME_LABELS, Theme } from "@/lib/theme";

const SWATCH: Record<Theme, string> = { gold: "#d4a72c", mono: "#e8e8e8", teal: "#2dd4bf" };
const THEMES: Theme[] = ["gold", "mono", "teal"];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div style={{ display: "flex", gap: 6, padding: "2px 4px" }}>
      {THEMES.map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          title={THEME_LABELS[t]}
          style={{
            width: 22, height: 22, borderRadius: "50%", cursor: "pointer",
            background: SWATCH[t],
            border: theme === t ? "2px solid var(--color-text)" : "1px solid var(--color-hairline)",
            boxShadow: theme === t ? "0 0 0 2px var(--v-accent-tint)" : "none",
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
