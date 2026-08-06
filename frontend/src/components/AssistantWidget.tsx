"use client";
import { useEffect, useState } from "react";
import { api, CurrentUser } from "@/lib/api";
import { ChatThread } from "./ChatThread";

/** Floating mini-assistant, reachable from every section except Ассистент
 * itself (where the full inbox is already the whole screen) -- same pattern
 * as Cortège's launcher. Shares real conversations with the main Ассистент
 * inbox (picks up the most recent one, or starts one), so a message sent
 * here shows up there too instead of forking a separate hidden history. */
export function AssistantWidget({
  user, forceClose, onOpen,
}: {
  user: CurrentUser;
  /** Bumped by the parent (page.tsx) whenever another floating panel (e.g.
   * HelpChatWidget) opens, so the two never visibly overlap -- see
   * HelpChatWidget.tsx for the mirror image of this (parent-controlled open). */
  forceClose?: number;
  /** Fired when this widget's launcher opens it, so the parent can close any
   * other floating panel (HelpChatWidget) in turn. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [dynamicGreeting, setDynamicGreeting] = useState<string | null>(null);

  useEffect(() => {
    if (forceClose) setOpen(false);
  }, [forceClose]);

  useEffect(() => {
    if (!open || conversationId) return;
    (async () => {
      const list = await api.conversations().catch(() => []);
      if (list.length) {
        setConversationId(list[0].id);
      } else {
        const created = await api.createConversation();
        setConversationId(created.id);
      }
    })();
  }, [open, conversationId]);

  useEffect(() => {
    if (!open || dynamicGreeting) return;
    api.brainGreeting().then((g) => setDynamicGreeting(g.text)).catch(() => {});
  }, [open, dynamicGreeting]);

  const staticGreeting = user.role === "boss"
    ? "Доброе утро. Я слежу за юнитами, лидами и справками Italiano Vero. Спросите что угодно."
    : "Привет! Помогу подобрать юниты, оформить справку, согласовать условия и разобрать лидов.";
  const greeting = dynamicGreeting || staticGreeting;

  return (
    <>
      {open && (
        <div
          className="glass-panel section-enter"
          style={{
            position: "fixed", bottom: 92, right: 24, width: 360, height: 480, zIndex: 500,
            display: "flex", flexDirection: "column", padding: "16px 18px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--v-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
                  <path d="M12 3l1.8 4.3L18 9l-4.2 1.7L12 15l-1.8-4.3L6 9l4.2-1.7L12 3Z" />
                </svg>
              </span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 800, color: "var(--color-text)" }}>Ассистент</span>
            </div>
            <div onClick={() => setOpen(false)} style={{ cursor: "pointer", color: "var(--color-text-faint)", padding: 4 }}>
              <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M6 6l12 12M18 6 6 18" /></svg>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {conversationId ? (
              <ChatThread conversationId={conversationId} isBoss={user.role === "boss"} spravkaMode={false} greeting={greeting} />
            ) : (
              <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка…</div>
            )}
          </div>
        </div>
      )}
      <div
        onClick={() => setOpen((v) => {
          const next = !v;
          if (next) onOpen?.();
          return next;
        })}
        role="button" aria-label="Ассистент"
        className="press"
        style={{
          position: "fixed", bottom: 24, right: 24, width: 56, height: 56, borderRadius: "50%", zIndex: 500, cursor: "pointer",
          background: "var(--v-accent)", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 16px 32px -10px color-mix(in srgb, var(--v-accent) 60%, transparent)",
        }}
      >
        <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2}>
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : (
            <><path d="M12 3l1.8 4.3L18 9l-4.2 1.7L12 15l-1.8-4.3L6 9l4.2-1.7L12 3Z" /><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>
          )}
        </svg>
      </div>
    </>
  );
}
