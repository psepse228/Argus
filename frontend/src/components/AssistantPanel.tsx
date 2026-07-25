"use client";
import { useEffect, useRef, useState } from "react";
import { api, CurrentUser } from "@/lib/api";
import { SpravkaRequest, STATUS_LABELS } from "@/lib/types";
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

type Digest = {
  pending: number;
  recent: SpravkaRequest[];
  approvedTotal?: number;
  avgDiscount?: number;
};

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
  const [digest, setDigest] = useState<Digest | null>(null);
  const [spravkaMode, setSpravkaMode] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing]);

  // "What happened while you were away" — real data, not filler. Boss sees
  // the tenant-wide pending queue + approved/discount stats already used in
  // Аналитика; a sales agent sees only their own requests (the list
  // endpoint already scopes non-boss users to requested_by == their email).
  useEffect(() => {
    (async () => {
      try {
        const requests: SpravkaRequest[] = await api.spravkaRequests();
        const pending = requests.filter((r) => r.status === "pending");
        const recent = [...requests]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 4);
        if (isBoss) {
          const summary = await api.analyticsSummary();
          setDigest({
            pending: pending.length, recent,
            approvedTotal: summary.spravka_requests_approved,
            avgDiscount: summary.average_approved_discount_pct,
          });
        } else {
          setDigest({ pending: pending.length, recent });
        }
      } catch {
        /* best-effort — chat still works without the digest */
      }
    })();
  }, [isBoss]);

  const suggestions = isBoss
    ? ["Что ждёт одобрения?", "Сводка по Milano", "Средний дисконт?", "Поставь цену для плана"]
    : ["Подбери юниты в Milano", "Составь письмо клиенту"];

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
      const { reply, events } = await call(v, history.slice(0, -1), spravkaMode ? "spravka" : undefined);
      const created: SpravkaCreatedEvent[] = (events || []).filter((e: any) => e.type === "spravka_created");
      setMessages((cur) => [...cur, { role: "bot", text: reply, events: created.length ? created : undefined }]);
      // task the button was for is done -- drop back to normal chat rather
      // than staying narrowed to spravka-only topics for the rest of the session
      if (created.length) setSpravkaMode(false);
    } catch (e: any) {
      setMessages((cur) => [...cur, { role: "bot", text: `Ошибка: ${e.message}` }]);
    } finally {
      setTyping(false);
    }
  }

  function toggleSpravkaMode() {
    setSpravkaMode((cur) => {
      const next = !cur;
      if (next) {
        setMessages((m) => [...m, {
          role: "bot",
          text: "Режим оформления справки включён. Назовите юнит, имя и телефон клиента, план оплаты — оформлю сразу.",
        }]);
      }
      return next;
    });
  }

  return (
    <div className="glass-panel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "26px 24px 8px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Own identity, deliberately distinct from the compact utility
              header every data page gets -- this is the platform's primary
              surface, not one more section under generic chrome. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 }}>
            <div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--color-text)", lineHeight: 1.05 }}>
                Ассистент
              </div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-faint)", marginTop: 4 }}>
                Italiano Vero — Milano · Roma · Neapol · Venice · Florencia
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", textAlign: "right", flexShrink: 0 }}>
              {user.email}<br />{isBoss ? "Босс" : "Агент"}
            </div>
          </div>
          {digest && (digest.pending > 0 || digest.recent.length > 0) && (
            <div className="glass-panel" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 12 }}>
                Пока вас не было
              </div>
              <div style={{ display: "flex", gap: 20, marginBottom: digest.recent.length ? 14 : 0, flexWrap: "wrap" }}>
                <DigestStat value={digest.pending} label="ждут одобрения" accent={digest.pending > 0} />
                {isBoss && digest.approvedTotal !== undefined && (
                  <DigestStat value={digest.approvedTotal} label="одобрено всего" />
                )}
                {isBoss && digest.avgDiscount !== undefined && (
                  <DigestStat value={`${digest.avgDiscount}%`} label="средний дисконт" />
                )}
              </div>
              {digest.recent.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {digest.recent.map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--color-text-soft)" }}>
                      <span>
                        {r.units ? <>№{r.units.unit_number} · {r.units.buildings?.name}</> : "—"} — {r.client_name}
                      </span>
                      <span style={{ color: "var(--color-text-faint)" }}>{STATUS_LABELS[r.status] || r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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

      <div style={{ padding: "12px 24px 18px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 11, alignItems: "center" }}>
            {/* Dedicated, visually distinct entry point into Справка creation --
                not blended in with the generic suggestion chips, so it reads as
                a mode switch rather than a canned question. */}
            <button
              onClick={toggleSpravkaMode}
              style={{
                display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700,
                color: spravkaMode ? "var(--v-text-on-accent)" : "var(--v-accent)",
                background: spravkaMode ? "var(--v-accent)" : "var(--v-accent-tint)",
                border: "1px solid transparent", borderRadius: 99, padding: "7px 14px 7px 11px", cursor: "pointer",
              }}
            >
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h3" />
              </svg>
              {spravkaMode ? "Режим справки — выкл" : "Оформить справку"}
            </button>
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

function DigestStat({ value, label, accent }: { value: number | string; label: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ? "var(--v-accent)" : "var(--color-text)" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>{label}</div>
    </div>
  );
}
