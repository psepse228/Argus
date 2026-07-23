"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Building, PlanRate, PLAN_LABELS, STATUS_LABELS } from "@/lib/types";

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

  useEffect(() => {
    api.analyticsSummary().then(setSummary);
    api.buildings().then(async (b: Building[]) => {
      setBuildings(b);
      const entries = await Promise.all(b.map(async (bld) => [bld.id, await api.paymentPlanRates(bld.id)] as const));
      setRatesByBuilding(Object.fromEntries(entries));
    });
  }, []);

  if (!summary) return <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка…</div>;

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

      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 15, margin: "0 0 14px", color: "var(--color-text)" }}>Юниты по статусу</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(summary.units_by_status).map(([status, count]) => (
            <div key={status} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 140, fontSize: 12.5, color: "var(--color-text-soft)" }}>{STATUS_LABELS[status] || status}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 99, background: "rgba(255,255,255,.05)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (count / Math.max(...Object.values(summary.units_by_status))) * 100)}%`, background: "var(--v-accent)" }} />
              </div>
              <span style={{ width: 30, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>{count}</span>
            </div>
          ))}
        </div>
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
    </div>
  );
}
