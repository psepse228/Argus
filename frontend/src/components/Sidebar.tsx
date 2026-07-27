"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CurrentUser } from "@/lib/api";
import { ThemeSwitcher } from "./ThemeSwitcher";

export type Section = "assistant" | "units" | "leads" | "clients" | "docs" | "analytics";

// Ассистент is deliberately not in this list -- it's the primary surface,
// rendered as its own dedicated rail button above a divider, not one of N
// equal tabs. Everything below the divider is a supporting tool the
// assistant can also reach data from, reachable directly when needed.
const TOOLS: { key: Section; label: string; icon: JSX.Element; bossOnly?: boolean }[] = [
  {
    key: "clients", label: "Клиенты", icon: (
      <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="8" r="3.4" /><path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7" />
      </svg>
    ),
  },
  {
    key: "leads", label: "Лиды", icon: (
      <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
        <circle cx="18" cy="9" r="2.4" /><path d="M15.5 20c.3-2.5 1.8-4.3 3.8-4.7" />
      </svg>
    ),
  },
  {
    key: "docs", label: "Справки", icon: (
      <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      </svg>
    ),
  },
  {
    key: "analytics", label: "Аналитика", bossOnly: true, icon: (
      <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M3 3v18h18" /><path d="M7 16l4-5 3 3 5-7" />
      </svg>
    ),
  },
  // Deprioritized per owner's feedback -- least-used tool, pushed to last.
  {
    key: "units", label: "Юниты", icon: (
      <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-7h6v7" />
      </svg>
    ),
  },
];

