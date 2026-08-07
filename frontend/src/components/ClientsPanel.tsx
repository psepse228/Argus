"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Client, ClientSegment, PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/types";
import { CallButton } from "./CallButton";
import { ClientInfoCard } from "./ClientInfoCard";
import { Skeleton } from "./Skeleton";
import { SectionLabel } from "./SectionLabel";
import { DonutChart } from "./DonutChart";
import { Dropdown } from "./Dropdown";

const PRIORITY_RANK: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
const ALL = "";
type SortBy = "priority" | "recency" | "name";
const SORT_LABELS: Record<SortBy, string> = { priority: "По приоритету", recency: "По активности", name: "По имени" };

/** Just the directory now -- browse and quick-edit a client's priority/next
 * contact. Actually working a client (chat, справка, Cortège+) is
 * Мастерская's job (see AssistantPanel.tsx / ClientWorkspace.tsx), reached
 * via the "Открыть в Мастерской" button inside ClientInfoCard, not a click
 * on the card itself. */
export function ClientsPanel({
  openClientId, onOpenClientHandled, onOpenWorkspace,
}: {
  /** Set from outside (e.g. Лиды's "Открыть карточку клиента" button) to
   * drill straight into a client instead of landing on the plain list. */
  openClientId?: string | null;
  onOpenClientHandled?: () => void;
  onOpenWorkspace: (clientId: string) => void;
}) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Open by default -- collapsed-by-default left the page looking empty
  // whenever most clients are still bare phone numbers from leads (e.g. 7
  // of 11), since the named grid alone doesn't fill the panel. Still
  // collapsible once there are enough named clients that this becomes noise.
  const [showUnnamed, setShowUnnamed] = useState(true);

  const [buildingFilter, setBuildingFilter] = useState(ALL);
  const [managerFilter, setManagerFilter] = useState(ALL);
  const [priorityFilter, setPriorityFilter] = useState(ALL);
  const [sortBy, setSortBy] = useState<SortBy>("priority");

  const [segments, setSegments] = useState<ClientSegment[] | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [segmentsError, setSegmentsError] = useState(false);
  const [activeSegment, setActiveSegment] = useState<ClientSegment | null>(null);

  useEffect(() => { api.clients().then(setClients).catch(() => setClients([])); }, []);

  useEffect(() => {
    if (openClientId) {
      setSelectedId(openClientId);
      onOpenClientHandled?.();
    }
  }, [openClientId, onOpenClientHandled]);

  const modal = selectedId && (
    <ClientInfoCard
      clientId={selectedId}
      onClose={() => setSelectedId(null)}
      onOpenWorkspace={onOpenWorkspace}
    />
  );

  // Hooks must run unconditionally on every render (Rules of Hooks) -- these
  // used to sit after the `clients === null` early return below, which threw
  // "Rendered more hooks than during the previous render" the moment the
  // fetch resolved. `clients || []` keeps them safe to call before the data
  // exists.
  const buildingOptions = useMemo(
    () => Array.from(new Set((clients || []).flatMap((c) => c.buildings || []))).sort(),
    [clients]
  );
  const managerOptions = useMemo(
    () => Array.from(new Set((clients || []).map((c) => c.assigned_manager).filter((m): m is string => !!m))).sort(),
    [clients]
  );

  if (clients === null) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Клиенты</h1>
        <Skeleton width={260} height={13} style={{ margin: "0 0 16px" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="glass-panel stagger-item" style={{ ["--i" as any]: i, padding: "18px 19px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <Skeleton width={38} height={38} radius={99} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <Skeleton width="70%" height={13} />
                  <Skeleton width="50%" height={10} />
                </div>
              </div>
              <Skeleton width={70} height={16} radius={99} />
            </div>
          ))}
        </div>
        {modal}
      </div>
    );
  }

  function compare(a: Client, b: Client): number {
    if (sortBy === "name") return (a.name || a.phone).localeCompare(b.name || b.phone);
    if (sortBy === "recency") {
      const ra = a.last_activity_at || "";
      const rb = b.last_activity_at || "";
      if (ra !== rb) return ra > rb ? -1 : 1; // most recent first, no-activity last
      return (a.name || a.phone).localeCompare(b.name || b.phone);
    }
    // "priority" (default) -- unchanged from the original behavior.
    const pa = a.priority ? PRIORITY_RANK[a.priority] : 3;
    const pb = b.priority ? PRIORITY_RANK[b.priority] : 3;
    if (pa !== pb) return pa - pb;
    const activeA = a.leads_count + a.spravka_count > 0 ? 0 : 1;
    const activeB = b.leads_count + b.spravka_count > 0 ? 0 : 1;
    if (activeA !== activeB) return activeA - activeB;
    return (a.name || a.phone).localeCompare(b.name || b.phone);
  }

  const q = query.trim().toLowerCase();
  let filtered = clients;
  if (q) filtered = filtered.filter((c) => (c.name || "").toLowerCase().includes(q) || c.phone.includes(q));
  if (buildingFilter) filtered = filtered.filter((c) => (c.buildings || []).includes(buildingFilter));
  if (managerFilter) filtered = filtered.filter((c) => c.assigned_manager === managerFilter);
  if (priorityFilter) filtered = filtered.filter((c) => c.priority === priorityFilter);
  const filtersActive = !!(buildingFilter || managerFilter || priorityFilter);

  const segmentFiltered = activeSegment
    ? filtered.filter((c) => activeSegment.client_ids.includes(c.id))
    : filtered;

  // A real name is the actual signal of "someone worth looking at" -- a bare
  // phone number is just a lead that was never named, and there are dozens
  // of those (see 0009's seed leads). Splitting them out is what actually
  // fixes the "paper pile" feel -- sorting alone still put 20 phone-number
  // cards in the same grid as 2 real people.
  const named = [...segmentFiltered.filter((c) => c.name)].sort(compare);
  const unnamed = [...segmentFiltered.filter((c) => !c.name)].sort(compare);

  const activeCount = clients.filter((c) => c.leads_count + c.spravka_count > 0).length;
  const hotCount = clients.filter((c) => c.priority === "hot").length;
  const withSpravkaCount = clients.filter((c) => c.spravka_count > 0).length;
  const priorityBreakdown = (["hot", "warm", "cold"] as const)
    .map((p) => ({ label: PRIORITY_LABELS[p], value: clients.filter((c) => c.priority === p).length, color: PRIORITY_COLORS[p].fg }))
    .filter((p) => p.value > 0);

  async function runAISegments() {
    setSegmentsLoading(true);
    setSegmentsError(false);
    setActiveSegment(null);
    try {
      const res = await api.clientAISegments(filtered.map((c) => c.id));
      setSegments(res.segments);
    } catch {
      setSegmentsError(true);
      setSegments(null);
    } finally {
      setSegmentsLoading(false);
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Клиенты</h1>
        <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: 0 }}>{clients.length} клиентов — их лиды, справки и переписка в одном месте</p>
      </div>
      {clients.length === 0 && (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет клиентов — появятся из лидов и справок.</div>
      )}

      {clients.length > 0 && (
        <>
          <SectionLabel>Обзор</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
            <div className="glass-panel" style={{ padding: "17px 18px" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 27, fontWeight: 700, color: "var(--color-text)", lineHeight: 1 }}>{clients.length}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 6 }}>Всего клиентов</div>
            </div>
            <div className="glass-panel" style={{ padding: "17px 18px" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 27, fontWeight: 700, color: "var(--v-accent)", lineHeight: 1 }}>{activeCount}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 6 }}>Активных (есть лид/справка)</div>
            </div>
            <div className="glass-panel" style={{ padding: "17px 18px" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 27, fontWeight: 700, color: PRIORITY_COLORS.hot.fg, lineHeight: 1 }}>{hotCount}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 6 }}>Горячих</div>
            </div>
            <div className="glass-panel" style={{ padding: "17px 18px" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 27, fontWeight: 700, color: "var(--success)", lineHeight: 1 }}>{withSpravkaCount}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 6 }}>Со справками</div>
            </div>
          </div>

          {priorityBreakdown.length > 0 && (
            <div className="glass-panel" style={{ padding: "18px 20px", overflow: "visible" }}>
              <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 15, margin: "0 0 16px", color: "var(--color-text)" }}>Клиенты по приоритету</h3>
              <DonutChart data={priorityBreakdown} />
            </div>
          )}
        </>
      )}

      {clients.length > 0 && (
        <>
          <SectionLabel>Список</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени или телефону…"
              style={{ flex: "1 1 240px", maxWidth: 320, padding: "10px 14px", borderRadius: 12, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
            />
            <Dropdown
              value={buildingFilter} onChange={setBuildingFilter} placeholder="Все здания" style={{ width: 160 }}
              options={[{ value: ALL, label: "Все здания" }, ...buildingOptions.map((b) => ({ value: b, label: b }))]}
            />
            <Dropdown
              value={managerFilter} onChange={setManagerFilter} placeholder="Все менеджеры" style={{ width: 170 }}
              options={[{ value: ALL, label: "Все менеджеры" }, ...managerOptions.map((m) => ({ value: m, label: m }))]}
            />
            <Dropdown
              value={priorityFilter} onChange={setPriorityFilter} placeholder="Любой приоритет" style={{ width: 160 }}
              options={[{ value: ALL, label: "Любой приоритет" }, ...(["hot", "warm", "cold"] as const).map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))]}
            />
            <Dropdown
              value={sortBy} onChange={(v) => setSortBy(v as SortBy)} style={{ width: 170 }}
              options={(Object.keys(SORT_LABELS) as SortBy[]).map((s) => ({ value: s, label: SORT_LABELS[s] }))}
            />
            <button
              onClick={runAISegments}
              disabled={segmentsLoading || filtered.length === 0}
              className="press"
              style={{
                marginLeft: "auto", padding: "10px 16px", borderRadius: 12, cursor: segmentsLoading ? "default" : "pointer",
                background: "var(--v-accent-tint)", color: "var(--v-accent)", border: "1px solid transparent",
                fontSize: 12.5, fontWeight: 700, opacity: filtered.length === 0 ? 0.5 : 1,
              }}
            >
              {segmentsLoading ? "Анализирую…" : "✨ AI-сводка"}
            </button>
          </div>

          {segmentsError && (
            <div style={{ fontSize: 12, color: "var(--danger)" }}>Не удалось получить AI-сегменты — попробуйте ещё раз.</div>
          )}

          {segments && segments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {segments.map((seg, i) => (
                <div
                  key={i}
                  onClick={() => setActiveSegment(activeSegment === seg ? null : seg)}
                  title={seg.reason}
                  className="press"
                  style={{
                    cursor: "pointer", padding: "8px 14px", borderRadius: 12,
                    background: activeSegment === seg ? "var(--v-accent)" : "var(--v-accent-tint)",
                    color: activeSegment === seg ? "var(--v-text-on-accent)" : "var(--v-accent)",
                    fontSize: 12, fontWeight: 700,
                  }}
                >
                  {seg.label} · {seg.client_ids.length}
                </div>
              ))}
            </div>
          )}
          {segments && segments.length === 0 && !segmentsLoading && (
            <div style={{ fontSize: 12, color: "var(--color-text-faint)" }}>AI не нашёл явных сегментов в этом списке.</div>
          )}
          {activeSegment && (
            <div style={{ fontSize: 12, color: "var(--color-text-soft)" }}>
              Сегмент «{activeSegment.label}»: {activeSegment.reason}
              <span onClick={() => setActiveSegment(null)} className="press" style={{ marginLeft: 10, cursor: "pointer", color: "var(--v-accent)", fontWeight: 700 }}>✕ Сбросить</span>
            </div>
          )}
        </>
      )}

      {named.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
          {named.map((c, i) => <ClientCard key={c.id} client={c} index={i} onOpen={() => setSelectedId(c.id)} />)}
        </div>
      )}

      {unnamed.length > 0 && (
        <div>
          <div
            onClick={() => setShowUnnamed((v) => !v)}
            className="press"
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: showUnnamed ? 12 : 0 }}
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="var(--color-text-faint)" strokeWidth={2.5} style={{ transform: showUnnamed ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}>
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)" }}>
              Без имени (только телефон из лида) — {unnamed.length}
            </span>
          </div>
          {showUnnamed && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {unnamed.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className="press"
                  style={{
                    fontSize: 12, color: "var(--color-text-faint)", background: "var(--surface-03)",
                    border: "1px solid var(--color-hairline-soft)", borderRadius: 99, padding: "6px 13px", cursor: "pointer",
                  }}
                >
                  {c.phone}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {named.length === 0 && unnamed.length === 0 && (q || filtersActive || activeSegment) && (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Ничего не найдено по заданным фильтрам.</div>
      )}
      {modal}
    </div>
  );
}

