"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, CurrentUser } from "@/lib/api";
import { SpravkaRequest, Payment } from "@/lib/types";
import { SpravkaApprovalTable } from "./SpravkaApprovalTable";
import { TodayQueue } from "./TodayQueue";
import { WorkshopPanel } from "./WorkshopPanel";

type Digest = {
  pending: number;
  pendingItems: SpravkaRequest[];
  recent: SpravkaRequest[];
  approvedTotal?: number;
  avgDiscount?: number;
  leadsCount: number;
  buildingStats: { name: string; forSale: number; price: number }[];
  totalUnits: number;
  duePaymentsCount: number;
};

type View = "overview" | "workshop";

/** Ассистент's Обзор (digest) and Мастерская (the client-workspace tab that
 * replaced the old standalone Справки form/list) live in one inbox-style
 * shell: a left nav to pick which, and a right pane that fills with
 * whichever is selected. General freeform chat no longer lives here at all
 * -- that's the floating AssistantWidget now; anything client-specific
 * happens inside a client's own workspace in Мастерская. */
export function AssistantPanel({
  user, openWorkspaceClientId, onWorkspaceClientHandled, onPendingChange,
}: {
  user: CurrentUser;
  /** Set from outside (Клиенты's "Открыть в Мастерской", Лиды hand-off) to
   * jump straight into Мастерская with this client already open. */
  openWorkspaceClientId?: string | null;
  onWorkspaceClientHandled?: () => void;
  /** Reports the pending-approvals count up to the space indicator's badge
   * -- this panel owns the real digest fetch, the indicator just needs the number. */
  onPendingChange?: (n: number) => void;
}) {
  const isBoss = user.role === "boss";
  const [digest, setDigest] = useState<Digest | null>(null);
  const [view, setView] = useState<View>("overview");

  useEffect(() => {
    if (openWorkspaceClientId) setView("workshop");
  }, [openWorkspaceClientId]);

  const [bellOpen, setBellOpen] = useState(false);
  const [bellPos, setBellPos] = useState<{ top: number; right: number } | null>(null);
  const bellBtnRef = useRef<HTMLDivElement>(null);
  const bellPopoverRef = useRef<HTMLDivElement>(null);

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
        const [requests, leads, buildings, units, payments]: [SpravkaRequest[], any[], any[], any[], Payment[]] = await Promise.all([
          api.spravkaRequests(), api.leads(), api.buildings(), api.units(), api.payments().catch(() => []),
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
        const duePaymentsCount = payments.filter((p) => p.status === "overdue" || p.due_soon).length;
        onPendingChange?.(pending.length);
        if (isBoss) {
          const summary = await api.analyticsSummary();
          setDigest({
            pending: pending.length, pendingItems: pending, recent, leadsCount: leads.length, buildingStats, totalUnits: units.length, duePaymentsCount,
            approvedTotal: summary.spravka_requests_approved,
            avgDiscount: summary.average_approved_discount_pct,
          });
        } else {
          setDigest({ pending: pending.length, pendingItems: pending, recent, leadsCount: leads.length, buildingStats, totalUnits: units.length, duePaymentsCount });
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
    : [];

  // Bell popover items jump straight into that client's Мастерская workspace
  // instead of just being read-only text.
  const [bellJumpClientId, setBellJumpClientId] = useState<string | null>(null);
  const pendingApprovals = (digest?.pendingItems || [])
    .filter((r) => r.client_id)
    .map((r) => ({ client_id: r.client_id!, client_name: r.client_name }));

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
            {digest && (digest.pending > 0 || digest.duePaymentsCount > 0) && (
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
                    <div
                      key={r.id}
                      onClick={() => {
                        if (!r.client_id) return;
                        setBellJumpClientId(r.client_id);
                        setView("workshop");
                        setBellOpen(false);
                      }}
                      className={r.client_id ? "press" : undefined}
                      style={{ fontSize: 12.5, color: "var(--color-text-soft)", cursor: r.client_id ? "pointer" : "default" }}
                    >
                      {r.units ? <>№{r.units.unit_number} · {r.units.buildings?.name}</> : "—"} — {r.client_name}
                    </div>
                  ))}
                </div>
              )}
              {digest && digest.duePaymentsCount > 0 && (
                <>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--warning)", margin: "14px 0 8px" }}>
                    Платежи скоро/просрочены
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-soft)" }}>{digest.duePaymentsCount} — см. Платежи</div>
                </>
              )}
            </div>,
            document.body
          )}
        </div>

        <InboxRow active={view === "overview"} onClick={() => setView("overview")} label="Обзор" icon={<><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>} />
        <InboxRow
          active={view === "workshop"} onClick={() => setView("workshop")} label="Мастерская"
          icon={<><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a4 4 0 0 1-5.3 5.3L6.4 20.6a2 2 0 0 1-2.8-2.8L12.7 8.7a4 4 0 0 1 5.3-5.3z" /></>}
          badge={digest?.pending}
        />

        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", padding: "26px 24px", overflowY: view === "overview" ? "visible" : "hidden" }}>
        {view === "overview" && (
          <OverviewContent
            digest={digest} isBoss={isBoss} quickActions={quickActions}
            onOpenWorkshop={() => setView("workshop")}
            onOpenClient={(id) => { setBellJumpClientId(id); setView("workshop"); }}
          />
        )}
        {view === "workshop" && (
          <WorkshopPanel
            isBoss={isBoss}
            pendingApprovals={pendingApprovals}
            initialClientId={bellJumpClientId || openWorkspaceClientId}
            onInitialClientHandled={() => { setBellJumpClientId(null); onWorkspaceClientHandled?.(); }}
          />
        )}
      </div>
    </div>
  );
}

