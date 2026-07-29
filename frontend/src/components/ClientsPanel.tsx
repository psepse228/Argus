"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Client, PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/types";
import { ClientInfoCard } from "./ClientInfoCard";
import { Skeleton } from "./Skeleton";

const PRIORITY_RANK: Record<string, number> = { hot: 0, warm: 1, cold: 2 };

/** Just the directory now -- browse and quick-edit a client's priority/next
 * contact. Actually working a client (chat, справка, Cortège+) is
 * Мастерская's job (see AssistantPanel.tsx / ClientWorkspace.tsx), reached
 * via the "Открыть в Мастерской" button inside ClientInfoCard, not a click
 * on the card itself. */
export function ClientsPanel({
  openClientId, onOpenClientHandled, onOpenWorkspace,
}: {
  /** Set from outside (e.g. Лиды's "Открыть карточку клиента" button) to
   * drill straight into a client instead of landing on the plain list. */
  openClientId?: string | null;
  onOpenClientHandled?: () => void;
  onOpenWorkspace: (clientId: string) => void;
}) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Open by default -- collapsed-by-default left the page looking empty
  // whenever most clients are still bare phone numbers from leads (e.g. 7
  // of 11), since the named grid alone doesn't fill the panel. Still
  // collapsible once there are enough named clients that this becomes noise.
  const [showUnnamed, setShowUnnamed] = useState(true);

  useEffect(() => { api.clients().then(setClients).catch(() => setClients([])); }, []);

  useEffect(() => {
    if (openClientId) {
      setSelectedId(openClientId);
      onOpenClientHandled?.();
    }
  }, [openClientId, onOpenClientHandled]);

  const modal = selectedId && (
    <ClientInfoCard
      clientId={selectedId}
      onClose={() => setSelectedId(null)}
      onOpenWorkspace={onOpenWorkspace}
    />
  );

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
        {modal}
      </div>
    );
  }

  function rank(a: Client, b: Client): number {
    const pa = a.priority ? PRIORITY_RANK[a.priority] : 3;
    const pb = b.priority ? PRIORITY_RANK[b.priority] : 3;
    if (pa !== pb) return pa - pb;
    const activeA = a.leads_count + a.spravka_count > 0 ? 0 : 1;
    const activeB = b.leads_count + b.spravka_count > 0 ? 0 : 1;
    if (activeA !== activeB) return activeA - activeB;
    return (a.name || a.phone).localeCompare(b.name || b.phone);
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? clients.filter((c) => (c.name || "").toLowerCase().includes(q) || c.phone.includes(q)) : clients;

  // A real name is the actual signal of "someone worth looking at" -- a bare
  // phone number is just a lead that was never named, and there are dozens
  // of those (see 0009's seed leads). Splitting them out is what actually
  // fixes the "paper pile" feel -- sorting alone still put 20 phone-number
  // cards in the same grid as 2 real people.
  const named = [...filtered.filter((c) => c.name)].sort(rank);
  const unnamed = [...filtered.filter((c) => !c.name)].sort(rank);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Клиенты</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 16px" }}>{clients.length} клиентов — их лиды, справки и переписка в одном месте</p>
      {clients.length === 0 && (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет клиентов — появятся из лидов и справок.</div>
      )}
      {clients.length > 0 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени или телефону…"
          style={{ width: "100%", maxWidth: 360, padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13, marginBottom: 20 }}
        />
      )}

      {named.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16, marginBottom: unnamed.length > 0 ? 22 : 0 }}>
          {named.map((c, i) => <ClientCard key={c.id} client={c} index={i} onOpen={() => setSelectedId(c.id)} />)}
        </div>
      )}

      {unnamed.length > 0 && (
        <div>
          <div
            onClick={() => setShowUnnamed((v) => !v)}
            className="press"
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: showUnnamed ? 12 : 0 }}
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="var(--color-text-faint)" strokeWidth={2.5} style={{ transform: showUnnamed ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}>
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)" }}>
              Без имени (только телефон из лида) — {unnamed.length}
            </span>
          </div>
          {showUnnamed && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {unnamed.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className="press"
                  style={{
                    fontSize: 12, color: "var(--color-text-faint)", background: "rgba(255,255,255,.03)",
                    border: "1px solid var(--color-hairline-soft)", borderRadius: 99, padding: "6px 13px", cursor: "pointer",
                  }}
                >
                  {c.phone}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {named.length === 0 && unnamed.length === 0 && q && (
        <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Ничего не найдено по «{query}».</div>
      )}
      {modal}
    </div>
  );
}

function ClientCard({ client: c, index, onOpen }: { client: Client; index: number; onOpen: () => void }) {
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

  return (
    <div
      ref={cardRef}
      onClick={onOpen}
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
    </div>
  );
}