function ClientCard({ client: c, index, onOpen }: { client: Client; index: number; onOpen: () => void }) {
  const active = c.leads_count > 0 || c.spravka_count > 0;
  const initial = (c.name || c.phone).trim()[0]?.toUpperCase() || "?";
  const cardRef = useRef<HTMLDivElement>(null);

  const [briefing, setBriefing] = useState<string | null>(c.ai_context_summary ?? null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState("");

  async function loadBriefing(e: React.MouseEvent) {
    e.stopPropagation(); // the whole card is clickable (onOpen) -- this must not also trigger that
    setBriefingLoading(true);
    setBriefingError("");
    try {
      const updated = await api.refreshClientContext(c.id);
      setBriefing(updated.ai_context_summary);
    } catch {
      setBriefingError("Не удалось построить бриф");
    } finally {
      setBriefingLoading(false);
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const rx = ((e.clientY - r.top) / r.height - 0.5) * -6;
    const ry = ((e.clientX - r.left) / r.width - 0.5) * 6;
    e.currentTarget.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
  }
  function onMouseLeave(e: React.MouseEvent<HTMLDivElement>) {
    e.currentTarget.style.transform = "";
  }

  return (
    <div
      ref={cardRef}
      onClick={onOpen}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="glass-panel stagger-item"
      style={{
        ["--i" as any]: index,
        padding: "18px 19px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 12,
        opacity: active ? 1 : 0.6, transition: "transform .12s ease, box-shadow .2s ease, opacity .2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 14, color: "#fff",
            background: active
              ? "linear-gradient(150deg, var(--v-violet-strong, #7a5cff), var(--v-violet, #5b3fc4))"
              : "var(--surface-08)",
          }}>
            {initial}
          </div>
          {c.priority && (
            <span
              title={PRIORITY_LABELS[c.priority]}
              style={{
                position: "absolute", top: -2, right: -2, width: 11, height: 11, borderRadius: "50%",
                background: PRIORITY_COLORS[c.priority].fg, boxShadow: "0 0 0 2px var(--v-bg, #140a2c)",
              }}
            />
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 14.5, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.name || c.phone}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{c.phone}</span>
            <CallButton phone={c.phone} size={16} clientId={c.id} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-soft)", background: "var(--surface-05)", padding: "3px 9px", borderRadius: 99 }}>{c.leads_count} лидов</span>
        {c.spravka_count > 0 && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)", padding: "3px 9px", borderRadius: 99 }}>{c.spravka_count} справок</span>
        )}
        {c.assigned_manager && (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--color-text-faint)", background: "var(--surface-05)", padding: "3px 9px", borderRadius: 99 }}>{c.assigned_manager}</span>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()} style={{ borderTop: "1px solid var(--color-hairline-soft)", paddingTop: 10 }}>
        {briefing ? (
          <div>
            <div style={{
              fontSize: 11, color: "var(--color-text-soft)", lineHeight: 1.5,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>
              ✨ {briefing}
            </div>
            <button
              onClick={loadBriefing} disabled={briefingLoading} className="press"
              style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v-accent)", background: "none", border: "none", padding: "4px 0 0", cursor: "pointer" }}
            >
              {briefingLoading ? "…" : "Обновить бриф"}
            </button>
          </div>
        ) : (
          <button
            onClick={loadBriefing} disabled={briefingLoading} className="press"
            style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)", border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}
          >
            {briefingLoading ? "Строю бриф…" : "✨ Бриф для нового менеджера"}
          </button>
        )}
        {briefingError && <div style={{ fontSize: 10.5, color: "var(--danger)", marginTop: 4 }}>{briefingError}</div>}
      </div>
    </div>
  );
}
