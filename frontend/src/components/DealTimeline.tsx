import { ClientDetail, PLAN_LABELS, STATUS_LABELS } from "@/lib/types";

type Event = { at: string; label: string; detail?: string; color: string };

/** Merges leads, справки, and payment history into one chronological story
 * for this client instead of three separate lists a manager has to cross-
 * reference by eye. There's no stage-history table, so a lead only ever
 * contributes its creation + its current stage (as of its own updated_at) --
 * not every intermediate move, since those aren't recorded anywhere. */
function buildTimeline(detail: ClientDetail): Event[] {
  const events: Event[] = [];

  for (const l of detail.leads) {
    events.push({
      at: l.created_at, label: "Лид создан",
      detail: [l.source, l.buy_intent].filter(Boolean).join(" · ") || undefined,
      color: "var(--v-violet-strong, #7a5cff)",
    });
    if (l.stage !== "unsorted") {
      events.push({ at: l.created_at, label: `Стадия: ${STATUS_LABELS[l.stage] || l.stage}`, color: "#7dd3fc" });
    }
  }

  for (const s of detail.spravka_requests) {
    const unitLabel = s.units ? `№${s.units.unit_number}${s.units.buildings ? ` · ${s.units.buildings.name}` : ""}` : undefined;
    events.push({
      at: s.created_at, label: "Справка создана",
      detail: [unitLabel, PLAN_LABELS[s.plan_type] || s.plan_type].filter(Boolean).join(" · ") || undefined,
      color: "var(--v-accent)",
    });
    if (s.approved_at) {
      events.push({
        at: s.approved_at,
        label: s.status === "rejected" ? "Справка отклонена" : "Справка одобрена",
        color: s.status === "rejected" ? "var(--danger)" : "var(--success)",
      });
    }
  }

  for (const p of detail.payments) {
    if (p.paid_at) {
      events.push({ at: p.paid_at, label: "Платёж оплачен", detail: `${p.label} · $${p.amount_usd.toLocaleString("en-US")}`, color: "var(--success)" });
    }
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function DealTimeline({ detail }: { detail: ClientDetail }) {
  const events = buildTimeline(detail);
  if (events.length === 0) return null;

  return (
    <div className="glass-panel" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 12 }}>
        История сделки
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 3 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: e.color, flexShrink: 0 }} />
              {i < events.length - 1 && <span style={{ width: 1, flex: 1, minHeight: 14, background: "var(--color-hairline-soft)", marginTop: 4 }} />}
            </div>
            <div style={{ paddingBottom: 2 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>{e.label}</div>
              {e.detail && <div style={{ fontSize: 11.5, color: "var(--color-text-soft)", marginTop: 1 }}>{e.detail}</div>}
              <div style={{ fontSize: 10.5, color: "var(--color-text-faint)", marginTop: 2 }}>
                {new Date(e.at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}, {new Date(e.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
