"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { TelegramConversation, TelegramMessage } from "@/lib/types";

/** Мастерская's live Telegram thread -- messages the client actually sent
 * to the manager's own Telegram Business account, relayed here. The bot's
 * draft reply is always a suggestion, never auto-sent: a manager can edit
 * it, send it as-is, or clear it and write their own from scratch --
 * same "review-after" posture as справка approval, never bypassed. */
export function TelegramBusinessThread({
  conversation, messages, onSent,
}: {
  conversation: TelegramConversation | null;
  messages: TelegramMessage[];
  /** Called after a successful send so the parent can refetch and pick up
   * the now-cleared draft + the new outbound message. */
  onSent: () => void;
}) {
  const [draftText, setDraftText] = useState(conversation?.draft_reply || "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // Tracks "has the manager touched this conversation's draft since we last
  // synced it" -- a new inbound message regenerating draft_reply server-side
  // must never silently overwrite text the manager is mid-typing or has
  // deliberately cleared. Only reset when switching conversations or right
  // after a confirmed send.
  const isDirtyRef = useRef(false);
  const lastConversationIdRef = useRef(conversation?.id);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conversation?.id !== lastConversationIdRef.current) {
      lastConversationIdRef.current = conversation?.id;
      isDirtyRef.current = false;
      setDraftText(conversation?.draft_reply || "");
      return;
    }
    if (!isDirtyRef.current) {
      setDraftText(conversation?.draft_reply || "");
    }
  }, [conversation?.draft_reply, conversation?.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(text: string) {
    if (!conversation || !text.trim()) return;
    setSending(true);
    setError("");
    try {
      await api.telegramSendReply(conversation.id, text.trim());
      isDirtyRef.current = false;
      onSent();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (!conversation) {
    return (
      <div className="glass-panel" style={{ padding: "16px 18px" }}>
        <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Клиент ещё не писал в Telegram.</div>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(150deg, #2AABEE, #229ED9)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="#fff"><path d="M21.94 4.53 18.6 20.2c-.25 1.12-.9 1.4-1.83.87l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.15L18.1 6.9c.4-.36-.09-.56-.63-.2L7.4 13.3l-5-1.57c-1.1-.34-1.12-1.1.23-1.63L20.6 3.5c.9-.34 1.7.2 1.34 1.03Z" /></svg>
        </span>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>Telegram</div>
      </div>

      <div ref={scrollRef} style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 280, overflowY: "auto" }}>
        {messages.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: m.direction === "inbound" ? "row" : "row-reverse" }}>
            <div style={{
              maxWidth: "76%", padding: "10px 13px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap",
              background: m.direction === "inbound" ? "rgba(255,255,255,.05)" : "var(--v-accent)",
              color: m.direction === "inbound" ? "var(--color-text)" : "var(--v-text-on-accent)",
              border: m.direction === "inbound" ? "1px solid var(--color-hairline-soft)" : "none",
              borderRadius: m.direction === "inbound" ? "4px 15px 15px 15px" : "15px 15px 4px 15px",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {messages.length === 0 && <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Переписки пока нет.</div>}
      </div>

      {error && <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--color-hairline-soft)" }}>
        <textarea
          value={draftText}
          onChange={(e) => { isDirtyRef.current = true; setDraftText(e.target.value); }}
          placeholder="Ответ клиенту…"
          rows={3}
          disabled={sending}
          aria-label="Ответ клиенту"
          style={{ width: "100%", resize: "vertical", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 10, color: "var(--color-text)", fontSize: 13, padding: "9px 12px", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="press" disabled={sending || !draftText.trim()} onClick={() => send(draftText)}
            style={{ padding: "8px 16px", borderRadius: 99, background: "var(--v-accent)", color: "var(--v-text-on-accent)", fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer", opacity: sending || !draftText.trim() ? 0.6 : 1 }}
          >
            {sending ? "Отправляю…" : "Отправить"}
          </button>
          {conversation.draft_reply && draftText === conversation.draft_reply && (
            <button
              className="press" onClick={() => { isDirtyRef.current = true; setDraftText(""); }}
              style={{ padding: "8px 16px", borderRadius: 99, background: "transparent", color: "var(--color-text-soft)", fontSize: 12.5, fontWeight: 600, border: "1px solid var(--color-hairline)", cursor: "pointer" }}
            >
              Написать своё
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
