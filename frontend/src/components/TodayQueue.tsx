"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { BrainItem } from "@/lib/types";
import { Skeleton } from "./Skeleton";

const MAX_ITEMS = 8;

/** Argus Brain unification (2026-08 UI audit): this used to read its own
 * cached daily-briefing ranking (backend/app/routers/daily_briefing.py) --
 * a separate AI pass that could silently disagree with the Argus Brain
 * screen's own open-items count (a UI audit caught exactly this: both could
 * show "nothing urgent" at once while real approvals sat open). Now it's a
 * thin fetch-and-render of the SAME brain_items feed the Argus Brain screen
 * and topbar indicator read -- one source of truth, and items are now real
 * (confirm/snooze/dismiss), not just a read-only suggestion list. */
export function TodayQueue() {
  const [items, setItems] = useState<BrainItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setError("");
    api.brainItems().then(setItems).catch((e: any) => setError(`Не удалось загрузить список: ${e.message}`));
  }

  useEffect(() => { load(); }, []);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      setItems(await api.brainItems(true));
    } catch (e: any) {
      setError(`Не удалось обновить: ${e.message}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function act(id: string, action: "confirm" | "dismiss" | "snooze") {
    setBusyId(id);
    setError("");
    try {
      if (action === "confirm") await api.confirmBrainItem(id);
      else if (action === "dismiss") await api.dismissBrainItem(id);
      else await api.snoozeBrainItem(id, 1);
      setItems((cur) => cur && cur.filter((it) => it.id !== id));
    } catch (e: any) {
      setError(`Не удалось обновить: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  if (items === null && !error) {
    return (
      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)" }}>На сегодня</div>
        </div>
        <p style={{ fontSize: 11, color: "var(--color-text-faint)", margin: "0 0 12px" }}>
          Argus Brain — те же открытые дела, что и в разделе Argus Brain.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={32} />)}
        </div>
      </div>
    );
  }

  const visible = (items ?? []).slice(0, MAX_ITEMS);

  return (
    <div className="glass-panel" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)" }}>На сегодня</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!error && visible.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)", borderRadius: 99, padding: "2px 9px" }}>
              {items?.length ?? 0}
            </span>
          )}
          <button
            onClick={refresh} disabled={refreshing} className="press" aria-label="Обновить список задач"
            style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-faint)", background: "none", border: "none", cursor: "pointer", opacity: refreshing ? 0.5 : 1 }}
          >
            {refreshing ? "…" : "Обновить"}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-faint)", margin: "0 0 12px" }}>
        Argus Brain — те же открытые дела, что и в разделе Argus Brain.
      </p>
      {error ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div>
          <button onClick={load} className="press" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--v-accent)", background: "none", border: "none", cursor: "pointer" }}>
            Повторить
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пусто — ничего срочного нет.</div>
      ) : (
        <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "12px 20px" }}>
          {visible.map((it) => (
            <div key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, paddingBottom: 10, borderBottom: "1px solid var(--color-hairline-soft)", minWidth: 0, opacity: busyId === it.id ? 0.5 : 1 }}>
              <span style={{
                width: 7, height: 7, borderRadius: 99, flexShrink: 0, marginTop: 5,
                background: it.priority === "high" ? "var(--danger)" : "var(--v-accent)",
              }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.summary}</div>
                {it.detail && (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.detail}</div>
                )}
                <div style={{ display: "flex", gap: 12, marginTop: 5 }}>
                  <button
                    onClick={() => act(it.id, "confirm")} disabled={busyId === it.id} className="press"
                    style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v-accent)", background: "none", border: "none", padding: "2px 4px", marginLeft: -4, cursor: "pointer" }}
                  >
                    Сделано
                  </button>
                  <button
                    onClick={() => act(it.id, "dismiss")} disabled={busyId === it.id} className="press"
                    style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-faint)", background: "none", border: "none", padding: "2px 4px", marginLeft: -4, cursor: "pointer" }}
                  >
                    Скрыть
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {items && items.length > MAX_ITEMS && (
          <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 10 }}>
            Ещё {items.length - MAX_ITEMS} — смотрите полный список в разделе Argus Brain
          </div>
        )}
        </>
      )}
    </div>
  );
}
