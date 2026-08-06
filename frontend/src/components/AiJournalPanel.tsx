"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AiEvent, BrainItem, Client } from "@/lib/types";
import { Dropdown } from "./Dropdown";
import { Skeleton } from "./Skeleton";

const ITEM_KIND_LABELS: Record<BrainItem["kind"], string> = {
  stale_lead: "Лид требует внимания",
  missing_note: "Нет заметки о встрече",
  pending_spravka_aging: "Справка давно ждёт",
  coaching_tip: "Совет по продаже",
  event_proposed: "Предложено событие",
};

const EVENT_KIND_LABELS: Record<AiEvent["kind"], string> = {
  coaching_tip: "Совет по продаже",
  event_proposed: "Предложено событие",
  draft_sent: "Отправлен черновик",
  context_summary: "Обновлён контекст",
  client_segments: "AI-сводка клиентов",
};

const EVENT_KIND_COLORS: Record<AiEvent["kind"], string> = {
  coaching_tip: "var(--v-accent)",
  event_proposed: "#7dd3fc",
  draft_sent: "var(--success)",
  context_summary: "var(--v-violet-strong, #7a5cff)",
  client_segments: "var(--warning)",
};

/** "Argus Brain" -- what Журнал AI (a read-only log) evolved into
 * (2026-08-06 brainstorm): the live, actionable half of Argus Brain.
 * "Открыто" is brain_items -- real, dismissable/confirmable/snoozable
 * queue items with stable identity across regenerations (see
 * backend/app/ai/brain_items.py). "История" is the original ai_events
 * log, unchanged -- a permanent audit trail kept for transparency. */
