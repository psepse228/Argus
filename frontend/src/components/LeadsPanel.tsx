"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Lead } from "@/lib/types";
import { Dropdown } from "./Dropdown";
import { Skeleton } from "./Skeleton";

// Mirrors backend/app/routers/leads.py::STALE_DAYS -- only used for the tooltip copy.
const STALE_DAYS = 3;

// Distinct accent per stage (not just one repeated color) so the funnel
// reads left-to-right at a glance -- grey (untouched) through violet/sky/
// amber to the accent and success colors as a deal gets closer to done.
const STAGES = [
  { key: "unsorted", label: "Неразобранное", color: "var(--color-text-faint)" },
  { key: "matching", label: "Подбор", color: "var(--v-violet-strong, #7a5cff)" },
  { key: "meeting_scheduled", label: "Встреча назначена", color: "#7dd3fc" },
  { key: "meeting_held", label: "Встреча проведена", color: "var(--warning)" },
  { key: "reserved", label: "Бронь", color: "var(--v-accent)" },
  { key: "paid_reservation", label: "Платная бронь", color: "var(--success)" },
];

export function LeadsPanel({ onOpenClient }: { onOpenClient: (clientId: string) => void }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    api.leads().then(setLeads).catch((e) => { setError(`Не удалось загрузить лидов: ${e.message}`); setLeads([]); });
  }, []);

  async function move(id: string, stage: string) {
    setError("");
    try {
      await api.updateLeadStage(id, stage);
      setLeads((cur) => cur && cur.map((l) => (l.id === id ? { ...l, stage } : l)));
    } catch (e: any) {
      setError(`Не удалось изменить стадию: ${e.message}`);
    }
  }

  async function openClient(id: string) {
    setOpeningId(id);
    setError("");
    try {
      const { client_id } = await api.openLeadClient(id);
      onOpenClient(client_id);
    } catch (e: any) {
      setError(`Не удалось открыть карточку клиента: ${e.message}`);
    } finally {
      setOpeningId(null);
    }
  }

  if (leads === null) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Лиды</h1>
        <Skeleton width={160} height={13} style={{ margin: "0 0 18px" }} />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(180px, 1fr))`, gap: 10 }}>
          {STAGES.map((st) => (
            <div key={st.key} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 10px" }}>
              <Skeleton height={13} width="70%" />
              <div className="glass-panel" style={{ padding: "12px 13px", borderRadius: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton height={13} width="60%" />
                <Skeleton height={11} width="80%" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Лиды</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 18px" }}>Воронка продаж — {leads.length} лидов</p>
      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>{error}</div>}
      {leads.length === 0 && (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>
          Пока нет лидов в базе — реальные лиды из Facebook-рекламы ещё не загружены.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(180px, 1fr))`, gap: 0, alignItems: "start" }}>
        {STAGES.map((st, colIdx) => {
          const inStage = leads.filter((l) => l.stage === st.key);
          return (
            <div
              key={st.key}
              style={{
                display: "flex", flexDirection: "column", gap: 10, padding: "0 10px 0 10px",
                borderRight: colIdx < STAGES.length - 1 ? "1px solid var(--color-hairline-soft)" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 2px 8px", borderBottom: `2px solid color-mix(in srgb, ${st.color} 55%, transparent)` }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: st.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)", flex: 1 }}>{st.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: `color-mix(in srgb, ${st.color} 16%, transparent)`, borderRadius: 99, padding: "1px 8px" }}>{inStage.length}</span>
              </div>
              {inStage.map((l, i) => (
                <div
                  key={l.id}
                  className="glass-panel stagger-item"
                  style={{
                    ["--i" as any]: i,
                    padding: "12px 13px", borderRadius: 14, display: "flex", flexDirection: "column", gap: 8,
                    borderLeft: `3px solid ${st.color}`,
                    boxShadow: l.is_stale ? "0 0 0 1px color-mix(in srgb, var(--warning) 55%, transparent)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>{l.phone}</div>
                    {l.is_stale && (
                      <span title={`Без движения ${STALE_DAYS}+ дней`} style={{ fontSize: 9.5, fontWeight: 700, color: "var(--warning)", background: "var(--warning-tint)", borderRadius: 99, padding: "2px 7px", whiteSpace: "nowrap" }}>
                        Простаивает
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{l.buy_intent || l.source || "—"}</div>
                  {l.assigned_manager && (
                    <div style={{ fontSize: 10.5, color: "var(--v-accent)", fontWeight: 600 }}>{l.assigned_manager}</div>
                  )}
                  <Dropdown
                    value={l.stage}
                    onChange={(v) => move(l.id, v)}
                    options={STAGES.map((s2) => ({ value: s2.key, label: s2.label }))}
                    style={{ fontSize: 11 }}
                  />
                  <button
                    className="press"
                    disabled={openingId === l.id}
                    onClick={() => openClient(l.id)}
                    style={{
                      fontSize: 11, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)",
                      border: "none", borderRadius: 8, padding: "7px 0", cursor: "pointer",
                      opacity: openingId === l.id ? 0.6 : 1,
                    }}
                  >
                    {openingId === l.id ? "…" : "Открыть карточку клиента →"}
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
