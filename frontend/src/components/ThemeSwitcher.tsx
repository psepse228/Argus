"use client";
import { useTheme, THEME_LABELS, Theme, DARK_THEMES, LIGHT_THEMES } from "@/lib/theme";

const SWATCH: Record<Theme, string> = {
  crimson: "#f01c52", mono: "#e8e8e8", teal: "#2dd4bf",
  "crimson-light": "#d81049", "mono-light": "#18181b", "teal-light": "#0f9488",
};

function Row({ themes, theme, setTheme }: { themes: Theme[]; theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {themes.map((t) => (
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

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const label: React.CSSProperties = {
    fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".06em",
    color: "var(--color-text-faint)", marginBottom: 5,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 4px" }}>
      <div>
        <div style={label}>Тёмная</div>
        <Row themes={DARK_THEMES} theme={theme} setTheme={setTheme} />
      </div>
      <div>
        <div style={label}>Светлая</div>
        <Row themes={LIGHT_THEMES} theme={theme} setTheme={setTheme} />
      </div>
    </div>
  );
}
