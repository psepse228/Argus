"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type DropdownOption = { value: string; label: string };

/** Custom-styled dropdown replacing the native <select> -- a native select's
 * open list is always rendered by the OS/browser chrome (white background,
 * system font) no matter what CSS is applied to the closed control, which is
 * exactly the mismatch flagged live: a white Windows dropdown list sitting
 * inside an otherwise dark glassmorphic app. This renders its own list.
 *
 * The option list is portaled to document.body and positioned via the
 * trigger's real getBoundingClientRect() -- every `.glass-panel` container
 * sets `overflow: hidden` (globals.css, for the sheen highlight), so a plain
 * `position: absolute` popover nested inside one (a lead's Kanban card, the
 * sidebar's theme-switcher button) gets clipped to zero visible height and
 * silently never appears. Portaling escapes that ancestor entirely. The
 * popover also uses a solid background rather than the shared translucent
 * `.glass-panel` tint, since a floating popover has to fully obscure
 * whatever page content happens to sit behind it, not blend with it. */
export function Dropdown({
  value, onChange, options, placeholder = "Выбрать…", disabled, style,
}: {
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function reposition() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left, width: r.width });
  }

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() { reposition(); }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={triggerRef} style={{ position: "relative", ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          padding: "10px 13px", borderRadius: 11, background: "var(--surface-04)",
          border: `1px solid ${open ? "var(--v-accent)" : "var(--color-hairline-soft)"}`,
          color: selected ? "var(--color-text)" : "var(--color-text-faint)",
          fontSize: 13, fontFamily: "var(--font-body)", cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1, textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2}
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 1000,
            maxHeight: 260, overflowY: "auto", padding: 6, borderRadius: 14,
            background: "var(--v-bg-soft)", border: "1px solid var(--glass-border-soft)",
            boxShadow: "0 24px 48px -20px rgba(0,0,0,0.6)",
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--color-text-faint)" }}>Нет вариантов</div>
          )}
          {options.map((o) => (
            <div
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              style={{
                padding: "9px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                background: o.value === value ? "var(--v-accent-tint)" : "transparent",
                color: o.value === value ? "var(--v-accent)" : "var(--color-text)",
                fontWeight: o.value === value ? 600 : 400,
              }}
              onMouseEnter={(e) => { if (o.value !== value) e.currentTarget.style.background = "var(--surface-05)"; }}
              onMouseLeave={(e) => { if (o.value !== value) e.currentTarget.style.background = "transparent"; }}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
