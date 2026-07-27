"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ExcelPreviewModal } from "./ExcelPreviewModal";

type SpravkaCreatedEvent = {
  type: "spravka_created";
  request_id: string;
  unit_number: string;
  building?: string;
  real_price_per_m2_usd: number;
  summary?: { effective_total_usd: number; payment_label: string };
};
type ChatMsg = { role: "user" | "bot"; text: string; events?: SpravkaCreatedEvent[] };

/** The actual message thread + input bar, shared by the general Ассистент
 * view and a client's own profile-chat -- chat history now lives in
 * Postgres (conversations/messages), not just in this component's React
 * state, so switching conversations or refreshing the page doesn't lose it.
 * spravkaMode is a controlled prop (not owned here) because the parent's
 * "Справка" quick-action button needs to show/toggle it too. */
export function ChatThread({
  conversationId, isBoss, spravkaMode, onSpravkaCreated, greeting,
}: {
  conversationId: string;
  isBoss: boolean;
  spravkaMode: boolean;
  onSpravkaCreated?: () => void;
  greeting: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevSpravkaMode = useRef(spravkaMode);

  useEffect(() => {
    setLoaded(false);
    api.conversationMessages(conversationId).then((rows: any[]) => {
      setMessages(
        rows.length
          ? rows.map((r) => ({ role: r.role === "assistant" ? "bot" : "user", text: r.content, events: r.events || undefined }))
          : [{ role: "bot", text: greeting }]
      );
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [conversationId]);

  useEffect(() => {
    if (!prevSpravkaMode.current && spravkaMode) {
      setMessages((cur) => [...cur, {
        role: "bot",
        text: "Режим оформления справки включён. Назовите юнит, имя и телефон клиента, план оплаты — оформлю сразу.",
      }]);
    }
    prevSpravkaMode.current = spravkaMode;
  }, [spravkaMode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing]);

  async function send(text?: string) {
    const v = (text ?? input).trim();
    if (!v) return;
    setInput("");
    setMessages((cur) => [...cur, { role: "user", text: v }]);
    setTyping(true);
    try {
      const call = isBoss ? api.bossChat : api.agentChat;
      const { reply, events } = await call(v, conversationId, spravkaMode ? "spravka" : undefined);
      const created: SpravkaCreatedEvent[] = (events || []).filter((e: any) => e.type === "spravka_created");
      setMessages((cur) => [...cur, { role: "bot", text: reply, events: created.length ? created : undefined }]);
      if (created.length) onSpravkaCreated?.();
    } catch (e: any) {
      setMessages((cur) => [...cur, { role: "bot", text: `Ошибка: ${e.message}` }]);
    } finally {
      setTyping(false);
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {loaded && messages.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", flexDirection: m.role === "bot" ? "row" : "row-reverse" }}>
              {m.role === "bot" && (
                <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--v-accent)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
                    <circle cx="12" cy="12" r="3.4" />
                    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                  </svg>
                </span>
              )}
              <div style={{ maxWidth: "76%", display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    background: m.role === "bot" ? "rgba(255,255,255,.05)" : "var(--v-accent)",
                    color: m.role === "bot" ? "var(--color-text)" : "var(--v-text-on-accent)",
                    border: m.role === "bot" ? "1px solid var(--color-hairline-soft)" : "none",
                    borderRadius: m.role === "bot" ? "4px 15px 15px 15px" : "15px 15px 4px 15px",
                    padding: "12px 15px", fontSize: 13.5, lineHeight: 1.55,
                    fontWeight: m.role === "bot" ? 400 : 500,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.text}
                </div>
                {m.events?.map((ev) => (
                  <SpravkaCard key={ev.request_id} event={ev} onPreview={() => setPreviewId(ev.request_id)} />
                ))}
              </div>
            </div>
          ))}
          {typing && (
            <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--v-accent)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
                  <circle cx="12" cy="12" r="3.4" />
                  <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                </svg>
              </span>
              <div style={{ display: "flex", gap: 4, padding: "12px 15px", background: "rgba(255,255,255,.05)", border: "1px solid var(--color-hairline-soft)", borderRadius: "4px 15px 15px 15px" }}>
                {[0, 0.2, 0.4].map((d) => (
                  <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "var(--color-text-soft)", animation: `argDot 1.2s infinite ${d}s` }} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ paddingTop: 12 }}>
        <div style={{
          display: "flex", gap: 10, alignItems: "center", background: "rgba(255,255,255,.04)", borderRadius: 15,
          padding: "6px 6px 6px 16px", border: `1px solid ${spravkaMode ? "var(--v-accent)" : "var(--color-hairline)"}`,
        }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={spravkaMode ? "Юнит, имя и телефон клиента, план оплаты…" : "Спросите про юниты, условия сделки или дайте задачу…"}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--color-text)", fontSize: 13.5, padding: "9px 0" }}
          />
          <button
            onClick={() => send()}
            style={{ width: 40, height: 40, borderRadius: 12, background: "var(--v-accent)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
              <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" />
            </svg>
          </button>
        </div>
      </div>
      {previewId && <ExcelPreviewModal requestId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function SpravkaCard({ event, onPreview }: { event: SpravkaCreatedEvent; onPreview: () => void }) {
  return (
    <div className="glass-panel" style={{ padding: "14px 16px", maxWidth: 340 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--v-accent-tint)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="var(--v-accent)" strokeWidth={2.2}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
          </svg>
        </span>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>
            №{event.unit_number}{event.building ? ` · ${event.building}` : ""}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-faint)" }}>Справка создана — ждёт проверки</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--color-text-soft)", marginBottom: 12 }}>
        <span>${event.real_price_per_m2_usd}/м²</span>
        {event.summary && <span>{event.summary.payment_label.trim()}</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onPreview}
          style={{ flex: 1, padding: "8px 0", borderRadius: 99, background: "var(--v-accent-tint)", color: "var(--v-accent)", fontSize: 11.5, fontWeight: 700, border: "none", cursor: "pointer" }}
        >
          Просмотр
        </button>
        <a
          href={api.spravkaDownloadUrl(event.request_id)}
          style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 99, background: "rgba(255,255,255,.05)", border: "1px solid var(--color-hairline)", color: "var(--color-text-soft)", fontSize: 11.5, fontWeight: 700 }}
        >
          Скачать
        </a>
      </div>
    </div>
  );
}
