"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CurrentUser } from "@/lib/api";
import { ThemeSwitcher } from "./ThemeSwitcher";

/** The old persistent rail's utility controls (search, role-preview, theme,
 * avatar), now a small floating cluster instead of a permanent left column --
 * there's no more rail to anchor them to once navigation is space-based (see
 * page.tsx), so they float top-right like a real HUD corner readout. */
export function HudToolbar({
  user, previewRole, onPreviewRoleChange, onOpenSearch,
}: {
  user: CurrentUser;
  previewRole?: "boss" | "sales_agent";
  onPreviewRoleChange?: (r: "boss" | "sales_agent") => void;
  onOpenSearch?: () => void;
}) {
  const [themeOpen, setThemeOpen] = useState(false);
  const [themePos, setThemePos] = useState<{ left: number; top: number } | null>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const themePopoverRef = useRef<HTMLDivElement>(null);

  const [roleOpen, setRoleOpen] = useState(false);
  const [rolePos, setRolePos] = useState<{ left: number; top: number } | null>(null);
  const roleBtnRef = useRef<HTMLButtonElement>(null);
  const rolePopoverRef = useRef<HTMLDivElement>(null);

  function repositionTheme() {
    const r = themeBtnRef.current?.getBoundingClientRect();
    if (r) setThemePos({ left: r.left + r.width / 2, top: r.bottom + 8 });
  }
  useLayoutEffect(() => { if (themeOpen) repositionTheme(); }, [themeOpen]);
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
    if (r) setRolePos({ left: r.left + r.width / 2, top: r.bottom + 8 });
  }
  useLayoutEffect(() => { if (roleOpen) repositionRole(); }, [roleOpen]);
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
    <div
      className="glass-panel"
      style={{ position: "fixed", top: 16, right: 16, zIndex: 400, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}
    >
      {onOpenSearch && (
        <button
          onClick={onOpenSearch}
          title="Поиск (Ctrl/⌘+K)"
          className="press"
          style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--color-hairline-soft)", background: "rgba(255,255,255,.03)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="var(--color-text-soft)" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
        </button>
      )}
      {onPreviewRoleChange && (
        <div style={{ position: "relative" }}>
          <button
            ref={roleBtnRef}
            onClick={() => setRoleOpen((v) => !v)}
            title="Показать как…"
            className="press"
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
              style={{ position: "fixed", top: rolePos.top, left: rolePos.left, transform: "translateX(-50%)", padding: 8, zIndex: 1000, width: 150 }}
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
          className="press"
          style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--color-hairline-soft)", background: "rgba(255,255,255,.03)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="var(--color-text-soft)" strokeWidth={2}>
            <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        </button>
        {themeOpen && themePos && createPortal(
          <div
            ref={themePopoverRef}
            className="glass-panel"
            style={{ position: "fixed", top: themePos.top, left: themePos.left, transform: "translateX(-50%)", padding: 10, zIndex: 1000 }}
          >
            <ThemeSwitcher />
          </div>,
          document.body
        )}
      </div>
      <div
        title={`${user.email} · ${user.role === "boss" ? "Босс" : "Агент"}`}
        style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--v-accent-tint)", color: "var(--v-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}
      >
        {(user.role === "boss" ? "Б" : "А")}
      </div>
    </div>
  );
}
