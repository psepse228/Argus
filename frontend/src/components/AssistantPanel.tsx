"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, CurrentUser } from "@/lib/api";
import { SpravkaRequest, Conversation } from "@/lib/types";
import { ChatThread } from "./ChatThread";
import { DocsPanel } from "./DocsPanel";

type Digest = {
  pending: number;
  pendingItems: SpravkaRequest[];
  recent: SpravkaRequest[];
  approvedTotal?: number;
  avgDiscount?: number;
  leadsCount: number;
  buildingStats: { name: string; forSale: number; price: number }[];
};

type View = "overview" | "docs" | string; // string = conversation id

function conversationLabel(c: Conversation): string {
  if (c.title) return c.title;
  const d = new Date(c.created_at);
  return `Чат — ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Ассистент and Справки used to be two separate sections doing overlapping
 * things (chat-driven spravka creation vs. the form). Merged into one
 * inbox-style shell: a left list to pick what you're doing (dashboard
 * overview, the Справки form/history, or any chat thread) and a right pane
 * that fills with whichever is selected -- instead of a HUD dashboard
 * permanently stacked above every single chat regardless of length. */
export function AssistantPanel({ user }: { user: CurrentUser }) {
  const isBoss = user.role === "boss";
  const [digest, setDigest] = useState<Digest | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [view, setView] = useState<View>("overview");
  const [pendingPrompt, setPendingPrompt] = useState<{ id: string; text: string } | null>(null);

  const [bellOpen, setBellOpen] = useState(false);
  const [bellPos, setBellPos] = useState<{ top: number; right: number } | null>(null);
  const bellBtnRef = useRef<HTMLDivElement>(null);
  const bellPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.conversations().then(setConversations).catch(() => {});
  }, []);

  async function startNewChat() {
    const created = await api.createConversation();
    setConversations((cur) => [created, ...cur]);
    setView(created.id);
  }

  async function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.deleteConversation(id).catch(() => {});
    setConversations((cur) => cur.filter((c) => c.id !== id));
    if (view === id) setView("overview");
  }

  async function startPromptChat(prompt: string) {
    const created = await api.createConversation();
    setConversations((cur) => [created, ...cur]);
    setPendingPrompt({ id: created.id, text: prompt });
    setView(created.id);
  }

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

  // "What happened while you were away" — real data, not filler.
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
        /* best-effort — inbox still works without the digest */
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

  const greeting = isBoss
    ? "Доброе утро. Я слежу за юнитами, лидами и справками Italiano Vero. Спросите что угодно."
    : "Привет! Помогу подобрать юниты, оформить справку, согласовать условия и разобрать лидов.";

  return (
    <div className="glass-panel" style={{ flex: 1, minHeight: 0, display: "flex", padding: 0, overflow: "hidden" }}>
      <div style={{ width: 272, flexShrink: 0, borderRight: "1px solid var(--color-hairline-soft)", display: "flex", flexDirection: "column", padding: "18px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px", marginBottom: 16 }}>
          <div
            title={`${user.email} · ${isBoss ? "Босс" : "Агент"}`}
            style={{
              width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(150deg, var(--v-violet-strong, #7a5cff), var(--v-violet, #5b3fc4))",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: "#fff",
            }}
          >
            {isBoss ? "Б" : "А"}
          </div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 14.5, fontWeight: 800, color: "var(--color-text)", flex: 1 }}>
            Ассистент
          </div>
          <div
            ref={bellBtnRef}
            role="button" tabIndex={0} aria-label="Уведомления"
            onClick={() => setBellOpen((v) => !v)}
            style={{
              width: 32, height: 32, borderRadius: "50%", flexShrink: 0, position: "relative", cursor: "pointer",
              background: "rgba(255,255,255,.05)", border: "1px solid var(--color-hairline)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-soft)",
            }}
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.9}>
              <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 21a2 2 0 0 0 4 0" />
            </svg>
            {digest && digest.pending > 0 && (
              <span style={{ position: "absolute", top: 5, right: 6, width: 6, height: 6, borderRadius: "50%", background: "var(--v-accent)", boxShadow: "0 0 0 2px var(--v-bg, #140a2c)" }} />
            )}
          </div>
          {bellOpen && bellPos && createPortal(
            <div ref={bellPopoverRef} className="glass-panel" style={{ position: "fixed", top: bellPos.top, right: bellPos.right, width: 280, padding: "14px 16px", zIndex: 1000 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>Ждут одобрения</div>
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

        <InboxRow active={view === "overview"} onClick={() => setView("overview")} label="Обзор" icon={<><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>} />
        <InboxRow
          active={view === "docs"} onClick={() => setView("docs")} label="Справки"
          icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>}
          badge={digest?.pending}
        />

        <div style={{ height: 1, background: "var(--color-hairline-soft)", margin: "10px 6px" }} />

        <div
          onClick={startNewChat}
          className="press"
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--v-accent)", padding: "9px 10px", borderRadius: 9, cursor: "pointer" }}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M12 5v14M5 12h14" /></svg>
          Новый чат
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 4 }}>
          {conversations.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--color-text-faint)", padding: "9px 10px" }}>Нет чатов</div>
          ) : conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => setView(c.id)}
              className="press conv-row"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 12.5, padding: "9px 6px 9px 10px", borderRadius: 9, cursor: "pointer",
                background: view === c.id ? "var(--v-accent-tint)" : "transparent",
                color: view === c.id ? "var(--v-accent)" : "var(--color-text-soft)",
                fontWeight: view === c.id ? 700 : 500,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {conversationLabel(c)}
              </span>
              <span
                onClick={(e) => deleteChat(c.id, e)}
                title="Удалить чат"
                className="conv-delete press"
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-faint)" }}
              >
                <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                </svg>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", padding: view === "docs" ? "26px 24px" : "26px 24px", overflowY: view === "docs" ? "auto" : "visible" }}>
        {view === "overview" && (
          <OverviewContent
            digest={digest} isBoss={isBoss} quickActions={quickActions}
            onOpenDocs={() => setView("docs")}
            onQuickPrompt={startPromptChat}
          />
        )}
        {view === "docs" && <DocsPanel user={user} />}
        {view !== "overview" && view !== "docs" && (
          <ChatThread
            conversationId={view} isBoss={isBoss} spravkaMode={false}
            greeting={greeting}
            initialPrompt={pendingPrompt?.id === view ? pendingPrompt.text : undefined}
            onInitialPromptSent={() => setPendingPrompt(null)}
          />
        )}
      </div>
    </div>
  );
}

function OverviewContent({
  digest, isBoss, quickActions, onOpenDocs, onQuickPrompt,
}: {
  digest: Digest | null;
  isBoss: boolean;
  quickActions: { label: string; icon: React.ReactNode; panel?: "approvals" | "summary" | "discount"; prompt?: string }[];
  onOpenDocs: () => void;
  onQuickPrompt: (prompt: string) => void;
}) {
  // Quick actions switch what's shown right here in Обзор -- they used to
  // open a small floating popover (felt like an afterthought) or, worse,
  // read as "redirects to chat" once Справка started spawning a thread.
  // Now every one of them is a plain in-place view swap, никакого чата.
  const [tab, setTab] = useState<"home" | "approvals" | "summary" | "discount">("home");

  return (
    <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 22 }}>
        <QuickAction
          primary label="Справка" onClick={onOpenDocs}
          icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h4" /></>}
        />
        {quickActions.map((q) => (
          <QuickAction
            key={q.label} label={q.label} icon={q.icon} active={tab === q.panel}
            onClick={() => (q.panel ? setTab((t) => (t === q.panel ? "home" : q.panel!)) : onQuickPrompt(q.prompt!))}
          />
        ))}
      </div>

      {tab !== "home" && (
        <div className="glass-panel" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              {tab === "approvals" ? "Ждут одобрения" : tab === "summary" ? "Сводка" : "Средний одобренный дисконт"}
            </div>
            <div onClick={() => setTab("home")} style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-faint)", cursor: "pointer" }}>Закрыть ✕</div>
          </div>
          {tab === "approvals" && (
            !digest || digest.pendingItems.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пусто — всё разобрано.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {digest.pendingItems.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "var(--color-text-soft)", paddingBottom: 10, borderBottom: "1px solid var(--color-hairline-soft)" }}>
                    <span>{r.units ? <>№{r.units.unit_number} · {r.units.buildings?.name}</> : "—"} — {r.client_name}</span>
                  </div>
                ))}
                <div onClick={onOpenDocs} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--v-accent)", cursor: "pointer", marginTop: 4 }}>Открыть в Справки →</div>
              </div>
            )
          )}
          {tab === "summary" && digest && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--color-text-soft)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Лидов в работе</span><b style={{ color: "var(--color-text)" }}>{digest.leadsCount}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Справок ждёт</span><b style={{ color: "var(--color-text)" }}>{digest.pending}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Одобрено всего</span><b style={{ color: "var(--color-text)" }}>{digest.approvedTotal ?? "—"}</b></div>
              {digest.buildingStats.map((b) => (
                <div key={b.name} style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--color-hairline-soft)" }}>
                  <span>{b.name}</span><b style={{ color: "var(--color-text)" }}>{b.forSale > 0 ? `${b.forSale} · от $${b.price.toLocaleString()}/м²` : "нет в продаже"}</b>
                </div>
              ))}
            </div>
          )}
          {tab === "discount" && digest && (
            <>
              <div style={{ fontSize: 40, fontWeight: 800, color: "var(--v-accent)", lineHeight: 1 }}>{digest.avgDiscount ?? 0}%</div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-faint)", marginTop: 10 }}>{digest.approvedTotal ?? 0} одобренных справок всего</div>
            </>
          )}
        </div>
      )}

      {tab === "home" && digest && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="glass-panel" style={{ padding: "20px 22px" }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 5 }}>Лиды</div>
            <div style={{ fontSize: 12.5, color: "var(--color-text-soft)", lineHeight: 1.6 }}>
              {digest.leadsCount > 0 ? `${digest.leadsCount} лидов в воронке — от новых до готовых к брони.` : "Пока нет лидов в базе."}
            </div>
            <div style={{ display: "inline-flex", fontSize: 11.5, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)", padding: "6px 13px", borderRadius: 99, marginTop: 14 }}>
              {digest.leadsCount} в работе
            </div>
          </div>
          <div style={{ padding: "20px 22px", borderRadius: 22, color: "#fff", background: "linear-gradient(155deg, var(--v-violet-strong, #7a5cff), var(--v-violet, #5b3fc4) 75%)" }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 5 }}>Справки</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.78)", lineHeight: 1.6 }}>
              {digest.pending > 0 ? `${digest.pending} ждут вашего решения. Всё остальное — под контролем.` : "Всё разобрано — очередь пуста."}
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
  );
}

function InboxRow({
  active, onClick, label, icon, badge,
}: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode; badge?: number }) {
  return (
    <div
      onClick={onClick}
      className="press"
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 10, cursor: "pointer", marginBottom: 3,
        background: active ? "var(--v-accent)" : "transparent",
        color: active ? "var(--v-text-on-accent)" : "var(--color-text-soft)",
      }}
    >
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9}>{icon}</svg>
      <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{label}</span>
      {!!badge && (
        <span style={{
          fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center",
          background: active ? "rgba(255,255,255,.25)" : "var(--v-accent)", color: active ? "#fff" : "var(--v-text-on-accent)",
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}

function QuickAction({
  label, onClick, icon, primary, active,
}: { label: string; onClick: (e: React.MouseEvent<HTMLDivElement>) => void; icon: React.ReactNode; primary?: boolean; active?: boolean }) {
  const isFilled = Boolean(primary);
  return (
    <div data-quick-trigger style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, cursor: "pointer" }} onClick={onClick}>
      <div
        className="press"
        style={{
          width: 52, height: 52, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          background: isFilled ? "var(--v-accent)" : active ? "var(--v-accent-tint)" : "rgba(255,255,255,.05)",
          border: isFilled ? "none" : `1px solid ${active ? "var(--v-accent)" : "var(--color-hairline)"}`,
          color: isFilled ? "var(--v-text-on-accent)" : active ? "var(--v-accent)" : "var(--color-text-soft)",
          boxShadow: isFilled ? "0 14px 26px -10px color-mix(in srgb, var(--v-accent) 55%, transparent)" : "none",
        }}
      >
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.9}>{icon}</svg>
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 650, color: active ? "var(--v-accent)" : "var(--color-text-soft)", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}
