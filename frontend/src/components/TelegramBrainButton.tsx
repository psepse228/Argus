"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";

/** Proactive Argus Brain over Telegram (2026-08-08) -- a topbar icon +
 * popover, same portal pattern as HudToolbar's theme/role popovers (kept
 * as its own file since the connect/send flow has real async state, unlike
 * those two). Connect once via a deep link to the bot's own personal chat
 * (unrelated to the client-facing Telegram Business integration), then
 * "Отправить сейчас" fires the exact same greeting voice already used
 * in-app -- the reliable, on-demand path, not dependent on a schedule. */
export function TelegramBrainButton() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [linkInfo, setLinkInfo] = useState<{ code: string; deep_link: string } | null>(null);
  const [linking, setLinking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");
  const [error, setError] = useState("");

  function reposition() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left + r.width / 2, top: r.bottom + 8 });
  }
  useLayoutEffect(() => { if (open) reposition(); }, [open]);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSendResult("");
    api.telegramBrainStatus().then((s) => setConnected(s.connected)).catch(() => setError("Не удалось проверить статус"));
  }, [open]);

  async function connect() {
    setLinking(true);
    setError("");
    try {
      setLinkInfo(await api.telegramBrainLinkCode());
    } catch (e: any) {
      setError(`Не удалось получить ссылку: ${e.message}`);
    } finally {
      setLinking(false);
    }
  }

  async function sendNow() {
    setSending(true);
    setError("");
    setSendResult("");
    try {
      const res = await api.telegramBrainSendNow();
      setSendResult(res.text);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Argus Brain в Telegram"
        aria-label="Argus Brain в Telegram"
        className="press"
        style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--color-hairline-soft)", background: "var(--surface-03)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="var(--color-text-soft)" strokeWidth={2}>
          <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="glass-panel"
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)", padding: 14, zIndex: 1000, width: 260 }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--color-text)", marginBottom: 8 }}>Argus Brain в Telegram</div>
          {connected === null && !error && <div style={{ fontSize: 12, color: "var(--color-text-faint)" }}>Проверяю…</div>}
          {connected === false && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>
                Подключите личный чат с ботом — Argus сможет писать вам напрямую в Telegram.
              </div>
              {!linkInfo ? (
                <button
                  onClick={connect} disabled={linking} className="press"
                  style={{ fontSize: 12, fontWeight: 700, color: "var(--v-text-on-accent)", background: "var(--v-accent)", border: "none", borderRadius: 99, padding: "8px 14px", cursor: "pointer" }}
                >
                  {linking ? "…" : "Подключить"}
                </button>
              ) : (
                <>
                  <a
                    href={linkInfo.deep_link} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, fontWeight: 700, color: "var(--v-text-on-accent)", background: "var(--v-accent)", borderRadius: 99, padding: "8px 14px", textAlign: "center", textDecoration: "none" }}
                  >
                    Открыть в Telegram
                  </a>
                  <div style={{ fontSize: 10.5, color: "var(--color-text-faint)" }}>
                    Если ссылка не открылась — напишите боту @{"Argus_solurabot"} команду:
                    <br /><code style={{ color: "var(--v-accent)" }}>/start {linkInfo.code}</code>
                  </div>
                </>
              )}
            </div>
          )}
          {connected === true && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11.5, color: "var(--success)", fontWeight: 700 }}>Подключено ✓</div>
              <button
                onClick={sendNow} disabled={sending} className="press"
                style={{ fontSize: 12, fontWeight: 700, color: "var(--v-text-on-accent)", background: "var(--v-accent)", border: "none", borderRadius: 99, padding: "8px 14px", cursor: "pointer" }}
              >
                {sending ? "Отправляю…" : "Отправить сейчас"}
              </button>
              {sendResult && (
                <div style={{ fontSize: 11, color: "var(--color-text-soft)", background: "var(--surface-04)", borderRadius: 8, padding: "8px 10px" }}>
                  Отправлено: «{sendResult}»
                </div>
              )}
            </div>
          )}
          {error && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 8 }}>{error}</div>}
        </div>,
        document.body
      )}
    </div>
  );
}
