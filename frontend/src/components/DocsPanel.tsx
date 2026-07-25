"use client";
import { useEffect, useState } from "react";
import { api, CurrentUser } from "@/lib/api";
import { Unit, Building, SpravkaRequest, PlanRate, PLAN_LABELS } from "@/lib/types";
import { StatusChip } from "./StatusChip";

export function DocsPanel({ user }: { user: CurrentUser }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [requests, setRequests] = useState<SpravkaRequest[]>([]);
  const [rates, setRates] = useState<PlanRate[]>([]);

  const [buildingId, setBuildingId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [planType, setPlanType] = useState("installment_6");
  const [downPct, setDownPct] = useState(30);
  const [useBalloon, setUseBalloon] = useState(false);
  const [balloonMonths, setBalloonMonths] = useState(9);
  const [balloonMonthlyUsd, setBalloonMonthlyUsd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function refresh() {
    const [b, u, r] = await Promise.all([api.buildings(), api.units(), api.spravkaRequests()]);
    setBuildings(b);
    setUnits(u.filter((x: Unit) => x.status === "for_sale"));
    setRequests(r);
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (buildingId) api.paymentPlanRates(buildingId).then(setRates);
  }, [buildingId]);

  const unitOptions = units.filter((u) => !buildingId || u.building_id === buildingId);
  const currentRate = rates.find((r) => r.plan_type === planType);

  async function submit() {
    setError("");
    if (!unitId || !clientName || !clientPhone) { setError("Заполните юнит, имя и телефон клиента"); return; }
    setBusy(true);
    try {
      const wantsBalloon = planType !== "cash" && useBalloon;
      await api.createSpravka({
        unit_id: unitId, client_name: clientName, client_phone: clientPhone,
        plan_type: planType, down_payment_pct: planType === "cash" ? undefined : downPct,
        balloon_months: wantsBalloon ? balloonMonths : undefined,
        balloon_monthly_payment_usd: wantsBalloon ? balloonMonthlyUsd : undefined,
      });
      setClientName(""); setClientPhone(""); setUnitId(""); setUseBalloon(false);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, decision: "approve" | "reject") {
    setActionError("");
    try {
      await (decision === "approve" ? api.approveSpravka(id) : api.rejectSpravka(id));
      await refresh();
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: 0, color: "var(--color-text)" }}>Справки</h1>

      {/* generation form */}
      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 15, margin: "0 0 14px", color: "var(--color-text)" }}>Новая справка</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <select value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setUnitId(""); }} style={selectStyle}>
            <option value="">Здание…</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} style={selectStyle} disabled={!buildingId}>
            <option value="">Юнит…</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>№{u.unit_number} · {u.area_m2}м² · ${u.price_per_m2_usd}/м²</option>
            ))}
          </select>
          <input placeholder="Имя клиента" value={clientName} onChange={(e) => setClientName(e.target.value)} style={inputStyle} />
          <input placeholder="Телефон клиента" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} style={inputStyle} />
          <select value={planType} onChange={(e) => setPlanType(e.target.value)} style={selectStyle}>
            {Object.entries(PLAN_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {planType !== "cash" && (
            <input type="number" placeholder="Первый взнос %" value={downPct} onChange={(e) => setDownPct(Number(e.target.value))} style={inputStyle} />
          )}
        </div>
        {planType !== "cash" && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--color-text-soft)", cursor: "pointer", marginBottom: useBalloon ? 10 : 0 }}>
              <input type="checkbox" checked={useBalloon} onChange={(e) => setUseBalloon(e.target.checked)} />
              Частичная оплата с остатком (как «последний Task» — меньше платёж до срока, остаток одним платежом)
            </label>
            {useBalloon && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <input type="number" placeholder="Срок частичной оплаты (мес)" value={balloonMonths} onChange={(e) => setBalloonMonths(Number(e.target.value))} style={inputStyle} />
                <input type="number" placeholder="Ежемесячный платёж ($)" value={balloonMonthlyUsd} onChange={(e) => setBalloonMonthlyUsd(Number(e.target.value))} style={inputStyle} />
              </div>
            )}
          </div>
        )}
        {currentRate && (
          <div style={{ fontSize: 12.5, color: "var(--v-accent)", marginBottom: 12, fontWeight: 600 }}>
            Реальная цена по этому плану: ${currentRate.price_per_m2_usd}/м² (анкорная цена на шахматке — другая, это только для справки)
          </div>
        )}
        {error && <div style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 12 }}>{error}</div>}
        <button onClick={submit} disabled={busy} style={primaryBtnStyle}>
          {busy ? "Генерирую…" : "Сгенерировать справку"}
        </button>
      </div>

      {/* history */}
      <div className="glass-panel" style={{ padding: "6px 22px 10px" }}>
        {actionError && <div style={{ fontSize: 12.5, color: "var(--danger)", padding: "12px 4px 0" }}>{actionError}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.2fr 1fr 1fr 0.9fr auto", gap: 14, padding: "14px 4px", borderBottom: "1px solid var(--color-hairline)", fontSize: 11, color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: ".05em" }}>
          <span>Юнит</span><span>План</span><span>Клиент</span><span>Кем создано</span><span>Статус</span><span></span>
        </div>
        {requests.map((r) => {
          const s = r.computed_summary;
          const isOpen = expandedId === r.id;
          return (
            <div key={r.id} style={{ borderBottom: "1px solid var(--color-hairline-soft)" }}>
              <div
                onClick={() => setExpandedId(isOpen ? null : r.id)}
                style={{ display: "grid", gridTemplateColumns: "1.3fr 1.2fr 1fr 1fr 0.9fr auto", gap: 14, padding: "15px 4px", alignItems: "center", fontSize: 13, cursor: "pointer" }}
              >
                <span style={{ color: "var(--color-text)", fontWeight: 600 }}>
                  {r.units ? <>№{r.units.unit_number} · {r.units.buildings?.name}</> : "—"}
                </span>
                <span style={{ color: "var(--color-text-soft)" }}>{PLAN_LABELS[r.plan_type] || r.plan_type}</span>
                <span style={{ color: "var(--color-text-soft)" }}>{r.client_name}</span>
                <span style={{ color: "var(--color-text-soft)" }}>{r.requested_by}</span>
                <span><StatusChip status={r.status} /></span>
                <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                  {r.generated_file_url && (
                    <a href={api.spravkaDownloadUrl(r.id)} style={{ padding: "6px 12px", borderRadius: 99, background: "rgba(255,255,255,.05)", border: "1px solid var(--color-hairline)", color: "var(--color-text-soft)", fontSize: 11.5, fontWeight: 600 }}>
                      Скачать
                    </a>
                  )}
                  {user.role === "boss" && r.status === "pending" && (
                    <>
                      <button onClick={() => act(r.id, "approve")} style={{ ...primaryBtnStyle, padding: "6px 12px", fontSize: 11.5 }}>Одобрить</button>
                      <button onClick={() => act(r.id, "reject")} style={{ padding: "6px 12px", borderRadius: 99, background: "transparent", color: "var(--color-text-soft)", fontSize: 11.5, fontWeight: 600, border: "1px solid var(--color-hairline)", cursor: "pointer" }}>Отклонить</button>
                    </>
                  )}
                </div>
              </div>
              {isOpen && (
                <div style={{ padding: "4px 4px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                  {!s && (
                    <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: "var(--color-text-faint)" }}>
                      Предпросмотр недоступен для справок, сгенерированных до этого обновления — скачайте файл.
                    </div>
                  )}
                  {s && (
                    <>
                      <PreviewStat label="Площадь" value={r.units ? `${r.units.area_m2} м²` : "—"} />
                      <PreviewStat label="Цена/м² (реальная)" value={`$${s.effective_price_per_m2_usd.toLocaleString()}`} />
                      <PreviewStat label="Итого" value={`$${s.effective_total_usd.toLocaleString()}`} />
                      <PreviewStat label="Условие" value={s.payment_label.trim()} />
                      {s.monthly_payment_usd > 0 && (
                        <>
                          <PreviewStat label="Первый взнос" value={`$${s.down_payment_usd.toLocaleString()}`} />
                          <PreviewStat label="Остаток" value={`$${s.remaining_usd.toLocaleString()}`} />
                          <PreviewStat label="Ежемесячно" value={`$${s.monthly_payment_usd.toLocaleString()}`} />
                          {s.balloon_remaining_usd > 0 && (
                            <PreviewStat label="Остаток после частичной оплаты" value={`$${s.balloon_remaining_usd.toLocaleString()}`} />
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {requests.length === 0 && <div style={{ padding: "30px 0", textAlign: "center", color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет сгенерированных справок</div>}
      </div>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,.03)", border: "1px solid var(--color-hairline-soft)" }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--color-text-faint)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>{value}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: "10px 13px", borderRadius: 11, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline-soft)", color: "var(--color-text)", fontSize: 13 };
const selectStyle: React.CSSProperties = { ...inputStyle };
const primaryBtnStyle: React.CSSProperties = { padding: "10px 18px", borderRadius: 99, background: "var(--v-accent)", color: "var(--v-text-on-accent)", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" };
