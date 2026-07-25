"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  pendingItems: SpravkaRequest[];
  recent: SpravkaRequest[];
  approvedTotal?: number;
  avgDiscount?: number;
  leadsCount: number;
  buildingStats: { name: string; forSale: number; price: number }[];
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
  const [bellOpen, setBellOpen] = useState(false);
  const [bellPos, setBellPos] = useState<{ top: number; right: number } | null>(null);
  const bellBtnRef = useRef<HTMLDivElement>(null);
  const bellPopoverRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function repositionBell() {
    const r = bellBtnRef.current?.getBoundingClientRect();
    if (r) setBellPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }

  useLayoutEffect(() => {
    if (bellOpen) repositionBell();
  }, [bellOpen]);

  useEffect(() => {
    if (!bellOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (bellBtnRef.current?.contains(t)) return;
      if (bellPopoverRef.current?.contains(t)) return;
      setBellOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setBellOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [bellOpen]);

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
        const [requests, leads, buildings, units]: [SpravkaRequest[], any[], any[], any[]] = await Promise.all([
          api.spravkaRequests(), api.leads(), api.buildings(), api.units(),
        ]);
        const pending = requests.filter((r) => r.status === "pending");
        const recent = [...requests]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 4);
        // real per-building snapshot (count for_sale + lowest real price/m2) --
        // no fabricated trend line, since there's no price-history table to back one
        const buildingStats = buildings.slice(0, 3).map((b: any) => {
          const inBuilding = units.filter((u: any) => u.building_id === b.id && u.status === "for_sale");
          const price = inBuilding.length ? Math.min(...inBuilding.map((u: any) => u.price_per_m2_usd)) : 0;
          return { name: b.name, forSale: inBuilding.length, price };
        });
        if (isBoss) {
          const summary = await api.analyticsSummary();
          setDigest({
            pending: pending.length, pendingItems: pending, recent, leadsCount: leads.length, buildingStats,
            approvedTotal: summary.spravka_requests_approved,
            avgDiscount: summary.average_approved_discount_pct,
          });
        } else {
          setDigest({ pending: pending.length, pendingItems: pending, recent, leadsCount: leads.length, buildingStats });
        }
      } catch {
        /* best-effort — chat still works without the digest */
      }
    })();
  }, [isBoss]);

  const quickActions = isBoss
    ? [
        { label: "Одобрения", prompt: "Что ждёт одобрения?", icon: <path d="M9 12l2 2 4-4M12 3l1.8 4.3L18 9l-4.2 1.7L12 15l-1.8-4.3L6 9l4.2-1.7L12 3Z" /> },
        { label: "Сводка", prompt: "Сводка по Milano", icon: <><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></> },
        { label: "Дисконт", prompt: "Средний дисконт?", icon: <><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="1.7" /><circle cx="16.5" cy="16.5" r="1.7" /></> },
      ]
    : [
        { label: "Юниты в Milano", prompt: "Подбери юниты в Milano", icon: <><path d="M3 21V9l9-5 9 5v12" /><path d="M9 21v-7h6v7" /></> },
        { label: "Письмо клиенту", prompt: "Составь письмо клиенту", icon: <><path d="M4 4h16v16H4z" /><path d="M4 4l8 8 8-8" /></> },
      ];

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
              surface, not one more section under generic chrome. Avatar +
              greeting + bell, quick-action circles, and a card row are the
              actual structure the owner referenced (a real fintech app),
              not a re-colored version of the old text-header + list card. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <div
                title={`${user.email} · ${isBoss ? "Босс" : "Агент"}`}
                style={{
                  width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                  background: "linear-gradient(150deg, var(--v-violet-strong, #7a5cff), var(--v-violet, #5b3fc4))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: 15, color: "#fff",
                  boxShadow: "0 10px 22px -8px color-mix(in srgb, var(--v-violet-strong, #7a5cff) 55%, transparent)",
                }}
              >
                {isBoss ? "Б" : "А"}
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 800, letterSpacing: "-0.015em", color: "var(--color-text)" }}>
                  {isBoss ? "Доброе утро" : "Привет!"}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 3 }}>
                  Italiano Vero — Milano · Roma · Neapol · Venice · Florencia
                </div>
              </div>
            </div>
            <div
              ref={bellBtnRef}
              role="button" tabIndex={0} aria-label="Уведомления"
              onClick={() => setBellOpen((v) => !v)}
              style={{
                width: 42, height: 42, borderRadius: "50%", flexShrink: 0, position: "relative", cursor: "pointer",
                background: "rgba(255,255,255,.05)", border: "1px solid var(--color-hairline)",
                display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-soft)",
              }}
            >
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.9}>
                <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 21a2 2 0 0 0 4 0" />
              </svg>
              {digest && digest.pending > 0 && (
                <span style={{
                  position: "absolute", top: 7, right: 8, width: 7, height: 7, borderRadius: "50%",
                  background: "var(--v-accent)", boxShadow: "0 0 0 2.5px var(--v-bg, #140a2c)",
                }} />
              )}
            </div>
            {/* Portaled -- this header sits inside the panel's own
                .glass-panel (overflow: hidden), so a plain absolutely
                positioned popover here would get clipped the same way the
                lead-card dropdowns were. */}
            {bellOpen && bellPos && createPortal(
              <div
                ref={bellPopoverRef}
                className="glass-panel"
                style={{ position: "fixed", top: bellPos.top, right: bellPos.right, width: 280, padding: "14px 16px", zIndex: 1000 }}
              >
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
                  Ждут одобрения
                </div>
                {!digest || digest.pendingItems.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пусто — всё разобрано.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {digest.pendingItems.slice(0, 6).map((r) => (
                      <div key={r.id} style={{ fontSize: 12.5, color: "var(--color-text-soft)" }}>
                        {r.units ? <>№{r.units.unit_number} · {r.units.buildings?.name}</> : "—"} — {r.client_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>,
              document.body
            )}
          </div>

          <div style={{ display: "flex", gap: 22 }}>
            <QuickAction
              primary active={spravkaMode} label={spravkaMode ? "Режим включён" : "Справка"}
              onClick={toggleSpravkaMode}
              icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h4" /></>}
            />
            {quickActions.map((q) => (
              <QuickAction key={q.label} label={q.label} onClick={() => send(q.prompt)} icon={q.icon} />
            ))}
          </div>

          {digest && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="glass-panel" style={{ padding: "20px 22px" }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 5 }}>Лиды</div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-soft)", lineHeight: 1.6 }}>
                  {digest.leadsCount > 0
                    ? `${digest.leadsCount} лидов в воронке — от новых до готовых к брони.`
                    : "Пока нет лидов в базе."}
                </div>
                <div style={{
                  display: "inline-flex", fontSize: 11.5, fontWeight: 700, color: "var(--v-accent)",
                  background: "var(--v-accent-tint)", padding: "6px 13px", borderRadius: 99, marginTop: 14,
                }}>
                  {digest.leadsCount} в работе
                </div>
              </div>
              <div style={{
                padding: "20px 22px", borderRadius: 22, color: "#fff",
                background: "linear-gradient(155deg, var(--v-violet-strong, #7a5cff), var(--v-violet, #5b3fc4) 75%)",
              }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 5 }}>Справки</div>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.78)", lineHeight: 1.6 }}>
                  {digest.pending > 0
                    ? `${digest.pending} ждут вашего решения. Всё остальное — под контролем.`
                    : "Всё разобрано — очередь пуста."}
                </div>
                <div
                  onClick={() => send(isBoss ? "Что ждёт одобрения?" : "Начать работу над справкой")}
                  style={{
                    display: "inline-flex", fontSize: 11.5, fontWeight: 700, color: "#fff", cursor: "pointer",
                    background: "rgba(255,255,255,.16)", padding: "6px 13px", borderRadius: 99, marginTop: 14,
                  }}
                >
                  {isBoss ? "Открыть очередь →" : "Оформить →"}
                </div>
              </div>
            </div>
          )}

          {digest && digest.buildingStats.some((b) => b.forSale > 0) && (
            <div className="glass-panel" style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Юниты — быстрый обзор</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--v-accent)" }}>153 всего</span>
              </div>
              {digest.buildingStats.map((b) => (
                <div key={b.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--color-hairline-soft)" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{b.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>{b.forSale} юнитов в продаже</div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>
                    {b.forSale > 0 ? `от $${b.price.toLocaleString()}/м²` : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {digest && digest.recent.length > 0 && (
            <div className="glass-panel" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
                Последние справки
              </div>
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

function QuickAction({
  label, onClick, icon, primary,
}: { label: string; onClick: () => void; icon: React.ReactNode; primary?: boolean; active?: boolean }) {
  const isFilled = Boolean(primary);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, cursor: "pointer" }} onClick={onClick}>
      <div
        style={{
          width: 52, height: 52, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          background: isFilled ? "var(--v-accent)" : "rgba(255,255,255,.05)",
          border: isFilled ? "none" : "1px solid var(--color-hairline)",
          color: isFilled ? "var(--v-text-on-accent)" : "var(--color-text-soft)",
          boxShadow: isFilled ? "0 14px 26px -10px color-mix(in srgb, var(--v-accent) 55%, transparent)" : "none",
        }}
      >
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.9}>{icon}</svg>
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 650, color: "var(--color-text-soft)", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}
