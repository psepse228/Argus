"use client";
import { useEffect, useRef, useState } from "react";

export type DropdownOption = { value: string; label: string };

/** Custom-styled dropdown replacing the native <select> -- a native select's
 * open list is always rendered by the OS/browser chrome (white background,
 * system font) no matter what CSS is applied to the closed control, which is
 * exactly the mismatch flagged live: a white Windows dropdown list sitting
 * inside an otherwise dark glassmorphic app. This renders its own list. */
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
    <div ref={ref} style={{ position: "relative", ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          padding: "10px 13px", borderRadius: 11, background: "rgba(255,255,255,.04)",
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
      {open && (
        <div
          className="glass-panel"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 40,
            maxHeight: 260, overflowY: "auto", padding: 6,
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
              onMouseEnter={(e) => { if (o.value !== value) e.currentTarget.style.background = "rgba(255,255,255,.05)"; }}
              onMouseLeave={(e) => { if (o.value !== value) e.currentTarget.style.background = "transparent"; }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
