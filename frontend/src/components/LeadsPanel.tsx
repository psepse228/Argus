"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Lead } from "@/lib/types";

const STAGES = [
  { key: "unsorted", label: "Неразобранное" },
  { key: "matching", label: "Подбор" },
  { key: "meeting_scheduled", label: "Встреча назначена" },
  { key: "meeting_held", label: "Встреча проведена" },
  { key: "reserved", label: "Бронь" },
  { key: "paid_reservation", label: "Платная бронь" },
];

export function LeadsPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState("");

  useEffect(() => { api.leads().then(setLeads); }, []);

  async function move(id: string, stage: string) {
    setError("");
    try {
      await api.updateLeadStage(id, stage);
      setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, stage } : l)));
    } catch (e: any) {
      setError(`Не удалось изменить стадию: ${e.message}`);
    }
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
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(180px, 1fr))`, gap: 12, alignItems: "start" }}>
        {STAGES.map((st) => {
          const inStage = leads.filter((l) => l.stage === st.key);
          return (
            <div key={st.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{st.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-faint)", background: "rgba(255,255,255,.05)", borderRadius: 99, padding: "1px 8px" }}>{inStage.length}</span>
              </div>
              {inStage.map((l) => (
                <div key={l.id} className="glass-panel" style={{ padding: "12px 13px", borderRadius: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>{l.phone}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{l.buy_intent || l.source || "—"}</div>
                  <select
                    value={l.stage}
                    onChange={(e) => move(l.id, e.target.value)}
                    style={{ fontSize: 11, padding: "5px 8px", borderRadius: 8, background: "rgba(255,255,255,.05)", border: "1px solid var(--color-hairline-soft)", color: "var(--color-text-soft)" }}
                  >
                    {STAGES.map((s2) => <option key={s2.key} value={s2.key}>{s2.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
