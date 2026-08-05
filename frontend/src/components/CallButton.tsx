"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";

/** Replaces four near-identical `<a href="tel:...">` anchors (Лиды,
 * Клиенты card, Клиенты detail, Юниты detail) with one shared component --
 * same tel: link behavior, plus a small popover to log what happened
 * (взял/не взял/отложил), since Argus has no telephony integration and
 * can't detect this automatically (Day 5 decision: click-to-call stays a
 * plain link). Pass whichever id is in scope -- lead_id, client_id, or
 * both; at least one should be set for the log to be useful, but this
 * component doesn't enforce that, the backend does.
 *
 * The outcome popover is portaled to document.body and positioned via the
 * trigger's real getBoundingClientRect() -- every `.glass-panel` container
 * sets `overflow: hidden` (globals.css, for the sheen highlight), so a plain
 * `position: absolute` popover nested inside one (a lead's Kanban card, the
 * Клиенты card) gets clipped to zero visible height and silently never
 * appears. Portaling escapes that ancestor entirely. */
export function CallButton({
  phone, size = 20, leadId, clientId,
}: {
  phone: string; size?: number; leadId?: string; clientId?: string;
}) {
  const POPOVER_WIDTH = 170;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function reposition() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 12);
      setPos({ top: r.bottom + 6, left: Math.max(8, left) });
    }
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
    if (open) {
      document.addEventListener("mousedown", onDocClick);
      document.addEventListener("keydown", onEsc);
    }
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function logOutcome(outcome: "answered" | "no_answer" | "postponed") {
    setLogging(true);
    try {
      await api.logCallOutcome({ outcome, lead_id: leadId, client_id: clientId });
      setLogged(true);
      setTimeout(() => { setOpen(false); setLogged(false); }, 1200);
    } catch {
      /* best-effort -- the call itself already happened regardless of whether logging succeeds */
    } finally {
      setLogging(false);
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <a
        ref={triggerRef}
        href={`tel:${phone}`}
        title="Позвонить"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="press"
        style={{
          width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--success-tint)", color: "var(--success)", flexShrink: 0,
        }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="none" stroke="currentColor" strokeWidth={2.3}>
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
        </svg>
      </a>
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: POPOVER_WIDTH, zIndex: 1000,
            padding: "10px 12px", borderRadius: 14, background: "var(--v-bg-soft)",
            border: "1px solid var(--glass-border-soft)", boxShadow: "0 24px 48px -20px rgba(0,0,0,0.6)",
            display: "flex", flexDirection: "column", gap: 6,
          }}
        >
          {logged ? (
            <div style={{ fontSize: 11.5, color: "var(--success)", fontWeight: 700, textAlign: "center" }}>Записано ✓</div>
          ) : (
            <>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--color-text-faint)" }}>
                Как прошёл звонок?
              </div>
              <button
                disabled={logging} onClick={() => logOutcome("answered")}
                style={{
                  fontSize: 12, fontWeight: 600, color: "var(--success)", background: "var(--success-tint)",
                  border: "none", borderRadius: 8, padding: "6px 10px", cursor: logging ? "not-allowed" : "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => { if (!logging) e.currentTarget.style.background = "var(--surface-05)"; }}
                onMouseLeave={(e) => { if (!logging) e.currentTarget.style.background = "var(--success-tint)"; }}
              >
                Взял трубку
              </button>
              <button
                disabled={logging} onClick={() => logOutcome("no_answer")}
                style={{
                  fontSize: 12, fontWeight: 600, color: "var(--danger)", background: "var(--danger-tint)",
                  border: "none", borderRadius: 8, padding: "6px 10px", cursor: logging ? "not-allowed" : "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => { if (!logging) e.currentTarget.style.background = "var(--surface-05)"; }}
                onMouseLeave={(e) => { if (!logging) e.currentTarget.style.background = "var(--danger-tint)"; }}
              >
                Не взял
              </button>
              <button
                disabled={logging} onClick={() => logOutcome("postponed")}
                style={{
                  fontSize: 12, fontWeight: 600, color: "var(--color-text-soft)", background: "var(--surface-05)",
                  border: "none", borderRadius: 8, padding: "6px 10px", cursor: logging ? "not-allowed" : "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => { if (!logging) e.currentTarget.style.background = "var(--v-bg-soft)"; }}
                onMouseLeave={(e) => { if (!logging) e.currentTarget.style.background = "var(--surface-05)"; }}
              >
                Отложил
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  fontSize: 10.5, color: "var(--color-text-faint)", background: "none", border: "none",
                  cursor: "pointer", textAlign: "left", padding: "6px 10px", marginTop: 2,
                  borderTop: "1px solid var(--color-hairline-soft)",
                }}
              >
                Закрыть
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
