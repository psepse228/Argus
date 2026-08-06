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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Monday-first 6x7 grid covering the whole month plus leading/trailing days
 * from the adjacent months, so every row is a full week. */
function buildMonthGrid(viewDate: Date): Date[] {
  const monthStart = startOfMonth(viewDate);
  const firstWeekday = (monthStart.getDay() + 6) % 7; // 0=Monday
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells: Date[] = [];
  for (let i = 0; i < totalCells; i++) {
    cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), i - firstWeekday + 1));
  }
  return cells;
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
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

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

  function openAddFormFor(date: Date) {
    const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0);
    setNewAt(toLocalInputValue(local.toISOString()));
    setShowAddForm(true);
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

  async function saveMeetingNote(eventId: string) {
    if (!noteText.trim()) return;
    setActionError("");
    try {
      await api.addMeetingNote(eventId, noteText.trim());
      setNoteEditingId(null); setNoteText("");
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
            style={{ flex: "1 1 200px", padding: "9px 12px", borderRadius: 10, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
          />
          <input
            type="datetime-local" value={newAt} onChange={(e) => setNewAt(e.target.value)}
            style={{ padding: "9px 12px", borderRadius: 10, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
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
                      style={{ flex: "1 1 200px", padding: "8px 11px", borderRadius: 9, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
                    />
                    <input
                      type="datetime-local" value={editAt} onChange={(e) => setEditAt(e.target.value)}
                      style={{ padding: "8px 11px", borderRadius: 9, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
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
                    <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", background: "var(--surface-05)", padding: "3px 9px", borderRadius: 99, flexShrink: 0 }}>AI</span>
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionLabel>Календарь</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="press" style={{ ...ghostBtnStyle, padding: "5px 10px" }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", minWidth: 130, textAlign: "center", textTransform: "capitalize" }}>
            {viewDate.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
          </span>
          <button onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="press" style={{ ...ghostBtnStyle, padding: "5px 10px" }}>›</button>
          <button onClick={() => { const t = new Date(); setViewDate(t); setSelectedDay(t); setNoteEditingId(null); setNoteText(""); }} className="press" style={ghostBtnStyle}>Сегодня</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", textAlign: "center", padding: "2px 0" }}>{w}</div>
        ))}
        {buildMonthGrid(viewDate).map((date, i) => {
          const inMonth = date.getMonth() === viewDate.getMonth();
          const isToday = sameDay(date, new Date());
          const isSelected = sameDay(date, selectedDay);
          const dayEvents = confirmed.filter((ev) => sameDay(new Date(ev.event_at), date));
          const visible = dayEvents.slice(0, 3);
          const overflow = dayEvents.length - visible.length;
          return (
            <div
              key={i}
              onClick={() => { setSelectedDay(date); setNoteEditingId(null); setNoteText(""); }}
              onDoubleClick={() => openAddFormFor(date)}
              className="press"
              style={{
                minHeight: 84, borderRadius: 10, padding: "6px 7px", cursor: "pointer",
                background: isSelected ? "var(--v-accent-tint)" : "var(--surface-02)",
                border: isSelected ? "1px solid var(--v-accent)" : "1px solid var(--color-hairline-soft)",
                opacity: inMonth ? 1 : 0.4,
                display: "flex", flexDirection: "column", gap: 3,
              }}
            >
              <span style={{
                fontSize: 11.5, fontWeight: isToday ? 800 : 600, color: isToday ? "var(--v-accent)" : "var(--color-text)",
                width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "50%", background: isToday ? "var(--v-accent-tint)" : "transparent",
              }}>
                {date.getDate()}
              </span>
              {visible.map((ev) => (
                <div key={ev.id} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 6, background: "var(--surface-05)", color: "var(--color-text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fmtTime(ev.event_at)} {ev.title}
                </div>
              ))}
              {overflow > 0 && <div style={{ fontSize: 10, color: "var(--color-text-faint)", padding: "0 5px" }}>+{overflow}</div>}
            </div>
          );
        })}
      </div>

      <SectionLabel>
        {selectedDay.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" })}
      </SectionLabel>
      {(() => {
        const dayEvents = confirmed.filter((ev) => sameDay(new Date(ev.event_at), selectedDay));
        if (dayEvents.length === 0) {
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Событий нет.</span>
              <button onClick={() => openAddFormFor(selectedDay)} className="press" style={ghostBtnStyle}>+ Добавить на этот день</button>
            </div>
          );
        }
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dayEvents.map((ev) => {
              const needsNote = ev.status === "confirmed" && new Date(ev.event_at) < new Date() && !ev.has_meeting_note;
              return (
                <div key={ev.id} className="glass-panel" style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text)" }}>{ev.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>
                        {fmtTime(ev.event_at)}
                        {ev.clients && <> · <span onClick={() => ev.client_id && onOpenClient?.(ev.client_id)} className={ev.client_id ? "press" : undefined} style={{ cursor: ev.client_id ? "pointer" : "default", color: ev.client_id ? "var(--v-accent)" : undefined }}>{ev.clients.name || ev.clients.phone}</span></>}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>{ev.source === "monitor" ? "из переписки" : "вручную"}</span>
                  </div>
                  {needsNote && (
                    noteEditingId === ev.id ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Как прошло?"
                          style={{ flex: 1, padding: "7px 10px", borderRadius: 8, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 12.5 }}
                        />
                        <button onClick={() => saveMeetingNote(ev.id)} className="press" style={primaryBtnStyle}>Сохранить</button>
                        <button onClick={() => { setNoteEditingId(null); setNoteText(""); }} className="press" style={ghostBtnStyle}>Отмена</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setNoteEditingId(ev.id); setNoteText(""); }}
                        className="press" style={{ ...ghostBtnStyle, alignSelf: "flex-start" }}
                      >
                        Как прошло? →
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
