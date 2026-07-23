"use client";
import { useEffect, useRef, useState } from "react";
import { api, CurrentUser } from "@/lib/api";

type ChatMsg = { role: "user" | "bot"; text: string };

export function AssistantPanel({ user }: { user: CurrentUser }) {
  const isBoss = user.role === "boss";
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "bot",
      text: isBoss
        ? "Доброе утро. Я слежу за юнитами, лидами и справками Italiano Vero. Спросите что угодно."
        : "Привет! Помогу подобрать юниты, оформить справку, согласовать условия и разобрать лидов.",
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing]);

  const suggestions = isBoss
    ? ["Что ждёт одобрения?", "Сводка по Milano", "Средний дисконт?", "Поставь цену для плана"]
    : ["Разбери моих лидов", "Подбери юниты в Milano", "Составь письмо клиенту"];

  async function send(text?: string) {
    const v = (text ?? input).trim();
    if (!v) return;
    setInput("");
    const nextMessages: ChatMsg[] = [...messages, { role: "user", text: v }];
    setMessages(nextMessages);
    setTyping(true);
    try {
      const history = nextMessages.map((m) => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }));
      const call = isBoss ? api.bossChat : api.agentChat;
      const { reply } = await call(v, history.slice(0, -1));
      setMessages((cur) => [...cur, { role: "bot", text: reply }]);
    } catch (e: any) {
      setMessages((cur) => [...cur, { role: "bot", text: `Ошибка: ${e.message}` }]);
    } finally {
      setTyping(false);
    }
  }

  return (
    <div className="glass-panel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "26px 24px 8px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", flexDirection: m.role === "bot" ? "row" : "row-reverse" }}>
              {m.role === "bot" && (
                <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--v-accent)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
                    <circle cx="12" cy="12" r="3.4" />
                    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                  </svg>
                </span>
              )}
              <div
                style={{
                  maxWidth: "76%",
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

      <div style={{ padding: "12px 24px 18px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 11 }}>
            {suggestions.map((s) => (
              <div
                key={s}
                onClick={() => send(s)}
                style={{ fontSize: 12, color: "var(--color-text-soft)", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline-soft)", borderRadius: 99, padding: "7px 13px", cursor: "pointer" }}
              >
                {s}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 15, padding: "6px 6px 6px 16px" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Спросите про юниты, условия сделки или дайте задачу…"
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
      </div>
    </div>
  );
}
