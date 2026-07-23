"use client";
import { CurrentUser } from "@/lib/api";
import { ThemeSwitcher } from "./ThemeSwitcher";

export type Section = "assistant" | "units" | "leads" | "docs" | "analytics";

const NAV: { key: Section; label: string; bossOnly?: boolean }[] = [
  { key: "assistant", label: "✨ Ассистент" },
  { key: "units", label: "🏢 Юниты" },
  { key: "leads", label: "👥 Лиды" },
  { key: "docs", label: "📄 Справки" },
  { key: "analytics", label: "📊 Аналитика", bossOnly: true },
];

export function Sidebar({
  user, active, onChange, pendingCount,
}: {
  user: CurrentUser;
  active: Section;
  onChange: (s: Section) => void;
  pendingCount: number;
}) {
  return (
    <div className="glass-panel" style={{ width: 240, flexShrink: 0, padding: "20px 14px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 8px 22px" }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--v-accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
            <circle cx="12" cy="12" r="3.4" />
            <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
          </svg>
        </div>
        <div>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 16, lineHeight: 1, color: "var(--color-text)" }}>Argus</div>
          <div style={{ fontSize: 10.5, color: "var(--color-text-faint)", marginTop: 3, letterSpacing: ".03em" }}>Italiano Vero</div>
        </div>
      </div>

      {NAV.filter((n) => !n.bossOnly || user.role === "boss").map((n) => {
        const isActive = active === n.key;
        return (
          <div
            key={n.key}
            onClick={() => onChange(n.key)}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 12,
              fontSize: 14, fontWeight: 600, marginBottom: 3, cursor: "pointer",
              background: isActive ? "var(--v-accent-tint)" : "transparent",
              color: isActive ? "var(--v-accent)" : "var(--color-text-soft)",
            }}
          >
            <span>{n.label}</span>
            {n.key === "docs" && pendingCount > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, background: "var(--v-accent)", color: "var(--v-text-on-accent)", borderRadius: 99, padding: "1px 7px" }}>
                {pendingCount}
              </span>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid var(--color-hairline-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 10px" }}>
          <span style={{ fontSize: 10.5, color: "var(--color-text-faint)", letterSpacing: ".04em", textTransform: "uppercase" }}>Тема</span>
          <ThemeSwitcher />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 12px 4px" }}>
          <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--v-accent-tint)", color: "var(--v-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>
            {(user.role === "boss" ? "М" : "А")}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--color-text)", fontWeight: 600 }}>{user.email.split("@")[0]}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{user.role === "boss" ? "Босс" : "Агент"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
