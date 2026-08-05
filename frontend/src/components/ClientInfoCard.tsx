"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { ClientDetail, PRIORITY_COLORS, PRIORITY_LABELS, Priority, STAGE_COLORS, STATUS_LABELS, PLAN_LABELS } from "@/lib/types";
import { DealTimeline } from "./DealTimeline";
import { Skeleton } from "./Skeleton";
import { CallButton } from "./CallButton";

function clientStage(detail: ClientDetail): { label: string; color: string } {
  if (detail.spravka_requests.some((s) => s.status === "approved" || s.status === "auto_approved")) {
    return { label: "Сделка одобрена", color: "var(--success)" };
  }
  if (detail.spravka_requests.some((s) => s.status === "pending")) {
    return { label: "Справка на согласовании", color: "var(--warning)" };
  }
  const lead = detail.leads[0];
  if (lead) return { label: STATUS_LABELS[lead.stage] || lead.stage, color: STAGE_COLORS[lead.stage] || "var(--color-text-faint)" };
  return { label: "Новый клиент", color: "var(--color-text-faint)" };
}

/** A quick look at a client -- profile, stage, priority, apartments, history
 * -- with no chat and no справка button. Opens as a dialog over Клиенты
 * (same idea as the real Macro CRM's "Редактирование заявки" modal --
 * fields + event feed side by side, no page navigation), not a full-panel
 * swap. Actually working a client (chat, справка, Cortège+) is a deliberate
 * step into Мастерская via the button below. */
