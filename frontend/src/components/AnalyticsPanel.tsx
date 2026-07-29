"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Building, Commission, ManagerPerformance, PlanRate, PLAN_LABELS, STATUS_LABELS, STATUS_COLORS } from "@/lib/types";
import { Skeleton } from "./Skeleton";

type Summary = {
  units_by_status: Record<string, number>;
  spravka_requests_pending: number;
  spravka_requests_approved: number;
  average_approved_discount_pct: number;
};

export function AnalyticsPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [ratesByBuilding, setRatesByBuilding] = useState<Record<string, PlanRate[]>>({});
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [exchangeRates, setExchangeRates] = useState<{ building_id: string; exchange_rate_sum: number; buildings?: { name: string } }[]>([]);
  const [savingRateFor, setSavingRateFor] = useState<string | null>(null);
  const [managerPerf, setManagerPerf] = useState<ManagerPerformance[] | null>(null);

  useEffect(() => {
    api.analyticsSummary().then(setSummary);
    api.commissions().then(setCommissions).catch(() => {});
    api.exchangeRates().then(setExchangeRates).catch(() => {});
    api.managerPerformance().then(setManagerPerf).catch(() => setManagerPerf([]));
    api.buildings().then(async (b: Building[]) => {
      setBuildings(b);
      const entries = await Promise.all(b.map(async (bld) => [bld.id, await api.paymentPlanRates(bld.id)] as const));
      setRatesByBuilding(Object.fromEntries(entries));
    });
  }, []);

  async function saveRate(id: string, pct: number) {
    setSavingId(id);
    try {
      await api.updateCommissionRate(id, pct);
      setCommissions((cur) => cur.map((c) => (
        c.id === id ? { ...c, commission_pct: pct, commission_usd: Math.round(c.collected_usd * pct) / 100 } : c
      )));
    } finally {
      setSavingId(null);
    }
  }

  async function saveExchangeRate(buildingId: string, sum: number) {
    setSavingRateFor(buildingId);
    try {
      await api.updateExchangeRate(buildingId, sum);
      setExchangeRates((cur) => cur.map((r) => (r.building_id === buildingId ? { ...r, exchange_rate_sum: sum } : r)));
    } finally {
      setSavingRateFor(null);
    }
  }

  if (!summary) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: 0, color: "var(--color-text)" }}>Аналитика</h1>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-panel stagger-item" style={{ ["--i" as any]: i, padding: "17px 18px" }}>
              <Skeleton height={27} width="55%" style={{ marginBottom: 8 }} />
              <Skeleton height={11} width="80%" />
            </div>
          ))}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="glass-panel stagger-item" style={{ ["--i" as any]: i + 4, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={13} width="30%" style={{ marginBottom: 6 }} />
            <Skeleton height={8} radius={99} />
            <Skeleton height={8} radius={99} width="80%" />
            <Skeleton height={8} radius={99} width="60%" />
          </div>
        ))}
      </div>
    );
  }

  const kpis = [
    { value: summary.units_by_status["for_sale"] || 0, label: "В продаже" },
    { value: summary.units_by_status["deal_completed"] || 0, label: "Сделки завершены" },
    { value: summary.spravka_requests_pending, label: "Справки на согласовании" },
    { value: `${summary.average_approved_discount_pct}%`, label: "Средний одобренный дисконт" },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: 0, color: "var(--color-text)" }}>Аналитика</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} className="glass-panel" style={{ padding: "17px 18px" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 27, fontWeight: 700, color: "var(--v-accent)", lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 6 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 16, margin: 0, color: "var(--color-text)" }}>Эффективность менеджеров</h3>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em", color: "var(--v-text-on-accent)", background: "linear-gradient(150deg, var(--v-violet-strong, #7a5cff), var(--v-violet, #5b3fc4))", borderRadius: 99, padding: "3px 9px" }}>
            AI-АНАЛИЗ
          </span>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--color-text-faint)", margin: "0 0 16px" }}>
          AI собирает работу каждого менеджера по Лидам, Справкам и Платежам в одну сводку — не нужно сверять три раздела вручную.
        </p>
        {!managerPerf ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1].map((i) => <Skeleton key={i} height={40} />)}
          </div>
        ) : managerPerf.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Нет агентов с ролью sales_agent.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr", gap: 10, minWidth: 560, fontSize: 11, color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: ".03em", paddingBottom: 8, borderBottom: "1px solid var(--color-hairline-soft)" }}>
              <span>Менеджер</span>
              <span>Лиды</span>
              <span>Конверсия</span>
              <span>Справки</span>
              <span>Собрано</span>
            </div>
            {managerPerf.map((m) => (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr", gap: 10, minWidth: 560, fontSize: 12.5, padding: "12px 0", borderBottom: "1px solid var(--color-hairline-soft)", alignItems: "center" }}>
                <span style={{ fontWeight: 700, color: "var(--color-text)" }}>{m.name}</span>
                <span style={{ color: "var(--color-text-soft)" }}>{m.leads_assigned} <span style={{ color: "var(--color-text-faint)" }}>({m.leads_converted} в брони)</span></span>
                <span style={{ fontWeight: 700, color: m.conversion_rate >= 20 ? "var(--success)" : "var(--color-text-soft)" }}>{m.conversion_rate}%</span>
                <span style={{ color: "var(--color-text-soft)" }}>{m.spravka_created} <span style={{ color: "var(--color-text-faint)" }}>({m.approval_rate}% одобрено)</span></span>
                <span style={{ fontWeight: 800, color: "var(--v-accent)" }}>${m.collected_usd.toLocaleString("en-US")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 15, margin: "0 0 14px", color: "var(--color-text)" }}>Юниты по статусу</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(summary.units_by_status).map(([status, count]) => {
            const color = STATUS_COLORS[status]?.fg || "var(--v-accent)";
            return (
              <div key={status} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 140, fontSize: 12.5, color: "var(--color-text-soft)" }}>{STATUS_LABELS[status] || status}</span>
                <div style={{ flex: 1, height: 8, borderRadius: 99, background: "rgba(255,255,255,.05)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (count / Math.max(...Object.values(summary.units_by_status))) * 100)}%`, background: color }} />
                </div>
                <span style={{ width: 30, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 15, margin: "0 0 4px", color: "var(--color-text)" }}>Курс (сум за $)</h3>
        <p style={{ fontSize: 11.5, color: "var(--color-text-faint)", margin: "0 0 14px" }}>
          Живой курс, а не фиксированное число в коде — каждая новая Справка считается по нему.
        </p>
        {exchangeRates.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Нет заданных курсов по зданиям.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {exchangeRates.map((r) => (
              <label key={r.building_id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 10, padding: "7px 11px" }}>
                <span style={{ color: "var(--color-text-soft)", fontWeight: 600 }}>{r.buildings?.name}</span>
                <input
                  type="number" step={10} min={0} defaultValue={r.exchange_rate_sum}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v !== r.exchange_rate_sum) saveExchangeRate(r.building_id, v);
                  }}
                  style={{ width: 76, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 7, color: "var(--color-text)", fontSize: 12.5, padding: "3px 6px", textAlign: "right", opacity: savingRateFor === r.building_id ? 0.5 : 1 }}
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 15, margin: "0 0 4px", color: "var(--color-text)" }}>Реальные цены по планам оплаты</h3>
        <p style={{ fontSize: 11.5, color: "var(--color-text-faint)", margin: "0 0 14px" }}>
          Анкорная цена на шахматке — витринная. Это то, что реально используется в справках.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: `120px repeat(${Object.keys(PLAN_LABELS).length}, 1fr)`, gap: 10, fontSize: 12.5 }}>
          <span />
          {Object.values(PLAN_LABELS).map((l) => (
            <span key={l} style={{ color: "var(--color-text-faint)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".03em" }}>{l}</span>
          ))}
          {buildings.map((b) => (
            <>
              <span key={b.id} style={{ color: "var(--color-text)", fontWeight: 600 }}>{b.name}</span>
              {Object.keys(PLAN_LABELS).map((plan) => {
                const rate = (ratesByBuilding[b.id] || []).find((r) => r.plan_type === plan);
                return (
                  <span key={b.id + plan} style={{ color: rate ? "var(--v-accent)" : "var(--color-text-faint)", fontWeight: rate ? 700 : 400 }}>
                    {rate ? `$${rate.price_per_m2_usd}` : "—"}
                  </span>
                );
              })}
            </>
          ))}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 15, margin: "0 0 4px", color: "var(--color-text)" }}>Комиссии</h3>
        <p style={{ fontSize: 11.5, color: "var(--color-text-faint)", margin: "0 0 14px" }}>
          % от реально собранных (оплаченных) платежей — не от всей суммы сделки.
        </p>
        {commissions.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Нет агентов с ролью sales_agent.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {commissions.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12.5 }}>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span style={{ color: "var(--color-text-faint)", width: 110, textAlign: "right" }}>собрано ${c.collected_usd.toLocaleString("en-US")}</span>
                <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--color-text-faint)" }}>
                  <input
                    type="number" step={0.5} min={0} max={100} defaultValue={c.commission_pct}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v !== c.commission_pct) saveRate(c.id, v);
                    }}
                    style={{ width: 52, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 8, color: "var(--color-text)", fontSize: 12.5, padding: "4px 6px", textAlign: "right" }}
                  />
                  %
                </label>
                <span style={{ width: 80, textAlign: "right", fontWeight: 800, color: "var(--v-accent)", opacity: savingId === c.id ? 0.5 : 1 }}>
                  ${c.commission_usd.toLocaleString("en-US")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
