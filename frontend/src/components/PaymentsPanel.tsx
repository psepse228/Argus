"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Payment, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import { Skeleton } from "./Skeleton";

/** Loan-servicing-style view over payment_schedule: what's due, what's paid,
 * what's overdue, per approved Справка. Rows are generated once at approval
 * time (see backend/app/services/payment_schedule_service.py) — this panel
 * only tracks and confirms what happens to them afterward. */
export function PaymentsPanel() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [error, setError] = useState("");
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    api.payments().then(setPayments).catch((e) => setError(`Не удалось загрузить платежи: ${e.message}`));
  }, []);

  async function markPaid(id: string) {
    setMarkingId(id);
    setError("");
    try {
      const updated = await api.markPaymentPaid(id);
      setPayments((cur) => cur && cur.map((p) => (p.id === id ? { ...p, ...updated } : p)));
    } catch (e: any) {
      setError(`Не удалось отметить оплату: ${e.message}`);
    } finally {
      setMarkingId(null);
    }
  }

  if (payments === null && !error) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: 0, color: "var(--color-text)" }}>Платежи</h1>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-panel stagger-item" style={{ ["--i" as any]: i, padding: "17px 18px" }}>
              <Skeleton height={27} width="55%" style={{ marginBottom: 8 }} />
              <Skeleton height={11} width="80%" />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-panel stagger-item" style={{ ["--i" as any]: i + 4, padding: "13px 16px", borderRadius: 14, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                <Skeleton width="45%" height={13} />
                <Skeleton width="65%" height={11} />
              </div>
              <Skeleton width={60} height={15} />
              <Skeleton width={70} height={20} radius={99} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rows = payments || [];
  const overdue = rows.filter((p) => p.status === "overdue");
  const dueSoon = rows.filter((p) => p.status === "pending" && p.due_soon);
  const pending = rows.filter((p) => p.status === "pending" && !p.due_soon);
  const paid = rows.filter((p) => p.status === "paid");

  const totalDue = overdue.reduce((s, p) => s + p.amount_usd, 0) + pending.reduce((s, p) => s + p.amount_usd, 0);
  const overdueSum = overdue.reduce((s, p) => s + p.amount_usd, 0);
  const paidSum = paid.reduce((s, p) => s + p.amount_usd, 0);

  function fmt(n: number) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  const kpis = [
    { value: fmt(totalDue), label: "К получению", color: "var(--v-accent)" },
    { value: overdue.length, label: `Просрочено${overdueSum ? ` · ${fmt(overdueSum)}` : ""}`, color: "var(--danger)" },
    { value: dueSoon.length, label: "Скоро наступит срок", color: "var(--warning)" },
    { value: fmt(paidSum), label: "Уже оплачено", color: "var(--success)" },
  ];

  function Row({ p, index }: { p: Payment; index: number }) {
    const req = p.spravka_requests;
    const unit = req?.units;
    const c = PAYMENT_STATUS_COLORS[p.status];
    return (
      <div className="glass-panel stagger-item" style={{ ["--i" as any]: index, padding: "13px 16px", borderRadius: 14, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text)" }}>
            {req?.client_name || "—"}
            {unit && <span style={{ fontWeight: 500, color: "var(--color-text-faint)" }}> · {unit.buildings?.name} №{unit.unit_number}</span>}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>
            {p.label} · срок {new Date(p.due_date).toLocaleDateString("ru-RU")}
            {req?.requested_by ? ` · ${req.requested_by}` : ""}
          </div>
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--color-text)", flexShrink: 0 }}>{fmt(p.amount_usd)}</div>
        <span
          style={{
            fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", padding: "3px 9px",
            borderRadius: 99, fontWeight: 700, whiteSpace: "nowrap", background: c.bg, color: c.fg, flexShrink: 0,
          }}
        >
          {p.status === "pending" && p.due_soon ? "Скоро" : PAYMENT_STATUS_LABELS[p.status]}
        </span>
        {(p.status === "overdue" || p.due_soon) && req?.client_phone && (
          <a
            href={`tel:${req.client_phone}`}
            title="Нет автоматических напоминаний в Telegram/WhatsApp — позвоните клиенту напрямую"
            className="press"
            style={{
              fontSize: 12, fontWeight: 700, color: "var(--color-text-soft)", background: "rgba(255,255,255,.05)",
              border: "1px solid var(--color-hairline)", borderRadius: 10, padding: "7px 13px", flexShrink: 0,
              display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
            }}
          >
            <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.4 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z" />
            </svg>
            Позвонить
          </a>
        )}
        {p.status !== "paid" && (
          <button
            className="press"
            disabled={markingId === p.id}
            onClick={() => markPaid(p.id)}
            style={{
              fontSize: 12, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)",
              border: "none", borderRadius: 10, padding: "7px 13px", cursor: "pointer", flexShrink: 0,
              opacity: markingId === p.id ? 0.6 : 1,
            }}
          >
            {markingId === p.id ? "…" : "Отметить оплату"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: 0, color: "var(--color-text)" }}>Платежи</h1>

      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {kpis.map((k) => (
            <div key={k.label} className="glass-panel" style={{ padding: "17px 18px" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 27, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 6 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <p style={{ color: "var(--color-text-faint)", fontSize: 11.5, margin: 0 }}>
          Автонапоминаний в Telegram/WhatsApp пока нет — «Позвонить» открывает звонок клиенту напрямую.
        </p>
      )}
      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      {rows.length === 0 && (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>
          График платежей появляется автоматически, когда босс одобряет Справку с рассрочкой.
        </div>
      )}

      {overdue.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--danger)", marginBottom: 10 }}>
            Просрочено — {overdue.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overdue.map((p, i) => <Row key={p.id} p={p} index={i} />)}
          </div>
        </div>
      )}

      {dueSoon.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--warning)", marginBottom: 10 }}>
            Скоро — {dueSoon.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dueSoon.map((p, i) => <Row key={p.id} p={p} index={overdue.length + i} />)}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
            Ожидается — {pending.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((p, i) => <Row key={p.id} p={p} index={overdue.length + dueSoon.length + i} />)}
          </div>
        </div>
      )}

      {paid.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
            Оплачено — {paid.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {paid.map((p, i) => <Row key={p.id} p={p} index={overdue.length + dueSoon.length + pending.length + i} />)}
          </div>
        </div>
      )}
    </div>
  );
}