export function ClientInfoCard({
  clientId, onClose, onOpenWorkspace,
}: {
  clientId: string;
  onClose: () => void;
  onOpenWorkspace: (clientId: string) => void;
}) {
  const [selected, setSelected] = useState<ClientDetail | null>(null);
  const [savingFollowup, setSavingFollowup] = useState(false);
  const [opening, setOpening] = useState(false);
  const [refreshingContext, setRefreshingContext] = useState(false);
  const [contextError, setContextError] = useState("");

  useEffect(() => {
    setSelected(null);
    api.clientDetail(clientId).then(setSelected);
  }, [clientId]);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function saveFollowup(patch: { priority?: Priority | null; next_followup_at?: string | null; next_followup_note?: string | null }) {
    if (!selected) return;
    setSavingFollowup(true);
    try {
      await api.updateClientFollowup(selected.id, patch);
      setSelected((cur) => cur && { ...cur, ...patch });
    } finally {
      setSavingFollowup(false);
    }
  }

  async function refreshContext() {
    if (!selected) return;
    setRefreshingContext(true);
    setContextError("");
    try {
      const updated = await api.refreshClientContext(selected.id);
      setSelected((cur) => cur && { ...cur, ai_context_summary: updated.ai_context_summary, ai_context_generated_at: updated.ai_context_generated_at });
    } catch (e: any) {
      setContextError(e.message);
    } finally {
      setRefreshingContext(false);
    }
  }

  async function openWorkspace() {
    setOpening(true);
    try {
      await api.pinToWorkspace(clientId);
      onOpenWorkspace(clientId);
    } finally {
      setOpening(false);
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel section-enter"
        style={{ width: 860, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 20px", borderBottom: "1px solid var(--color-hairline-soft)", flexShrink: 0 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>
            {selected ? (selected.name || selected.phone) : "Клиент"}
          </div>
          <div onClick={onClose} className="press" style={{ cursor: "pointer", color: "var(--color-text-faint)", fontSize: 15, fontWeight: 700, padding: 4 }}>✕</div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <div style={{ width: 340, flexShrink: 0, padding: "18px 20px", overflowY: "auto", borderRight: "1px solid var(--color-hairline-soft)", display: "flex", flexDirection: "column", gap: 14 }}>
            {!selected ? (
              <>
                <Skeleton height={14} width="50%" />
                <Skeleton height={12} width="70%" />
                <Skeleton height={60} />
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>{selected.phone}</span>
                  <CallButton phone={selected.phone} size={22} clientId={selected.id} />
                </div>

                {(() => {
                  const stage = clientStage(selected);
                  return (
                    <span style={{
                      display: "inline-flex", alignSelf: "flex-start", fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 99,
                      color: stage.color, background: `color-mix(in srgb, ${stage.color} 16%, transparent)`,
                    }}>
                      {stage.label}
                    </span>
                  );
                })()}

                <div style={{ paddingTop: 4, borderTop: "1px solid var(--color-hairline-soft)" }}>
                  <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 8 }}>Приоритет</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["hot", "warm", "cold"] as Priority[]).map((p) => {
                      const active = selected.priority === p;
                      const c = PRIORITY_COLORS[p];
                      return (
                        <div
                          key={p}
                          onClick={() => saveFollowup({ priority: active ? null : p })}
                          className="press"
                          style={{
                            fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 99, cursor: "pointer",
                            color: active ? c.fg : "var(--color-text-faint)",
                            background: active ? c.bg : "var(--surface-04)",
                            border: active ? `1px solid color-mix(in srgb, ${c.fg} 45%, transparent)` : "1px solid transparent",
                            opacity: savingFollowup ? 0.6 : 1,
                          }}
                        >
                          {PRIORITY_LABELS[p]}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ paddingTop: 4, borderTop: "1px solid var(--color-hairline-soft)" }}>
                  <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 8 }}>Следующий контакт</div>
                  <input
                    type="date"
                    defaultValue={selected.next_followup_at || ""}
                    onBlur={(e) => saveFollowup({ next_followup_at: e.target.value || null })}
                    style={{ width: "100%", background: "var(--surface-04)", border: "1px solid var(--color-hairline)", borderRadius: 8, color: "var(--color-text)", fontSize: 12, padding: "6px 8px", marginBottom: 6 }}
                  />
                  <textarea
                    placeholder="Заметка после звонка…"
                    defaultValue={selected.next_followup_note || ""}
                    onBlur={(e) => saveFollowup({ next_followup_note: e.target.value || null })}
                    rows={2}
                    style={{ width: "100%", resize: "vertical", background: "var(--surface-04)", border: "1px solid var(--color-hairline)", borderRadius: 8, color: "var(--color-text)", fontSize: 12, padding: "6px 8px", fontFamily: "inherit" }}
                  />
                </div>

                <div style={{ paddingTop: 4, borderTop: "1px solid var(--color-hairline-soft)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)" }}>
                      Контекст для передачи
                    </div>
                    <button
                      onClick={refreshContext}
                      disabled={refreshingContext}
                      className="press"
                      style={{
                        fontSize: 10.5, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)",
                        border: "none", borderRadius: 7, padding: "4px 9px", cursor: refreshingContext ? "default" : "pointer",
                        opacity: refreshingContext ? 0.6 : 1,
                      }}
                    >
                      {refreshingContext ? "…" : "✨ Обновить"}
                    </button>
                  </div>
                  {contextError && <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 6 }}>{contextError}</div>}
                  {selected.ai_context_summary ? (
                    <>
                      <div style={{ fontSize: 12.5, color: "var(--color-text)", lineHeight: 1.5 }}>{selected.ai_context_summary}</div>
                      {selected.ai_context_generated_at && (
                        <div style={{ fontSize: 10, color: "var(--color-text-faint)", marginTop: 5 }}>
                          Обновлено {new Date(selected.ai_context_generated_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--color-text-faint)" }}>
                      Сводки ещё нет — нажмите "Обновить", чтобы AI собрал контекст из истории клиента.
                    </div>
                  )}
                </div>

                {selected.leads.length > 0 && (
                  <div style={{ paddingTop: 4, borderTop: "1px solid var(--color-hairline-soft)" }}>
                    <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 8 }}>Лиды</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {selected.leads.map((l) => (
                        <div key={l.id} style={{ fontSize: 12, color: "var(--color-text-soft)" }}>
                          {STATUS_LABELS[l.stage] || l.stage}{l.source ? ` · ${l.source}` : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.spravka_requests.length > 0 && (
                  <div style={{ paddingTop: 4, borderTop: "1px solid var(--color-hairline-soft)" }}>
                    <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 8 }}>Квартиры</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {selected.spravka_requests.map((s) => (
                        <div key={s.id} style={{ fontSize: 12, color: "var(--color-text-soft)" }}>
                          {s.units ? <>№{s.units.unit_number} · {s.units.buildings?.name}</> : "—"} — {PLAN_LABELS[s.plan_type] || s.plan_type} · {STATUS_LABELS[s.status] || s.status}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  className="press"
                  disabled={opening}
                  onClick={openWorkspace}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "11px 16px", borderRadius: 12, border: "none",
                    color: "var(--v-text-on-accent)", background: "var(--v-accent)", opacity: opening ? 0.7 : 1,
                  }}
                >
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2}>
                    <path d="M12 3l1.8 4.3L18 9l-4.2 1.7L12 15l-1.8-4.3L6 9l4.2-1.7L12 3Z" />
                  </svg>
                  {opening ? "Открываю…" : "Открыть в Мастерской →"}
                </button>
              </>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0, padding: "18px 22px", overflowY: "auto" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 12 }}>Лента событий</div>
            {!selected ? (
              <Skeleton height={60} />
            ) : (
              <DealTimeline detail={selected} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
