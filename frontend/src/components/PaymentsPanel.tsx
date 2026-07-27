"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Payment, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS } from "@/lib/types";

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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Платежи</h1>
        <p style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка…</p>
      </div>
    );
  }

  const rows = payments || [];
  const overdue = rows.filter((p) => p.status === "overdue");
  const pending = rows.filter((p) => p.status === "pending");
  const paid = rows.filter((p) => p.status === "paid");

  const totalDue = overdue.reduce((s, p) => s + p.amount_usd, 0) + pending.reduce((s, p) => s + p.amount_usd, 0);

  function fmt(n: number) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  function Row({ p }: { p: Payment }) {
    const req = p.spravka_requests;
    const unit = req?.units;
    const c = PAYMENT_STATUS_COLORS[p.status];
    return (
      <div className="glass-panel" style={{ padding: "13px 16px", borderRadius: 14, display: "flex", alignItems: "center", gap: 14 }}>
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
          {PAYMENT_STATUS_LABELS[p.status]}
        </span>
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
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Платежи</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 18px" }}>
        {rows.length === 0 ? "Пока нет активных графиков платежей" : `К получению: ${fmt(totalDue)} · ${overdue.length} просрочено`}
      </p>
      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>{error}</div>}
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
            {overdue.map((p) => <Row key={p.id} p={p} />)}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
            Ожидается — {pending.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((p) => <Row key={p.id} p={p} />)}
          </div>
        </div>
      )}

      {paid.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
            Оплачено — {paid.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {paid.map((p) => <Row key={p.id} p={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}
