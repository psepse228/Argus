"use client";
import { CurrentUser } from "@/lib/api";

export type Section = "assistant" | "leads" | "clients" | "units" | "analytics" | "calendar" | "ai_journal";

export const SPACES: { key: Section; label: string; icon: JSX.Element; bossOnly?: boolean }[] = [
  {
    key: "assistant", label: "Ассистент", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.9}>
        <path d="M12 3l1.8 4.3L18 9l-4.2 1.7L12 15l-1.8-4.3L6 9l4.2-1.7L12 3Z" />
        <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" />
      </svg>
    ),
  },
  {
    key: "leads", label: "Лиды", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
        <circle cx="18" cy="9" r="2.4" /><path d="M15.5 20c.3-2.5 1.8-4.3 3.8-4.7" />
      </svg>
    ),
  },
  {
    key: "clients", label: "Клиенты", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="8" r="3.4" /><path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7" />
      </svg>
    ),
  },
  {
    key: "analytics", label: "Аналитика", bossOnly: true, icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M3 3v18h18" /><path d="M7 16l4-5 3 3 5-7" />
      </svg>
    ),
  },
  {
    key: "units", label: "Юниты", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-7h6v7" />
      </svg>
    ),
  },
  {
    key: "calendar", label: "Календарь", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="5" width="18" height="16" rx="2.2" /><path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    key: "ai_journal", label: "Argus Brain", icon: (
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v5h5" /><path d="M8 12h8M8 16h5" />
      </svg>
    ),
  },
];

/** Replaces the old persistent left rail -- since navigation is now "swipe/
 * scroll/arrow-key between full-screen HUD spaces" (see page.tsx), all that's
 * left to show is *where you are*: a minimal floating dot-strip, macOS-
 * Spaces-style, bottom-center instead of a docked sidebar. Clicking a dot
 * jumps straight there; the sliding highlight tracks the active one the same
 * way the old rail's indicator did, just horizontally now. */
export function SpaceIndicator({
  user, activeIndex, onJump, badges,
}: {
  user: CurrentUser;
  activeIndex: number;
  onJump: (index: number) => void;
  /** Section key -> badge count (e.g. pending справки), shown as a small dot. */
  badges?: Partial<Record<Section, number>>;
}) {
  const visible = SPACES.filter((s) => !s.bossOnly || user.role === "boss");

  return (
    <div
      className="glass-panel"
      style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 400, padding: 6, display: "flex", gap: 4 }}
    >
      <div style={{ position: "relative", display: "flex", gap: 4 }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute", top: 0, left: 0, width: 44, height: 44, borderRadius: 12, zIndex: 0,
            background: "var(--v-accent)",
            boxShadow: "0 12px 26px -9px color-mix(in srgb, var(--v-accent) 60%, transparent)",
            transform: `translateX(${activeIndex * 48}px)`,
            transition: "transform .4s cubic-bezier(.2,.7,.3,1)",
          }}
        />
        {visible.map((s, i) => {
          const badge = badges?.[s.key];
          const isActive = i === activeIndex;
          return (
            <div key={s.key} className="space-indicator-item" style={{ position: "relative" }}>
              <button
                onClick={() => onJump(i)}
                aria-label={s.label}
                className="press"
                style={{
                  width: 44, height: 44, borderRadius: 12, border: "none", cursor: "pointer", position: "relative", zIndex: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent",
                  color: isActive ? "var(--v-text-on-accent)" : "var(--color-text-soft)",
                }}
              >
                {s.icon}
              </button>
              <span className="space-indicator-tooltip" aria-hidden="true">{s.label}</span>
              {!!badge && (
                <span style={{
                  position: "absolute", top: -3, right: -3, fontSize: 9.5, fontWeight: 700, zIndex: 2,
                  background: "var(--danger)", color: "#fff",
                  borderRadius: 99, minWidth: 15, height: 15, display: "flex", alignItems: "center",
                  justifyContent: "center", padding: "0 3px",
                }}>
                  {badge}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
