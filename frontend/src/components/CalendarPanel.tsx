"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CalendarEvent } from "@/lib/types";
import { Skeleton } from "./Skeleton";
import { SectionLabel } from "./SectionLabel";

const primaryBtnStyle: React.CSSProperties = { padding: "6px 12px", borderRadius: 99, background: "var(--v-accent)", color: "var(--v-text-on-accent)", fontSize: 11.5, fontWeight: 700, border: "none", cursor: "pointer" };
const ghostBtnStyle: React.CSSProperties = { padding: "6px 12px", borderRadius: 99, background: "transparent", color: "var(--color-text-soft)", fontSize: 11.5, fontWeight: 600, border: "1px solid var(--color-hairline)", cursor: "pointer" };

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// datetime-local expects "YYYY-MM-DDTHH:mm" in local time, not the raw ISO
// (which is UTC and has seconds/timezone) -- this is the standard
// local-timezone conversion for that input type.
function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

/** Day 4: fed by the AI monitor's proposals (parsed from Telegram messages,
 * e.g. "приеду в среду") and manual entries. Proposals sit in their own
 * review queue -- same review-after posture as справки, nothing here writes
 * itself in without a manager's click. */
export function CalendarPanel({ onOpenClient }: { onOpenClient?: (clientId: string) => void }) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [actionError, setActionError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAt, setEditAt] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAt, setNewAt] = useState("");

  async function refresh() {
    const all = await api.calendarEvents();
    setEvents(all);
  }
  useEffect(() => { refresh().catch(() => setEvents([])); }, []);

  async function confirm(ev: CalendarEvent) {
    setActionError("");
    try {
      if (editingId === ev.id) {
        await api.updateCalendarEvent(ev.id, { title: editTitle, event_at: new Date(editAt).toISOString() });
      }
      await api.confirmCalendarEvent(ev.id);
      setEditingId(null);
      await refresh();
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  async function dismiss(id: string) {
    setActionError("");
    try {
      await api.dismissCalendarEvent(id);
      await refresh();
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  function startEdit(ev: CalendarEvent) {
    setEditingId(ev.id);
    setEditTitle(ev.title);
    setEditAt(toLocalInputValue(ev.event_at));
  }

  async function addManual() {
    if (!newTitle.trim() || !newAt) return;
    setActionError("");
    try {
      await api.createCalendarEvent({ title: newTitle.trim(), event_at: new Date(newAt).toISOString() });
      setNewTitle(""); setNewAt(""); setShowAddForm(false);
      await refresh();
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  if (events === null) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 16px", color: "var(--color-text)" }}>Календарь</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={56} />)}</div>
      </div>
    );
  }

  const proposed = events.filter((e) => e.status === "proposed").sort((a, b) => a.event_at.localeCompare(b.event_at));
  const confirmed = events.filter((e) => e.status === "confirmed").sort((a, b) => a.event_at.localeCompare(b.event_at));

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Календарь</h1>
          <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: 0 }}>Встречи и визиты — из переписки (AI) и вручную</p>
        </div>
        <button onClick={() => setShowAddForm((v) => !v)} className="press" style={primaryBtnStyle}>+ Добавить событие</button>
      </div>

      {actionError && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{actionError}</div>}

      {showAddForm && (
        <div className="glass-panel" style={{ padding: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Название события"
            style={{ flex: "1 1 200px", padding: "9px 12px", borderRadius: 10, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
          />
          <input
            type="datetime-local" value={newAt} onChange={(e) => setNewAt(e.target.value)}
            style={{ padding: "9px 12px", borderRadius: 10, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
          />
          <button onClick={addManual} className="press" style={primaryBtnStyle}>Сохранить</button>
          <button onClick={() => setShowAddForm(false)} className="press" style={ghostBtnStyle}>Отмена</button>
        </div>
      )}

      {proposed.length > 0 && (
        <>
          <SectionLabel>Требуют подтверждения — {proposed.length}</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {proposed.map((ev) => (
              <div key={ev.id} className="glass-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {editingId === ev.id ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <input
                      value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                      style={{ flex: "1 1 200px", padding: "8px 11px", borderRadius: 9, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
                    />
                    <input
                      type="datetime-local" value={editAt} onChange={(e) => setEditAt(e.target.value)}
                      style={{ padding: "8px 11px", borderRadius: 9, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
                    />
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>{ev.title}</div>
                      <div style={{ fontSize: 12, color: "var(--v-accent)", fontWeight: 600, marginTop: 2 }}>{fmt(ev.event_at)}</div>
                      {ev.note && <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 4 }}>{ev.note}</div>}
                      {ev.clients && (
                        <div
                          onClick={() => ev.client_id && onOpenClient?.(ev.client_id)}
                          className={ev.client_id ? "press" : undefined}
                          style={{ fontSize: 12, color: "var(--color-text-soft)", marginTop: 4, cursor: ev.client_id ? "pointer" : "default" }}
                        >
                          {ev.clients.name || ev.clients.phone}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", background: "rgba(255,255,255,.05)", padding: "3px 9px", borderRadius: 99, flexShrink: 0 }}>AI</span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 7 }}>
                  <button onClick={() => confirm(ev)} className="press" style={primaryBtnStyle}>Подтвердить</button>
                  {editingId === ev.id ? (
                    <button onClick={() => setEditingId(null)} className="press" style={ghostBtnStyle}>Отмена</button>
                  ) : (
                    <button onClick={() => startEdit(ev)} className="press" style={ghostBtnStyle}>✎ Изменить</button>
                  )}
                  <button onClick={() => dismiss(ev.id)} className="press" style={{ ...ghostBtnStyle, marginLeft: "auto" }}>Отклонить</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionLabel>Ближайшие события</SectionLabel>
      {confirmed.length === 0 ? (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет подтверждённых событий.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {confirmed.map((ev) => (
            <div key={ev.id} className="glass-panel" style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text)" }}>{ev.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>
                  {fmt(ev.event_at)}
                  {ev.clients && <> · <span onClick={() => ev.client_id && onOpenClient?.(ev.client_id)} className={ev.client_id ? "press" : undefined} style={{ cursor: ev.client_id ? "pointer" : "default", color: ev.client_id ? "var(--v-accent)" : undefined }}>{ev.clients.name || ev.clients.phone}</span></>}
                </div>
              </div>
              <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>{ev.source === "monitor" ? "из переписки" : "вручную"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
