"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, CurrentUser } from "@/lib/api";
import { SpravkaRequest, STATUS_LABELS, Conversation } from "@/lib/types";
import { ChatThread } from "./ChatThread";

type Digest = {
  pending: number;
  pendingItems: SpravkaRequest[];
  recent: SpravkaRequest[];
  approvedTotal?: number;
  avgDiscount?: number;
  leadsCount: number;
  buildingStats: { name: string; forSale: number; price: number }[];
};

function conversationLabel(c: Conversation): string {
  if (c.title) return c.title;
  const d = new Date(c.created_at);
  return `Чат — ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

export function AssistantPanel({ user }: { user: CurrentUser }) {
  const isBoss = user.role === "boss";
  const [digest, setDigest] = useState<Digest | null>(null);
  const [spravkaMode, setSpravkaMode] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [bellPos, setBellPos] = useState<{ top: number; right: number } | null>(null);
  const bellBtnRef = useRef<HTMLDivElement>(null);
  const bellPopoverRef = useRef<HTMLDivElement>(null);
  const [quickPanel, setQuickPanel] = useState<{ key: string; top: number; left: number } | null>(null);
  const quickPanelRef = useRef<HTMLDivElement>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [convOpen, setConvOpen] = useState(false);
  const [convPos, setConvPos] = useState<{ top: number; right: number } | null>(null);
  const convBtnRef = useRef<HTMLDivElement>(null);
  const convPopoverRef = useRef<HTMLDivElement>(null);

  // Chats used to live only in React state (gone on refresh, only one
  // thread ever). Now persisted -- load the user's existing threads and
  // pick up the most recent one, or start a fresh one if they have none.
  useEffect(() => {
    (async () => {
      try {
        const list: Conversation[] = await api.conversations();
        setConversations(list);
        if (list.length) {
          setActiveConvId(list[0].id);
        } else {
          const created = await api.createConversation();
          setConversations([created]);
          setActiveConvId(created.id);
        }
      } catch {
        /* chat still renders once a conversation exists; surfaced via ChatThread's own error handling */
      }
    })();
  }, []);

  async function startNewChat() {
    const created = await api.createConversation();
    setConversations((cur) => [created, ...cur]);
    setActiveConvId(created.id);
    setConvOpen(false);
  }

  function switchChat(id: string) {
    setActiveConvId(id);
    setConvOpen(false);
  }

  useEffect(() => {
    if (!quickPanel) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (quickPanelRef.current?.contains(t)) return;
      if (t.closest?.("[data-quick-trigger]")) return;
      setQuickPanel(null);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setQuickPanel(null); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [quickPanel]);

  function repositionBell() {
    const r = bellBtnRef.current?.getBoundingClientRect();
    if (r) setBellPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }
  useLayoutEffect(() => { if (bellOpen) repositionBell(); }, [bellOpen]);
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

  function repositionConv() {
    const r = convBtnRef.current?.getBoundingClientRect();
    if (r) setConvPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }
  useLayoutEffect(() => { if (convOpen) repositionConv(); }, [convOpen]);
  useEffect(() => {
    if (!convOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (convBtnRef.current?.contains(t)) return;
      if (convPopoverRef.current?.contains(t)) return;
      setConvOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setConvOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [convOpen]);

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
        { label: "Одобрения", panel: "approvals" as const, icon: <path d="M9 12l2 2 4-4M12 3l1.8 4.3L18 9l-4.2 1.7L12 15l-1.8-4.3L6 9l4.2-1.7L12 3Z" /> },
        { label: "Сводка", panel: "summary" as const, icon: <><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></> },
        { label: "Дисконт", panel: "discount" as const, icon: <><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="1.7" /><circle cx="16.5" cy="16.5" r="1.7" /></> },
      ]
    : [
        { label: "Юниты в Milano", prompt: "Подбери юниты в Milano", icon: <><path d="M3 21V9l9-5 9 5v12" /><path d="M9 21v-7h6v7" /></> },
        { label: "Письмо клиенту", prompt: "Составь письмо клиенту", icon: <><path d="M4 4h16v16H4z" /><path d="M4 4l8 8 8-8" /></> },
      ];

  function openQuickPanel(key: string, e: React.MouseEvent<HTMLDivElement>) {
    if (quickPanel?.key === key) { setQuickPanel(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setQuickPanel({ key, top: r.bottom + 8, left: r.left + r.width / 2 });
  }

  const greeting = isBoss
    ? "Доброе утро. Я слежу за юнитами, лидами и справками Italiano Vero. Спросите что угодно."
    : "Привет! Помогу подобрать юниты, оформить справку, согласовать условия и разобрать лидов.";

  return (
    <div className="glass-panel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div style={{ overflowY: "auto", flexShrink: 0, maxHeight: "56%", padding: "26px 24px 14px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
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
            <div style={{ display: "flex", gap: 8 }}>
              <div
                ref={convBtnRef}
                role="button" tabIndex={0} aria-label="Чаты"
                onClick={() => setConvOpen((v) => !v)}
                style={{
                  width: 42, height: 42, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
                  background: "rgba(255,255,255,.05)", border: "1px solid var(--color-hairline)",
                  display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-soft)",
                }}
              >
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.9}>
                  <path d="M4 4h16v12H8l-4 4V4Z" />
                </svg>
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
            </div>
            {convOpen && convPos && createPortal(
              <div
                ref={convPopoverRef}
                className="glass-panel"
                style={{ position: "fixed", top: convPos.top, right: convPos.right, width: 260, padding: "10px", zIndex: 1000 }}
              >
                <div
                  onClick={startNewChat}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--v-accent)", padding: "9px 10px", borderRadius: 9, cursor: "pointer" }}
                >
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M12 5v14M5 12h14" /></svg>
                  Новый чат
                </div>
                <div style={{ height: 1, background: "var(--color-hairline-soft)", margin: "6px 0" }} />
                {conversations.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--color-text-faint)", padding: "6px 10px" }}>Нет чатов</div>
                ) : conversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => switchChat(c.id)}
                    style={{
                      fontSize: 12.5, padding: "9px 10px", borderRadius: 9, cursor: "pointer",
                      background: c.id === activeConvId ? "var(--v-accent-tint)" : "transparent",
                      color: c.id === activeConvId ? "var(--v-accent)" : "var(--color-text-soft)",
                      fontWeight: c.id === activeConvId ? 700 : 500,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {conversationLabel(c)}
                  </div>
                ))}
              </div>,
              document.body
            )}
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
              onClick={() => setSpravkaMode((v) => !v)}
              icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h4" /></>}
            />
            {quickActions.map((q) => (
              <QuickAction
                key={q.label} label={q.label} icon={q.icon}
                onClick={(e) => ("panel" in q ? openQuickPanel(q.panel, e) : undefined)}
              />
            ))}
          </div>

          {quickPanel && createPortal(
            <div
              ref={quickPanelRef}
              className="glass-panel"
              style={{ position: "fixed", top: quickPanel.top, left: quickPanel.left, transform: "translateX(-50%)", width: 300, padding: "16px 18px", zIndex: 1000 }}
            >
              {quickPanel.key === "approvals" && (
                <>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
                    Ждут одобрения
                  </div>
                  {!digest || digest.pendingItems.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пусто — всё разобрано.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {digest.pendingItems.map((r) => (
                        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, color: "var(--color-text-soft)" }}>
                          <span>{r.units ? <>№{r.units.unit_number} · {r.units.buildings?.name}</> : "—"} — {r.client_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {quickPanel.key === "summary" && digest && (
                <>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
                    Сводка
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: "var(--color-text-soft)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Лидов в работе</span><b style={{ color: "var(--color-text)" }}>{digest.leadsCount}</b></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Справок ждёт</span><b style={{ color: "var(--color-text)" }}>{digest.pending}</b></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Одобрено всего</span><b style={{ color: "var(--color-text)" }}>{digest.approvedTotal ?? "—"}</b></div>
                    {digest.buildingStats.map((b) => (
                      <div key={b.name} style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--color-hairline-soft)" }}>
                        <span>{b.name}</span><b style={{ color: "var(--color-text)" }}>{b.forSale > 0 ? `${b.forSale} · от $${b.price.toLocaleString()}/м²` : "нет в продаже"}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {quickPanel.key === "discount" && digest && (
                <>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 12 }}>
                    Средний одобренный дисконт
                  </div>
                  <div style={{ fontSize: 34, fontWeight: 800, color: "var(--v-accent)", lineHeight: 1 }}>{digest.avgDiscount ?? 0}%</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 10 }}>{digest.approvedTotal ?? 0} одобренных справок всего</div>
                </>
              )}
            </div>,
            document.body
          )}

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
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", display: "inline-flex", background: "rgba(255,255,255,.16)", padding: "6px 13px", borderRadius: 99, marginTop: 14 }}>
                  {isBoss ? `${digest.pending} в очереди` : "Кнопка «Справка» выше →"}
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
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "0 24px 18px", display: "flex", flexDirection: "column", borderTop: "1px solid var(--color-hairline-soft)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", width: "100%", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", paddingTop: 16 }}>
          {activeConvId ? (
            <ChatThread
              conversationId={activeConvId} isBoss={isBoss} spravkaMode={spravkaMode}
              onSpravkaCreated={() => setSpravkaMode(false)} greeting={greeting}
            />
          ) : (
            <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка чата…</div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  label, onClick, icon, primary,
}: { label: string; onClick: (e: React.MouseEvent<HTMLDivElement>) => void; icon: React.ReactNode; primary?: boolean; active?: boolean }) {
  const isFilled = Boolean(primary);
  return (
    <div data-quick-trigger style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, cursor: "pointer" }} onClick={onClick}>
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
