"use client";
import { useEffect, useState } from "react";
import { api, CurrentUser } from "@/lib/api";
import { ChatThread } from "./ChatThread";

/** "Как всё работает" -- Argus Brain Phase 4's staff-only help chatbot.
 * Opened from a topbar icon (HudToolbar.tsx), not a self-owned launcher
 * button like AssistantWidget -- so open/close state lives in the parent
 * (page.tsx), matching how GlobalSearch is already wired. Sits top-right,
 * below the toolbar, so it never overlaps AssistantWidget's bottom-right
 * floating launcher. Talks to the isolated help_chat.py endpoint (no
 * function-calling, no business data) via ChatThread's mode="help". */
export function HelpChatWidget({
  open, onClose, user,
}: {
  open: boolean;
  onClose: () => void;
  user: CurrentUser;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || conversationId) return;
    api.helpConversation().then((conv) => setConversationId(conv.id)).catch(() => {});
  }, [open, conversationId]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="glass-panel section-enter"
      style={{
        position: "fixed", top: 64, right: 16, width: 360, height: 480, zIndex: 500,
        display: "flex", flexDirection: "column", padding: "16px 18px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--v-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2} strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 1.8-2 3.3" /><path d="M12 17h.01" />
            </svg>
          </span>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 800, color: "var(--color-text)" }}>Как всё работает</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Закрыть помощь"
          className="press"
          style={{ cursor: "pointer", color: "var(--color-text-faint)", padding: 4, background: "transparent", border: "none" }}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {conversationId ? (
          <ChatThread
            conversationId={conversationId}
            isBoss={user.role === "boss"}
            spravkaMode={false}
            greeting="Спросите, как пользоваться любым разделом Argus — Юниты, Лиды, Справки, Календарь и так далее."
            mode="help"
          />
        ) : (
          <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка…</div>
        )}
      </div>
    </div>
  );
}