function RailButton({
  active, label, onClick, children, badge,
}: { active: boolean; label: string; onClick: () => void; children: React.ReactNode; badge?: number }) {
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onClick}
        title={label}
        style={{
          width: 46, height: 46, borderRadius: 14, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: active ? "var(--v-accent)" : "rgba(255,255,255,.04)",
          color: active ? "var(--v-text-on-accent)" : "var(--color-text-soft)",
          boxShadow: active ? "0 12px 26px -9px color-mix(in srgb, var(--v-accent) 60%, transparent)" : "none",
          transition: "background .15s ease, color .15s ease, box-shadow .15s ease",
        }}
      >
        {children}
      </button>
      {!!badge && (
        <span style={{
          position: "absolute", top: -4, right: -4, fontSize: 10, fontWeight: 700,
          background: "var(--v-accent)", color: "var(--v-text-on-accent)",
          borderRadius: 99, minWidth: 16, height: 16, display: "flex", alignItems: "center",
          justifyContent: "center", padding: "0 3px",
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}

export function Sidebar({
  user, active, onChange, pendingCount, previewRole, onPreviewRoleChange,
}: {
  user: CurrentUser;
  active: Section;
  onChange: (s: Section) => void;
  pendingCount: number;
  /** Only set for the real boss account -- lets them flip the whole app's
   * view to what an agent sees, for client demos, without a second Google
   * login. Purely cosmetic on the frontend; every request still runs as
   * the real authenticated user, so backend permissions never change. */
  previewRole?: "boss" | "sales_agent";
  onPreviewRoleChange?: (r: "boss" | "sales_agent") => void;
}) {
  const [themeOpen, setThemeOpen] = useState(false);
  const [themePos, setThemePos] = useState<{ left: number; bottom: number } | null>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const themePopoverRef = useRef<HTMLDivElement>(null);

  const [roleOpen, setRoleOpen] = useState(false);
  const [rolePos, setRolePos] = useState<{ left: number; bottom: number } | null>(null);
  const roleBtnRef = useRef<HTMLButtonElement>(null);
  const rolePopoverRef = useRef<HTMLDivElement>(null);

  function repositionTheme() {
    const r = themeBtnRef.current?.getBoundingClientRect();
    if (r) setThemePos({ left: r.left + r.width / 2, bottom: window.innerHeight - r.top + 8 });
  }

  useLayoutEffect(() => {
    if (themeOpen) repositionTheme();
  }, [themeOpen]);

  useEffect(() => {
    if (!themeOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (themeBtnRef.current?.contains(t)) return;
      if (themePopoverRef.current?.contains(t)) return;
      setThemeOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setThemeOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [themeOpen]);

  function repositionRole() {
    const r = roleBtnRef.current?.getBoundingClientRect();
    if (r) setRolePos({ left: r.left + r.width / 2, bottom: window.innerHeight - r.top + 8 });
  }

  useLayoutEffect(() => {
    if (roleOpen) repositionRole();
  }, [roleOpen]);

  useEffect(() => {
    if (!roleOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (roleBtnRef.current?.contains(t)) return;
      if (rolePopoverRef.current?.contains(t)) return;
      setRoleOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setRoleOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [roleOpen]);

  return (
    <div className="glass-panel" style={{ width: 76, flexShrink: 0, padding: "18px 0", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Decorative brand mark (Argus/Panoptes -- the all-seeing watchman),
          not a control -- aria-hidden so it doesn't read as an unlabeled
          button to assistive tech or look interactive by accident. */}
      <div
        aria-hidden="true"
        style={{ width: 34, height: 34, borderRadius: 10, background: "var(--v-accent)", boxShadow: "0 10px 22px -6px color-mix(in srgb, var(--v-accent) 65%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginBottom: 22, cursor: "default" }}
      >
        <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
          <circle cx="12" cy="12" r="3.4" />
          <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
        </svg>
      </div>

      {/* Primary surface -- visually distinct from the tools below, not one
          of N equal siblings. Larger, always first, own accent glow. */}
      <RailButton active={active === "assistant"} label="Ассистент" onClick={() => onChange("assistant")}>
        <svg viewBox="0 0 24 24" width={21} height={21} fill="none" stroke="currentColor" strokeWidth={1.9}>
          <path d="M12 3l1.8 4.3L18 9l-4.2 1.7L12 15l-1.8-4.3L6 9l4.2-1.7L12 3Z" />
          <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" />
        </svg>
      </RailButton>

      <div style={{ width: 28, height: 1, background: "var(--color-hairline-soft)", margin: "16px 0" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TOOLS.filter((t) => !t.bossOnly || user.role === "boss").map((t) => (
          <RailButton
            key={t.key}
            active={active === t.key}
            label={t.label}
            onClick={() => onChange(t.key)}
            badge={t.key === "docs" ? pendingCount : undefined}
          >
            {t.icon}
          </RailButton>
        ))}
      </div>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {onPreviewRoleChange && (
          <div style={{ position: "relative" }}>
            <button
              ref={roleBtnRef}
              onClick={() => setRoleOpen((v) => !v)}
              title="Показать как…"
              style={{
                width: 32, height: 32, borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                border: previewRole === "sales_agent" ? "1px solid var(--v-accent)" : "1px solid var(--color-hairline-soft)",
                background: previewRole === "sales_agent" ? "var(--v-accent-tint)" : "rgba(255,255,255,.03)",
                color: previewRole === "sales_agent" ? "var(--v-accent)" : "var(--color-text-soft)",
              }}
            >
              <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            {roleOpen && rolePos && createPortal(
              <div
                ref={rolePopoverRef}
                className="glass-panel"
                style={{ position: "fixed", bottom: rolePos.bottom, left: rolePos.left, transform: "translateX(-50%)", padding: 8, zIndex: 1000, width: 150 }}
              >
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", padding: "4px 8px 8px" }}>
                  Показать как
                </div>
                {(["boss", "sales_agent"] as const).map((r) => (
                  <div
                    key={r}
                    onClick={() => { onPreviewRoleChange(r); setRoleOpen(false); }}
                    style={{
                      fontSize: 12.5, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                      background: previewRole === r ? "var(--v-accent-tint)" : "transparent",
                      color: previewRole === r ? "var(--v-accent)" : "var(--color-text)",
                      fontWeight: previewRole === r ? 700 : 500,
                    }}
                  >
                    {r === "boss" ? "Босс" : "Агент"}
                  </div>
                ))}
              </div>,
              document.body
            )}
          </div>
        )}
        <div style={{ position: "relative" }}>
          <button
            ref={themeBtnRef}
            onClick={() => setThemeOpen((v) => !v)}
            title="Тема"
            style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--color-hairline-soft)", background: "rgba(255,255,255,.03)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="var(--color-text-soft)" strokeWidth={2}>
              <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          </button>
          {/* Portaled -- this button lives inside the sidebar's own
              .glass-panel (overflow: hidden for the sheen highlight), so a
              plain absolutely-positioned popover here gets clipped to zero
              visible height and silently never appears (same root cause as
              Dropdown.tsx). */}
          {themeOpen && themePos && createPortal(
            <div
              ref={themePopoverRef}
              className="glass-panel"
              style={{ position: "fixed", bottom: themePos.bottom, left: themePos.left, transform: "translateX(-50%)", padding: 10, zIndex: 1000 }}
            >
              <ThemeSwitcher />
            </div>,
            document.body
          )}
        </div>
        <div
          title={`${user.email} · ${user.role === "boss" ? "Босс" : "Агент"}`}
          style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--v-accent-tint)", color: "var(--v-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}
        >
          {(user.role === "boss" ? "Б" : "А")}
        </div>
      </div>
    </div>
  );
}