export function AiJournalPanel({ onOpenClient }: { onOpenClient: (clientId: string) => void }) {
  const [tab, setTab] = useState<"open" | "history">("open");

  const [items, setItems] = useState<BrainItem[] | null>(null);
  const [itemsError, setItemsError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [events, setEvents] = useState<AiEvent[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [kindFilter, setKindFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [historyError, setHistoryError] = useState("");

  function loadItems() {
    setItemsError("");
    api.brainItems().then(setItems).catch((e: any) => { setItemsError(`Не удалось загрузить: ${e.message}`); setItems(null); });
  }

  useEffect(() => { loadItems(); }, []);

  useEffect(() => {
    api.clients().then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== "history") return;
    setEvents(null);
    setHistoryError("");
    api.aiEvents({ kind: kindFilter || undefined, client_id: clientFilter || undefined })
      .then(setEvents)
      .catch((e: any) => { setHistoryError(`Не удалось загрузить журнал: ${e.message}`); setEvents(null); });
  }, [tab, kindFilter, clientFilter]);

  async function act(id: string, action: "confirm" | "dismiss" | "snooze") {
    setItemsError("");
    setBusyId(id);
    try {
      if (action === "confirm") await api.confirmBrainItem(id);
      else if (action === "dismiss") await api.dismissBrainItem(id);
      else await api.snoozeBrainItem(id, 1);
      setItems((cur) => cur && cur.filter((it) => it.id !== id));
    } catch (e: any) {
      setItemsError(`Не удалось обновить: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Argus Brain</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 18px" }}>Что Argus Brain сейчас видит и что уже сделал</p>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "var(--surface-03)", borderRadius: 12, padding: 4, width: "fit-content" }}>
        {(["open", "history"] as const).map((t) => (
          <div
            key={t}
            onClick={() => setTab(t)}
            className="press"
            style={{
              fontSize: 12.5, fontWeight: 700, padding: "7px 16px", borderRadius: 9, cursor: "pointer",
              color: tab === t ? "var(--v-text-on-accent)" : "var(--color-text-faint)",
              background: tab === t ? "var(--v-accent)" : "transparent",
            }}
          >
            {t === "open" ? "Открыто" : "История"}
            {t === "open" && items && items.length > 0 && (
              <span style={{ marginLeft: 7, opacity: 0.85 }}>{items.length}</span>
            )}
          </div>
        ))}
      </div>

      {tab === "open" ? (
        <>
          {itemsError && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--danger)", marginBottom: 14 }}>
              {itemsError}
              <span onClick={loadItems} className="press" style={{ cursor: "pointer", fontWeight: 700, textDecoration: "underline" }}>Повторить</span>
            </div>
          )}
          {items === null && !itemsError ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2, 3].map((i) => <Skeleton key={i} height={88} />)}
            </div>
          ) : items && items.length === 0 && !itemsError ? (
            <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Открытых дел нет — Argus Brain ничего срочного не видит.</div>
          ) : items ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((it) => (
                <div key={it.id} className="glass-panel" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, opacity: busyId === it.id ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 99, flexShrink: 0, marginTop: 5,
                      background: it.priority === "high" ? "var(--danger)" : "var(--v-accent)",
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em",
                          color: it.priority === "high" ? "var(--danger)" : "var(--v-accent)",
                        }}>
                          {ITEM_KIND_LABELS[it.kind]}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginTop: 4 }}>{it.summary}</div>
                      {it.detail && <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 2 }}>{it.detail}</div>}
                      <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span>{new Date(it.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        {it.clients && it.client_id && (
                          <span onClick={() => onOpenClient(it.client_id!)} style={{ color: "var(--v-accent)", cursor: "pointer", fontWeight: 600 }}>
                            {it.clients.name || it.clients.phone} →
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 7 }}>
                    <button onClick={() => act(it.id, "confirm")} disabled={busyId === it.id} className="press" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v-text-on-accent)", background: "var(--v-accent)", border: "none", borderRadius: 8, padding: "6px 11px", cursor: "pointer" }}>Сделано</button>
                    <button onClick={() => act(it.id, "snooze")} disabled={busyId === it.id} className="press" title="Отложить на 1 день" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-soft)", background: "transparent", border: "1px solid var(--color-hairline)", borderRadius: 8, padding: "6px 11px", cursor: "pointer" }}>Отложить</button>
                    <button onClick={() => act(it.id, "dismiss")} disabled={busyId === it.id} className="press" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-faint)", background: "transparent", border: "none", borderRadius: 8, padding: "6px 11px", cursor: "pointer", marginLeft: "auto" }}>Скрыть</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <Dropdown
              value={kindFilter} onChange={setKindFilter} placeholder="Все типы"
              options={[
                { value: "", label: "Все типы" },
                ...Object.entries(EVENT_KIND_LABELS).map(([value, label]) => ({ value, label })),
              ]}
              style={{ width: 220 }}
            />
            <Dropdown
              value={clientFilter} onChange={setClientFilter} placeholder="Все клиенты"
              options={[
                { value: "", label: "Все клиенты" },
                ...clients.map((c) => ({ value: c.id, label: c.name || c.phone })),
              ]}
              style={{ width: 220 }}
            />
          </div>

          {historyError && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>{historyError}</div>}

          {events === null && !historyError ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2, 3].map((i) => <Skeleton key={i} height={52} />)}
            </div>
          ) : events && events.length === 0 ? (
            <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет записей — журнал наполняется по мере работы AI.</div>
          ) : events ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {events.map((e) => (
                <div key={e.id} className="glass-panel" style={{ padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: EVENT_KIND_COLORS[e.kind], flexShrink: 0, marginTop: 5 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: EVENT_KIND_COLORS[e.kind], textTransform: "uppercase", letterSpacing: ".03em" }}>
                        {EVENT_KIND_LABELS[e.kind]}
                      </span>
                      {e.outcome && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "2px 8px",
                          background: e.outcome === "confirmed" ? "var(--success-tint)" : "var(--surface-05)",
                          color: e.outcome === "confirmed" ? "var(--success)" : "var(--color-text-faint)",
                        }}>
                          {e.outcome === "confirmed" ? "Подтверждено" : "Отклонено"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--color-text)", marginTop: 4 }}>{e.summary}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4, display: "flex", gap: 10 }}>
                      <span>{new Date(e.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      {e.clients && (
                        <span onClick={() => onOpenClient(e.client_id!)} style={{ color: "var(--v-accent)", cursor: "pointer", fontWeight: 600 }}>
                          {e.clients.name || e.clients.phone} →
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
