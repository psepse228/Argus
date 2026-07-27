"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Client, Lead, Payment, SpravkaRequest } from "@/lib/types";

type QueueItem = { label: string; detail: string; color: string; sortKey: number };

/** Pulls the four separate "something needs attention" signals already
 * scattered across the app (stale leads, due/overdue payments, pending
 * справки, overdue follow-ups) into one ranked list -- the same
 * consolidation instinct as the Клиенты workspace, applied to "what should
 * I work on today" instead of "everything about one client". */
export function TodayQueue({ isBoss }: { isBoss: boolean }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [leads, payments, spravki, clients]: [Lead[], Payment[], SpravkaRequest[], Client[]] = await Promise.all([
          api.leads(), api.payments(), api.spravkaRequests(), api.clients(),
        ]);
        const today = new Date().toISOString().slice(0, 10);
        const out: QueueItem[] = [];

        for (const c of clients) {
          if (!c.next_followup_at) continue;
          if (c.next_followup_at > today) continue;
          const overdue = c.next_followup_at < today;
          out.push({
            label: `Связаться: ${c.name || c.phone}`,
            detail: c.next_followup_note || (overdue ? "Просроченный контакт" : "Запланировано на сегодня"),
            color: overdue ? "var(--danger)" : "var(--warning)",
            sortKey: overdue ? 0 : 1,
          });
        }

        for (const p of payments) {
          if (p.status === "paid") continue;
          if (p.status !== "overdue" && !p.due_soon) continue;
          out.push({
            label: `Платёж: ${p.spravka_requests?.client_name || "—"}`,
            detail: `${p.label} · $${p.amount_usd.toLocaleString("en-US")}`,
            color: p.status === "overdue" ? "var(--danger)" : "var(--warning)",
            sortKey: p.status === "overdue" ? 0 : 2,
          });
        }

        for (const l of leads) {
          if (!l.is_stale) continue;
          out.push({
            label: `Лид простаивает: ${l.phone}`,
            detail: l.buy_intent || l.source || "Без движения несколько дней",
            color: "var(--warning)",
            sortKey: 2,
          });
        }

        if (isBoss) {
          for (const s of spravki) {
            if (s.status !== "pending") continue;
            out.push({
              label: `Справка ждёт решения: ${s.client_name}`,
              detail: s.units ? `№${s.units.unit_number} · ${s.units.buildings?.name}` : "—",
              color: "var(--v-accent)",
              sortKey: 1,
            });
          }
        }

        out.sort((a, b) => a.sortKey - b.sortKey);
        setItems(out);
      } catch {
        setItems([]);
      }
    })();
  }, [isBoss]);

  if (items === null) return null;

  return (
    <div className="glass-panel" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)" }}>На сегодня</div>
        {items.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v-accent)", background: "var(--v-accent-tint)", borderRadius: 99, padding: "2px 9px" }}>
            {items.length}
          </span>
        )}
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-faint)", margin: "0 0 12px" }}>
        Просроченные контакты, платежи и справки в одном списке — вместо трёх разных значков.
      </p>
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>Пусто — ничего срочного нет.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.slice(0, 8).map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: it.color, flexShrink: 0, marginTop: 5 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>{it.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>{it.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
