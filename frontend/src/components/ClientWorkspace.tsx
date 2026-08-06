"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Building, BrainItem, ClientDetail, PRIORITY_COLORS, PRIORITY_LABELS, Priority, STAGE_COLORS, STATUS_LABELS, PLAN_LABELS, PlanRate, TelegramConversation, TelegramMessage, Unit } from "@/lib/types";
import { ChatThread } from "./ChatThread";
import { DealTimeline } from "./DealTimeline";
import { Dropdown } from "./Dropdown";
import { TelegramBusinessThread } from "./TelegramBusinessThread";
import { TelegramSummaryCard } from "./TelegramSummaryCard";

const inputStyle: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, background: "var(--surface-04)", border: "1px solid var(--color-hairline-soft)", color: "var(--color-text)", fontSize: 12.5 };

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

/** The actual "работа с клиентом" surface -- profile, stage, apartments,
 * Cortège+ monitoring, and the AI chat, all in one place. Lives inside
 * Мастерская (see AssistantPanel.tsx); this used to be Клиенты's own detail
 * view, but that view is now the lighter ClientInfoCard -- opening a client
 * to actually work on them is a deliberate step into Мастерская instead. */
export function ClientWorkspace({
  clientId, isBoss, onDecided,
}: {
  clientId: string;
  isBoss: boolean;
  /** Bubbled up to Ассистент's digest refresh after this workspace's own
   * inline approve/reject -- otherwise the Мастерская pill's pending badge
   * stays stale until a full reload, same fix as SpravkaApprovalTable's. */
  onDecided?: () => void;
}) {
  const [selected, setSelected] = useState<ClientDetail | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [spravkaMode, setSpravkaMode] = useState(false);
  const [savingFollowup, setSavingFollowup] = useState(false);
  const [telegramConversation, setTelegramConversation] = useState<TelegramConversation | null>(null);
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
  const [clientBrainItems, setClientBrainItems] = useState<BrainItem[]>([]);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  // Manual справка form -- restores the old DocsPanel path (form → boss
  // approval queue) alongside the AI-chat spravka mode, since not every rep
  // wants to talk to the assistant just to pick a unit and a plan.
  const [formOpen, setFormOpen] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [rates, setRates] = useState<PlanRate[]>([]);
  const [buildingId, setBuildingId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [planType, setPlanType] = useState("installment_6");
  const [downPct, setDownPct] = useState(30);
  const [useBalloon, setUseBalloon] = useState(false);
  const [balloonMonths, setBalloonMonths] = useState(9);
  const [balloonMonthlyUsd, setBalloonMonthlyUsd] = useState(0);
  // Empty string, not 0 -- distinguishes "rep didn't touch this" from "rep
  // typed zero," so the fixed payment_plan_rates lookup stays the default.
  const [requestedPrice, setRequestedPrice] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");

  // ClientWorkspace is reused across client switches, not remounted (no
  // key={clientId} at the call site) -- so an in-flight fetch/send for the
  // previous client can still resolve after the rep has already switched to
  // a new one. This ref lets every async callback below check "is my
  // clientId still the one the user is actually looking at" before writing
  // state, instead of silently overwriting the new client's data with the
  // old one's late-arriving response.
  const activeClientIdRef = useRef(clientId);

  useEffect(() => {
    activeClientIdRef.current = clientId;
    setSelected(null);
    setConversationId(null);
    setSpravkaMode(false);
    setFormOpen(false);
    setRequestedPrice("");
    setTelegramConversation(null);
    setTelegramMessages([]);
    setClientBrainItems([]);
    (async () => {
      const [detail, conv, tg] = await Promise.all([
        api.clientDetail(clientId), api.clientConversation(clientId), api.telegramByClient(clientId),
      ]);
      if (activeClientIdRef.current !== clientId) return; // a newer client was selected meanwhile
      setSelected(detail);
      setConversationId(conv.id);
      setTelegramConversation(tg.conversation);
      setTelegramMessages(tg.messages);
    })();
    api.brainItems().then((allItems) => {
      if (activeClientIdRef.current !== clientId) return; // a newer client was selected meanwhile
      // coaching_tip items already have a dedicated display spot in
      // TelegramSummaryCard's 💡 line (and feed the greeting lead below) --
      // surfacing them here too would put the same sentence on screen three times.
      setClientBrainItems(allItems.filter((it) => it.client_id === clientId && it.kind !== "coaching_tip"));
    }).catch(() => {});
  }, [clientId]);

  async function refreshTelegram() {
    const requestedId = clientId;
    const tg = await api.telegramByClient(requestedId);
    if (activeClientIdRef.current !== requestedId) return; // stale -- client switched before this resolved
    setTelegramConversation(tg.conversation);
    setTelegramMessages(tg.messages);
  }

  useEffect(() => {
    if (formOpen && buildings.length === 0) {
      api.buildings().then(setBuildings);
      api.units().then((u: Unit[]) => setUnits(u.filter((x) => x.status === "for_sale")));
    }
  }, [formOpen, buildings.length]);

  useEffect(() => {
    if (buildingId) api.paymentPlanRates(buildingId).then(setRates);
  }, [buildingId]);

  const unitOptions = units.filter((u) => !buildingId || u.building_id === buildingId);
  const currentRate = rates.find((r) => r.plan_type === planType);

  async function submitForm() {
    if (!selected) return;
    setFormError("");
    if (!unitId) { setFormError("Выберите юнит"); return; }
    setFormBusy(true);
    try {
      const wantsBalloon = planType !== "cash" && useBalloon;
      const requestedPriceNum = requestedPrice.trim() ? Number(requestedPrice) : undefined;
      await api.createSpravka({
        unit_id: unitId, client_name: selected.name || selected.phone, client_phone: selected.phone,
        plan_type: planType, down_payment_pct: planType === "cash" ? undefined : downPct,
        balloon_months: wantsBalloon ? balloonMonths : undefined,
        balloon_monthly_payment_usd: wantsBalloon ? balloonMonthlyUsd : undefined,
        requested_price_per_m2_usd: requestedPriceNum,
      });
      setFormOpen(false);
      setUnitId("");
      setUseBalloon(false);
      setRequestedPrice("");
      const detail = await api.clientDetail(clientId);
      setSelected(detail);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setFormBusy(false);
    }
  }

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

  async function resolveClientBrainItem(id: string, action: "confirm" | "dismiss") {
    setBusyItemId(id);
    try {
      await (action === "confirm" ? api.confirmBrainItem(id) : api.dismissBrainItem(id));
      setClientBrainItems((cur) => cur.filter((it) => it.id !== id));
    } catch {
      // best-effort -- if this fails, the item just stays in the list, no error banner needed for this small inline action
    } finally {
      setBusyItemId(null);
    }
  }

  async function decide(spravkaId: string, decision: "approve" | "reject") {
    setActionError("");
    try {
      const updated = await (decision === "approve" ? api.approveSpravka(spravkaId) : api.rejectSpravka(spravkaId));
      setSelected((cur) => cur && {
        ...cur,
        spravka_requests: cur.spravka_requests.map((s) => (s.id === spravkaId ? { ...s, ...updated } : s)),
      });
      onDecided?.();
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  if (!selected) {
    return <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка…</div>;
  }

  const stage = clientStage(selected);
  const spravkaBuildingNames = new Set(selected.spravka_requests.map((s) => s.units?.buildings?.name).filter(Boolean));
  const softBuildings = Array.from(
    new Set(selected.leads.map((l) => l.buildings?.name).filter((n): n is string => !!n && !spravkaBuildingNames.has(n)))
  );
  const baseGreeting = `Что нужно по клиенту ${selected.name || selected.phone}? Могу оформить справку, посоветовать план оплаты или подсказать следующий шаг по сделке.`;
  const topBrainItem = clientBrainItems[0];
  const greeting = topBrainItem
    ? `Я заметил: ${topBrainItem.summary}${topBrainItem.detail ? ` — ${topBrainItem.detail}` : ""}. ${baseGreeting}`
    : baseGreeting;

  return (
    <div className="section-enter" style={{ flex: 1, minHeight: 0, display: "flex", gap: 16 }}>
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
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
        </div>

        <DealTimeline detail={selected} />
      </div>

      <div className="glass-panel" style={{ flex: 1, minWidth: 0, minHeight: 0, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>
          Работа с клиентом
        </div>
        {actionError && <div style={{ fontSize: 12, color: "var(--danger)" }}>{actionError}</div>}

        {!formOpen && !spravkaMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="press"
              onClick={() => setFormOpen(true)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "10px 18px", borderRadius: 12, border: "none",
                color: "var(--v-accent)", background: "var(--v-accent-tint)",
              }}
            >
              <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h4" />
              </svg>
              Сделать справку
            </button>
            <span onClick={() => setSpravkaMode(true)} className="press" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-faint)", cursor: "pointer" }}>
              или через AI-чат →
            </span>
          </div>
        )}

        {formOpen && (
          <div className="glass-panel" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>Новая справка — {selected.name || selected.phone}</div>
              <div onClick={() => setFormOpen(false)} className="press" style={{ cursor: "pointer", color: "var(--color-text-faint)", fontSize: 12, fontWeight: 700 }}>✕</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Dropdown
                value={buildingId}
                onChange={(v) => { setBuildingId(v); setUnitId(""); }}
                placeholder="Здание…"
                options={buildings.map((b) => ({ value: b.id, label: b.name }))}
              />
              <Dropdown
                value={unitId}
                onChange={setUnitId}
                placeholder="Юнит…"
                disabled={!buildingId}
                options={unitOptions.map((u) => ({ value: u.id, label: `№${u.unit_number} · ${u.area_m2}м² · $${u.price_per_m2_usd}/м²` }))}
              />
              <Dropdown
                value={planType}
                onChange={setPlanType}
                options={Object.entries(PLAN_LABELS).map(([k, l]) => ({ value: k, label: l }))}
              />
              {planType !== "cash" && (
                <input type="number" placeholder="Первый взнос %" value={downPct} onChange={(e) => setDownPct(Number(e.target.value))} style={inputStyle} />
              )}
            </div>
            {planType !== "cash" && (
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-text-soft)", cursor: "pointer", marginBottom: useBalloon ? 8 : 0 }}>
                  <input type="checkbox" checked={useBalloon} onChange={(e) => setUseBalloon(e.target.checked)} />
                  Частичная оплата с остатком
                </label>
                {useBalloon && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <input type="number" placeholder="Срок (мес)" value={balloonMonths} onChange={(e) => setBalloonMonths(Number(e.target.value))} style={inputStyle} />
                    <input type="number" placeholder="Ежемесячный платёж ($)" value={balloonMonthlyUsd} onChange={(e) => setBalloonMonthlyUsd(Number(e.target.value))} style={inputStyle} />
                  </div>
                )}
              </div>
            )}
            {currentRate && (
              <div style={{ fontSize: 12, color: "var(--v-accent)", fontWeight: 600 }}>
                Реальная цена по этому плану: ${currentRate.price_per_m2_usd}/м²
              </div>
            )}
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--color-text-faint)", marginBottom: 6 }}>
                Запросить другую цену ($/м²) — необязательно, только если хотите отступить от стандартной ставки
              </label>
              <input
                type="number"
                placeholder={currentRate ? `По умолчанию: $${currentRate.price_per_m2_usd}` : "$/м²"}
                value={requestedPrice}
                onChange={(e) => setRequestedPrice(e.target.value)}
                style={{ ...inputStyle, width: 200 }}
              />
            </div>
            {formError && <div style={{ fontSize: 12, color: "var(--danger)" }}>{formError}</div>}
            <button
              onClick={submitForm}
              disabled={formBusy}
              className="press"
              style={{ alignSelf: "flex-start", padding: "9px 18px", borderRadius: 99, background: "var(--v-accent)", color: "var(--v-text-on-accent)", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", opacity: formBusy ? 0.7 : 1 }}
            >
              {formBusy ? "Генерирую…" : "Сгенерировать справку"}
            </button>
          </div>
        )}

        {spravkaMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, padding: "10px 18px", borderRadius: 12,
              color: "var(--v-text-on-accent)", background: "var(--v-accent)",
            }}>
              <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h4" />
              </svg>
              Режим справки включён — говорите в чате
            </span>
            <span onClick={() => setSpravkaMode(false)} className="press" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-faint)", cursor: "pointer" }}>
              выключить
            </span>
          </div>
        )}

        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>Квартиры</div>
          {selected.spravka_requests.length === 0 && softBuildings.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пока ничего конкретного не выбрано.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selected.spravka_requests.map((s) => (
                <div key={s.id} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-03)", border: "1px solid var(--color-hairline-soft)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
                        {s.units ? <>№{s.units.unit_number} · {s.units.buildings?.name}</> : "—"}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>
                        {PLAN_LABELS[s.plan_type] || s.plan_type} · {STATUS_LABELS[s.status] || s.status}
                      </div>
                      {s.requested_price_per_m2_usd != null && (
                        <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 2, fontWeight: 600 }}>
                          Запрошена цена: ${s.requested_price_per_m2_usd}/м²
                        </div>
                      )}
                    </div>
                    {isBoss && s.status === "pending" && (
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => decide(s.id, "approve")} className="press" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v-text-on-accent)", background: "var(--v-accent)", border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>Одобрить</button>
                        <button onClick={() => decide(s.id, "reject")} className="press" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-soft)", background: "transparent", border: "1px solid var(--color-hairline)", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>Отклонить</button>
                      </div>
                    )}
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

        <TelegramBusinessThread
          conversation={telegramConversation} messages={telegramMessages}
          onSent={refreshTelegram}
        />
      </div>

      <div className="glass-panel" style={{ width: 340, flexShrink: 0, minHeight: 0, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 13.5, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
          AI-советник · {selected.name || selected.phone}
        </div>
        <div style={{ flex: 1, minHeight: 0, paddingTop: 10, display: "flex", flexDirection: "column" }}>
          <TelegramSummaryCard conversation={telegramConversation} />
          {clientBrainItems.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {clientBrainItems.map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10,
                    background: it.priority === "high" ? "var(--danger-tint)" : "var(--v-accent-tint)",
                    opacity: busyItemId === it.id ? 0.6 : 1,
                  }}
                >
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600,
                    color: it.priority === "high" ? "var(--danger)" : "var(--v-accent)",
                  }}>
                    {it.summary}
                  </span>
                  <button
                    onClick={() => resolveClientBrainItem(it.id, "confirm")}
                    disabled={busyItemId === it.id}
                    aria-label="Отметить как решённое" title="Отметить как решённое"
                    className="press"
                    style={{ cursor: "pointer", fontWeight: 700, fontSize: 12, color: "var(--color-text-faint)", flexShrink: 0, background: "transparent", border: "none", padding: 2 }}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => resolveClientBrainItem(it.id, "dismiss")}
                    disabled={busyItemId === it.id}
                    aria-label="Скрыть" title="Скрыть -- не актуально"
                    className="press"
                    style={{ cursor: "pointer", fontWeight: 700, fontSize: 12, color: "var(--color-text-faint)", flexShrink: 0, background: "transparent", border: "none", padding: 2 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {conversationId ? (
            <ChatThread
              conversationId={conversationId} isBoss={isBoss} spravkaMode={spravkaMode}
              onSpravkaCreated={() => setSpravkaMode(false)}
              greeting={greeting}
            />
          ) : (
            <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка чата…</div>
          )}
        </div>
      </div>
    </div>
  );
}
