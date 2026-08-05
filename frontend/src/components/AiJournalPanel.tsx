"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AiEvent, Client } from "@/lib/types";
import { Dropdown } from "./Dropdown";
import { Skeleton } from "./Skeleton";

const KIND_LABELS: Record<AiEvent["kind"], string> = {
  coaching_tip: "Совет по продаже",
  event_proposed: "Предложено событие",
  draft_sent: "Отправлен черновик",
  context_summary: "Обновлён контекст",
  client_segments: "AI-сводка клиентов",
};

const KIND_COLORS: Record<AiEvent["kind"], string> = {
  coaching_tip: "var(--v-accent)",
  event_proposed: "#7dd3fc",
  draft_sent: "var(--success)",
  context_summary: "var(--v-violet-strong, #7a5cff)",
  client_segments: "var(--warning)",
};

/** "Журнал AI" -- a permanent, role-scoped history of what Argus Brain has
 * actually done (see docs/superpowers/specs/2026-08-06-ai-events-journal-design.md).
 * The backend already scopes rows by role (boss sees the whole tenant, a
 * manager only sees their own manager_email) -- this component just renders
 * whatever it's given, no client-side role filtering needed. */
export function AiJournalPanel({ onOpenClient }: { onOpenClient: (clientId: string) => void }) {
  const [events, setEvents] = useState<AiEvent[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [kindFilter, setKindFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.clients().then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    setEvents(null);
    api.aiEvents({ kind: kindFilter || undefined, client_id: clientFilter || undefined })
      .then(setEvents)
      .catch((e: any) => { setError(`Не удалось загрузить журнал: ${e.message}`); setEvents([]); });
  }, [kindFilter, clientFilter]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Журнал AI</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 18px" }}>Что Argus Brain сделал и что с этим решили</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Dropdown
          value={kindFilter} onChange={setKindFilter} placeholder="Все типы"
          options={[
            { value: "", label: "Все типы" },
            ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
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

      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {events === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((i) => <Skeleton key={i} height={52} />)}
        </div>
      ) : events.length === 0 ? (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет записей — журнал наполняется по мере работы AI.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {events.map((e) => (
            <div key={e.id} className="glass-panel" style={{ padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: KIND_COLORS[e.kind], flexShrink: 0, marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: KIND_COLORS[e.kind], textTransform: "uppercase", letterSpacing: ".03em" }}>
                    {KIND_LABELS[e.kind]}
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
      )}
    </div>
  );
}
