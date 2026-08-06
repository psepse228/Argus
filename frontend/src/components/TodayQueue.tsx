"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DailyBriefingItem } from "@/lib/types";

/** Argus Brain Phase 2b: this used to build its own list from four raw
 * endpoints (leads/справки/clients/calendar) with fixed client-side rules.
 * Now it's a thin fetch-and-render of the cached, AI-prioritized
 * daily-briefing endpoint (backend/app/routers/daily_briefing.py) --
 * gather_manager_context supplies the deterministic facts, generate_daily_briefing
 * ranks/phrases them, cached per manager per day so this never triggers a
 * fresh OpenAI call on every page load. */
export function TodayQueue({ isBoss }: { isBoss: boolean }) {
  const [items, setItems] = useState<DailyBriefingItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dailyBriefing().then(setItems).catch((e: any) => { setError(`Не удалось загрузить список: ${e.message}`); setItems([]); });
  }, []);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      setItems(await api.refreshDailyBriefing());
    } catch (e: any) {
      setError(`Не удалось обновить: ${e.message}`);
    } finally {
      setRefreshing(false);
    }
  }

  if (items === null) return null;

  return (
    <div className="glass-panel" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)" }}>На сегодня</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {items.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)", borderRadius: 99, padding: "2px 9px" }}>
              {items.length}
            </span>
          )}
          <button
            onClick={refresh} disabled={refreshing} className="press"
            style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-faint)", background: "none", border: "none", cursor: "pointer", opacity: refreshing ? 0.5 : 1 }}
          >
            {refreshing ? "…" : "Обновить"}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-faint)", margin: "0 0 12px" }}>
        AI-приоритеты на сегодня — из лидов, справок, календаря и звонков.
      </p>
      {error && <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пусто — ничего срочного нет.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "12px 20px" }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, paddingBottom: 10, borderBottom: "1px solid var(--color-hairline-soft)", minWidth: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--v-accent)", flexShrink: 0, marginTop: 5 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