function OverviewContent({
  digest, isBoss, quickActions, onOpenWorkshop, onOpenClient,
}: {
  digest: Digest | null;
  isBoss: boolean;
  quickActions: { label: string; icon: React.ReactNode; panel?: "approvals" | "summary" | "discount" }[];
  onOpenWorkshop: () => void;
  onOpenClient: (clientId: string) => void;
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
          primary label="Мастерская" onClick={onOpenWorkshop}
          icon={<><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a4 4 0 0 1-5.3 5.3L6.4 20.6a2 2 0 0 1-2.8-2.8L12.7 8.7a4 4 0 0 1 5.3-5.3z" /></>}
        />
        {quickActions.map((q) => (
          <QuickAction
            key={q.label} label={q.label} icon={q.icon} active={tab === q.panel}
            onClick={() => setTab((t) => (t === q.panel ? "home" : q.panel!))}
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
            <SpravkaApprovalTable onlyPending onOpenClient={onOpenClient} />
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

      {tab === "home" && <TodayQueue isBoss={isBoss} />}

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
              {isBoss ? `${digest.pending} в очереди` : "Кнопка «Мастерская» выше →"}
            </div>
          </div>
        </div>
      )}

      {digest && digest.buildingStats.some((b) => b.forSale > 0) && (
        <div className="glass-panel" style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Юниты — быстрый обзор</div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--v-accent)" }}>{digest.totalUnits} всего</span>
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

      {isBoss && tab === "home" && <CortegeTeaserCard />}
    </div>
  );
}

/** Cross-sell placeholder, not a real integration yet -- Argus and Cortège
 * are separate Solura products today. This just plants the idea in front of
 * the one person (the boss) who'd actually buy it, once it's real. */
function CortegeTeaserCard() {
  return (
    <div
      className="glass-panel"
      style={{
        padding: "18px 20px", display: "flex", alignItems: "center", gap: 16,
        border: "1px solid color-mix(in srgb, #22d3ee 30%, transparent)",
      }}
    >
      <div
        style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(150deg, #22d3ee, #6366f1)",
        }}
      >
        <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="#fff" strokeWidth={1.9}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--color-text)" }}>Cortège для Horizon Bay</div>
        <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 2, lineHeight: 1.5 }}>
          AI, который сам отвечает клиентам в Instagram и Telegram — те же лиды, без ожидания менеджера.
        </div>
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: "#22d3ee", background: "rgba(34,211,238,.12)", padding: "5px 12px", borderRadius: 99, flexShrink: 0, whiteSpace: "nowrap" }}>
        Скоро
      </span>
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
