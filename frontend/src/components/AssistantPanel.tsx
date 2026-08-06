"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, CurrentUser } from "@/lib/api";
import { CompanySummary, SpravkaRequest } from "@/lib/types";
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
};

type View = "overview" | "workshop";

/** Ассистент's Обзор (digest) and Мастерская (the client-workspace tab that
 * replaced the old standalone Справки form/list) live in one inbox-style
 * shell -- switched between via a horizontal pill row up top (no docked
 * left rail here either, to match the rest of the app since the HUD-spaces
 * rework). General freeform chat no longer lives here at all -- that's the
 * floating AssistantWidget now; anything client-specific happens inside a
 * client's own workspace in Мастерская. */
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
  // Which inline panel is open within Обзор (approvals/summary/discount) --
  // lifted up here (used to live inside OverviewContent) because the pills
  // that drive it now live in the shared top row, not a child component.
  const [tab, setTab] = useState<"home" | "approvals" | "summary" | "discount">("home");

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

  // "What happened while you were away" — real data, not filler. Also
  // re-run on demand (see onDigestRefresh below) after an approve/reject
  // actually changes the pending count -- otherwise the Мастерская pill's
  // badge and the SpaceIndicator's badge both stay stale until a reload.
  async function refreshDigest() {
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
      onPendingChange?.(pending.length);
      if (isBoss) {
        const summary = await api.analyticsSummary();
        setDigest({
          pending: pending.length, pendingItems: pending, recent, leadsCount: leads.length, buildingStats, totalUnits: units.length,
          approvedTotal: summary.spravka_requests_approved,
          avgDiscount: summary.average_approved_discount_pct,
        });
      } else {
        setDigest({ pending: pending.length, pendingItems: pending, recent, leadsCount: leads.length, buildingStats, totalUnits: units.length });
      }
    } catch {
      /* best-effort — inbox still works without the digest */
    }
  }
  useEffect(() => { refreshDigest(); }, [isBoss]);

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
    <div className="glass-panel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "20px 24px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 20 }}>
          <QuickAction
            primary label="Обзор" active={view === "overview"} onClick={() => setView("overview")}
            icon={<><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>}
          />
          <QuickAction
            primary label="Мастерская" active={view === "workshop"} badge={digest?.pending} onClick={() => setView("workshop")}
            icon={<><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a4 4 0 0 1-5.3 5.3L6.4 20.6a2 2 0 0 1-2.8-2.8L12.7 8.7a4 4 0 0 1 5.3-5.3z" /></>}
          />
          {view === "overview" && quickActions.map((q) => (
            <QuickAction
              key={q.label} label={q.label} icon={q.icon} active={tab === q.panel}
              onClick={() => setTab((t) => (t === q.panel ? "home" : q.panel!))}
            />
          ))}
        </div>
        <div
          ref={bellBtnRef}
          role="button" tabIndex={0} aria-label="Уведомления"
          onClick={() => setBellOpen((v) => !v)}
          style={{
            width: 32, height: 32, borderRadius: "50%", flexShrink: 0, position: "relative", cursor: "pointer",
            background: "var(--surface-05)", border: "1px solid var(--color-hairline)",
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
          </div>,
          document.body
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", padding: "20px 24px 26px", overflowY: view === "overview" ? "visible" : "hidden" }}>
        {view === "overview" && (
          <OverviewContent
            digest={digest} isBoss={isBoss} tab={tab} onCloseTab={() => setTab("home")}
            onOpenClient={(id) => { setBellJumpClientId(id); setView("workshop"); }}
            onDecided={refreshDigest}
          />
        )}
        {view === "workshop" && (
          <WorkshopPanel
            isBoss={isBoss}
            pendingApprovals={pendingApprovals}
            initialClientId={bellJumpClientId || openWorkspaceClientId}
            onInitialClientHandled={() => { setBellJumpClientId(null); onWorkspaceClientHandled?.(); }}
            onDecided={refreshDigest}
          />
        )}
      </div>
    </div>
  );
}

function OverviewContent({
  digest, isBoss, tab, onCloseTab, onOpenClient, onDecided,
}: {
  digest: Digest | null;
  isBoss: boolean;
  tab: "home" | "approvals" | "summary" | "discount";
  onCloseTab: () => void;
  onOpenClient: (clientId: string) => void;
  onDecided: () => void;
}) {
  // Argus Brain Phase 3: on-demand owner narrative for Сводка -- read on
  // click, never cached, so this state lives here (not in a hook shared
  // with the daily-briefing cache) and resets whenever the tab is closed.
  const [companySummary, setCompanySummary] = useState<CompanySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  async function askAi() {
    if (summaryLoading) return; // guards a fast double-click into a second in-flight request
    setSummaryLoading(true);
    setSummaryError("");
    try {
      setCompanySummary(await api.companySummary());
    } catch (e: any) {
      setSummaryError(`Не удалось построить сводку: ${e.message}`);
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "summary") {
      setCompanySummary(null);
      setSummaryError("");
    }
  }, [tab]);

  return (
    <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
      {tab !== "home" && (
        <div className="glass-panel" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              {tab === "approvals" ? "Ждут одобрения" : tab === "summary" ? "Сводка" : "Средний одобренный дисконт"}
            </div>
            <div onClick={onCloseTab} style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-faint)", cursor: "pointer" }}>Закрыть ✕</div>
          </div>
          {tab === "approvals" && (
            <SpravkaApprovalTable onlyPending onOpenClient={onOpenClient} onDecided={onDecided} />
          )}
          {tab === "summary" && digest && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div className="glass-panel" style={{ padding: "14px 15px" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 800, color: "var(--v-accent)", lineHeight: 1 }}>{digest.leadsCount}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 5 }}>Лидов в работе</div>
                </div>
                <div className="glass-panel" style={{ padding: "14px 15px" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 800, color: "var(--warning)", lineHeight: 1 }}>{digest.pending}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 5 }}>Справок ждёт</div>
                </div>
                <div className="glass-panel" style={{ padding: "14px 15px" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 800, color: "var(--success)", lineHeight: 1 }}>{digest.approvedTotal ?? "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 5 }}>Одобрено всего</div>
                </div>
              </div>
              {digest.buildingStats.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--color-text-soft)" }}>
                  {digest.buildingStats.map((b) => (
                    <div key={b.name} style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--color-hairline-soft)" }}>
                      <span>{b.name}</span><b style={{ color: "var(--color-text)" }}>{b.forSale > 0 ? `${b.forSale} · от $${b.price.toLocaleString()}/м²` : "нет в продаже"}</b>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ borderTop: "1px solid var(--color-hairline-soft)", paddingTop: 16 }}>
                {!companySummary && !summaryLoading && !summaryError && (
                  <button
                    onClick={askAi}
                    className="press"
                    aria-label="Спросить AI"
                    style={{
                      fontSize: 12.5, fontWeight: 700, color: "#fff", background: "var(--v-accent)",
                      border: "none", borderRadius: 99, padding: "9px 18px", cursor: "pointer",
                    }}
                  >
                    Спросить AI
                  </button>
                )}
                {summaryLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", gap: 4, padding: "9px 13px", background: "var(--v-accent-tint)", borderRadius: 99 }}>
                      {[0, 0.2, 0.4].map((d) => (
                        <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "var(--v-accent)", animation: `argDot 1.2s infinite ${d}s` }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text-soft)" }}>Строю сводку…</span>
                  </div>
                )}
                {summaryError && !summaryLoading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{summaryError}</div>
                    <button
                      onClick={askAi}
                      className="press"
                      aria-label="Повторить построение сводки"
                      style={{
                        fontSize: 12, fontWeight: 700, color: "var(--v-accent)", background: "none",
                        border: "1px solid var(--color-hairline)", borderRadius: 99, padding: "6px 14px",
                        cursor: "pointer", alignSelf: "flex-start",
                      }}
                    >
                      Повторить
                    </button>
                  </div>
                )}
                {companySummary && !summaryLoading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <p style={{ fontSize: 13, color: "var(--color-text-soft)", lineHeight: 1.6, margin: 0 }}>
                      {companySummary.narrative}
                    </p>
                    {companySummary.highlights.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {companySummary.highlights.map((h, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--v-accent)", flexShrink: 0, marginTop: 5 }} />
                            <div>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>{h.label}</div>
                              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>{h.detail}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={askAi}
                      className="press"
                      aria-label="Обновить сводку"
                      style={{
                        fontSize: 11.5, fontWeight: 700, color: "var(--color-text-faint)", background: "none",
                        border: "none", cursor: "pointer", alignSelf: "flex-start", padding: 0,
                      }}
                    >
                      Обновить сводку
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {tab === "discount" && digest && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="glass-panel" style={{ padding: "17px 18px" }}>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 34, fontWeight: 800, color: "var(--v-accent)", lineHeight: 1 }}>{digest.avgDiscount ?? 0}%</div>
                <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 6 }}>Средний одобренный дисконт</div>
              </div>
              <div className="glass-panel" style={{ padding: "17px 18px" }}>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 34, fontWeight: 800, color: "var(--color-text)", lineHeight: 1 }}>{digest.approvedTotal ?? 0}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 6 }}>Одобренных справок всего</div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "home" && <TodayQueue />}

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

      {tab === "home" && digest && digest.buildingStats.some((b) => b.forSale > 0) && (
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
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--color-text)" }}>Cortège для Italiano Vero</div>
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

function QuickAction({
  label, onClick, icon, primary, active, badge,
}: {
  label: string; onClick: (e: React.MouseEvent<HTMLDivElement>) => void; icon: React.ReactNode;
  /** "primary" pills (Обзор/Мастерская — the section toggle, not the Обзор-
   * only inline tabs) fill solid when active instead of just tinting. */
  primary?: boolean; active?: boolean; badge?: number;
}) {
  const isFilled = primary ? Boolean(active) : false;
  return (
    <div data-quick-trigger style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, cursor: "pointer" }} onClick={onClick}>
      <div
        className="press"
        style={{
          width: 52, height: 52, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
          background: isFilled ? "var(--v-accent)" : active ? "var(--v-accent-tint)" : "var(--surface-05)",
          border: isFilled ? "none" : `1px solid ${active ? "var(--v-accent)" : "var(--color-hairline)"}`,
          color: isFilled ? "var(--v-text-on-accent)" : active ? "var(--v-accent)" : "var(--color-text-soft)",
          boxShadow: isFilled ? "0 14px 26px -10px color-mix(in srgb, var(--v-accent) 55%, transparent)" : "none",
        }}
      >
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.9}>{icon}</svg>
        {!!badge && (
          <span style={{
            position: "absolute", top: -3, right: -3, fontSize: 10, fontWeight: 700, minWidth: 17, height: 17, borderRadius: 99,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--danger)", color: "#fff", boxShadow: "0 0 0 2px var(--v-bg, #140a2c)",
          }}>
            {badge}
          </span>
        )}
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 650, color: active ? "var(--v-accent)" : "var(--color-text-soft)", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}
