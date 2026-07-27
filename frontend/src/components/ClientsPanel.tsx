"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, CurrentUser } from "@/lib/api";
import { Client, ClientDetail, PRIORITY_COLORS, PRIORITY_LABELS, Priority, STAGE_COLORS, STATUS_LABELS, PLAN_LABELS } from "@/lib/types";
import { ChatThread } from "./ChatThread";
import { DealTimeline } from "./DealTimeline";
import { Skeleton } from "./Skeleton";
import { TelegramPreviewModal } from "./TelegramPreviewModal";

/** Rolls the client's leads + справки into one "where things stand" badge --
 * an approved deal or a pending справка takes priority over whatever stage
 * the underlying lead is still sitting at, since those are more concrete
 * signals of where the deal actually is. */
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

/** Before this, a "client" was just free-text (name, phone) duplicated
 * independently across Лиды and Справки, with no single place to see one
 * person's whole history. Here the same client's leads, справки, and their
 * own profile-chat (see ChatThread) live together -- and the assistant in
 * that chat is given this exact history as context (see
 * app/ai/prompts.py::client_context_prompt), not generic advice. */
export function ClientsPanel({
  user, openClientId, onOpenClientHandled,
}: {
  user: CurrentUser;
  /** Set from outside (e.g. Лиды's "Открыть карточку клиента" button) to
   * drill straight into a client instead of landing on the plain list. */
  openClientId?: string | null;
  onOpenClientHandled?: () => void;
}) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [selected, setSelected] = useState<ClientDetail | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [spravkaMode, setSpravkaMode] = useState(false);
  // The rect of whatever card was clicked -- lets the detail view animate
  // growing out of that exact spot (a lightweight FLIP) instead of just
  // appearing. Null when opened without a click (search, Лиды hand-off).
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [savingFollowup, setSavingFollowup] = useState(false);
  const [telegramPreviewOpen, setTelegramPreviewOpen] = useState(false);

  useEffect(() => { api.clients().then(setClients).catch(() => setClients([])); }, []);

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

  async function openClient(id: string, rect?: DOMRect) {
    setSelected(null);
    setConversationId(null);
    setOrigin(rect ?? null);
    const [detail, conv] = await Promise.all([api.clientDetail(id), api.clientConversation(id)]);
    setSelected(detail);
    setConversationId(conv.id);
  }

  useEffect(() => {
    if (openClientId) {
      openClient(openClientId);
      onOpenClientHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openClientId]);

  useLayoutEffect(() => {
    if (!selected || !origin || !detailRef.current) return;
    const el = detailRef.current;
    const final = el.getBoundingClientRect();
    const dx = origin.left - final.left;
    const dy = origin.top - final.top;
    const sx = origin.width / final.width;
    const sy = origin.height / final.height;
    el.style.transition = "none";
    el.style.transformOrigin = "top left";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = "0.5";
    el.getBoundingClientRect(); // force reflow before animating to identity
    requestAnimationFrame(() => {
      el.style.transition = "transform .38s cubic-bezier(.2,.7,.3,1), opacity .28s ease";
      el.style.transform = "none";
      el.style.opacity = "1";
    });
    setOrigin(null); // consumed -- don't replay on unrelated re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (selected) {
    const stage = clientStage(selected);
    // Concrete apartments (a real справка was made for these) vs. buildings
    // a lead only ever expressed interest in without a unit chosen yet --
    // two different strengths of "considering", shown as two tiers.
    const spravkaBuildingNames = new Set(selected.spravka_requests.map((s) => s.units?.buildings?.name).filter(Boolean));
    const softBuildings = Array.from(
      new Set(selected.leads.map((l) => l.buildings?.name).filter((n): n is string => !!n && !spravkaBuildingNames.has(n)))
    );

    return (
      <div ref={detailRef} className={origin ? undefined : "section-enter"} style={{ flex: 1, minHeight: 0, display: "flex", gap: 16 }}>
        <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <button
            onClick={() => setSelected(null)}
            style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, color: "var(--color-text-soft)", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 99, padding: "7px 13px", cursor: "pointer" }}
          >
            ← Все клиенты
          </button>
          <div className="glass-panel" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>
                {selected.name || selected.phone}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-faint)", marginTop: 3 }}>{selected.phone}</div>
            </div>

            <span style={{
              display: "inline-flex", alignSelf: "flex-start", fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 99,
              color: stage.color, background: `color-mix(in srgb, ${stage.color} 16%, transparent)`,
            }}>
              {stage.label}
            </span>

            {selected.leads.length > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", paddingTop: 2, borderTop: "1px solid var(--color-hairline-soft)" }}>
                {selected.leads.length} {selected.leads.length === 1 ? "лид" : "лида(ов)"} · {Array.from(new Set(selected.leads.map((l) => l.source).filter(Boolean))).join(", ") || "источник неизвестен"}
              </div>
            )}

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
                        background: active ? c.bg : "rgba(255,255,255,.04)",
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
                style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 8, color: "var(--color-text)", fontSize: 12, padding: "6px 8px", marginBottom: 6 }}
              />
              <textarea
                placeholder="Заметка после звонка…"
                defaultValue={selected.next_followup_note || ""}
                onBlur={(e) => saveFollowup({ next_followup_note: e.target.value || null })}
                rows={2}
                style={{ width: "100%", resize: "vertical", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 8, color: "var(--color-text)", fontSize: 12, padding: "6px 8px", fontFamily: "inherit" }}
              />
            </div>
          </div>

          <DealTimeline detail={selected} />
        </div>

        <div className="glass-panel" style={{ flex: 1, minWidth: 0, minHeight: 0, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>
            Работа с клиентом
          </div>

          <button
            className="press"
            onClick={() => setSpravkaMode((v) => !v)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "flex-start",
              fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "10px 18px", borderRadius: 12, border: "none",
              color: spravkaMode ? "var(--v-text-on-accent)" : "var(--v-accent)",
              background: spravkaMode ? "var(--v-accent)" : "var(--v-accent-tint)",
            }}
          >
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h4" />
            </svg>
            {spravkaMode ? "Режим справки включён — говорите в чате" : "Сделать справку"}
          </button>

          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>Квартиры</div>
            {selected.spravka_requests.length === 0 && softBuildings.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пока ничего конкретного не выбрано.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {selected.spravka_requests.map((s) => (
                  <div key={s.id} style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,.03)", border: "1px solid var(--color-hairline-soft)" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
                      {s.units ? <>№{s.units.unit_number} · {s.units.buildings?.name}</> : "—"}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>
                      {PLAN_LABELS[s.plan_type] || s.plan_type} · {STATUS_LABELS[s.status] || s.status}
                    </div>
                    {s.generated_file_url && (
                      <a href={api.spravkaDownloadUrl(s.id)} style={{ fontSize: 11.5, color: "var(--v-accent)", fontWeight: 700 }}>Скачать →</a>
                    )}
                  </div>
                ))}
                {softBuildings.length > 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>
                    Также интересовался: {softBuildings.join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>Звонки и Telegram</div>
            <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,.03)", border: "1px dashed var(--color-hairline)" }}>
              <div style={{ fontSize: 12, color: "var(--color-text-faint)", lineHeight: 1.5, marginBottom: 10 }}>
                Скоро — история звонков и переписки в Telegram появится здесь, когда будет готова реальная интеграция. Сейчас Argus этого не отслеживает.
              </div>
              <button
                className="press"
                onClick={() => setTelegramPreviewOpen(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                  padding: "7px 12px", borderRadius: 9, border: "none", color: "#fff",
                  background: "linear-gradient(150deg, #2AABEE, #229ED9)",
                }}
              >
                <svg viewBox="0 0 24 24" width={13} height={13} fill="#fff"><path d="M21.94 4.53 18.6 20.2c-.25 1.12-.9 1.4-1.83.87l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.15L18.1 6.9c.4-.36-.09-.56-.63-.2L7.4 13.3l-5-1.57c-1.1-.34-1.12-1.1.23-1.63L20.6 3.5c.9-.34 1.7.2 1.34 1.03Z" /></svg>
                Показать бета-превью
              </button>
            </div>
          </div>
        </div>

        <div className="glass-panel" style={{ width: 340, flexShrink: 0, minHeight: 0, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
            Чат · {selected.name || selected.phone}
          </div>
          <div style={{ flex: 1, minHeight: 0, paddingTop: 10 }}>
            {conversationId ? (
              <ChatThread
                conversationId={conversationId} isBoss={user.role === "boss"} spravkaMode={spravkaMode}
                onSpravkaCreated={() => setSpravkaMode(false)}
                greeting={`Что нужно по клиенту ${selected.name || selected.phone}? Могу оформить справку, посоветовать план оплаты или подсказать следующий шаг по сделке.`}
              />
            ) : (
              <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка чата…</div>
            )}
          </div>
        </div>
        {telegramPreviewOpen && (
          <TelegramPreviewModal clientName={selected.name || selected.phone} onClose={() => setTelegramPreviewOpen(false)} />
        )}
      </div>
    );
  }

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
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Клиенты</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 16px" }}>{clients.length} клиентов — их лиды, справки и переписка в одном месте</p>
      {clients.length === 0 && (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет клиентов — появятся из лидов и справок.</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
        {clients.map((c, i) => <ClientCard key={c.id} client={c} index={i} onOpen={(rect) => openClient(c.id, rect)} />)}
      </div>
    </div>
  );
}

function ClientCard({ client: c, index, onOpen }: { client: Client; index: number; onOpen: (rect: DOMRect) => void }) {
  const active = c.leads_count > 0 || c.spravka_count > 0;
  const initial = (c.name || c.phone).trim()[0]?.toUpperCase() || "?";
  const cardRef = useRef<HTMLDivElement>(null);

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const rx = ((e.clientY - r.top) / r.height - 0.5) * -6;
    const ry = ((e.clientX - r.left) / r.width - 0.5) * 6;
    e.currentTarget.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
  }
  function onMouseLeave(e: React.MouseEvent<HTMLDivElement>) {
    e.currentTarget.style.transform = "";
  }
  function open() {
    if (cardRef.current) onOpen(cardRef.current.getBoundingClientRect());
  }

  return (
    <div
      ref={cardRef}
      onClick={open}
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
              : "rgba(255,255,255,.08)",
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
          <div style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{c.phone}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-soft)", background: "rgba(255,255,255,.05)", padding: "3px 9px", borderRadius: 99 }}>{c.leads_count} лидов</span>
        {c.spravka_count > 0 && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)", padding: "3px 9px", borderRadius: 99 }}>{c.spravka_count} справок</span>
        )}
      </div>

      <div
        data-quick-trigger
        onClick={(e) => { e.stopPropagation(); open(); }}
        className="press"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 2,
          fontSize: 11.5, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)",
          padding: "8px 0", borderRadius: 10,
        }}
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.2}>
          <path d="M12 3l1.8 4.3L18 9l-4.2 1.7L12 15l-1.8-4.3L6 9l4.2-1.7L12 3Z" />
        </svg>
        Работать с AI
      </div>
    </div>
  );
}
