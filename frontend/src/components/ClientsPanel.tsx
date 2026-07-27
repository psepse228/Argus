"use client";
import { useEffect, useState } from "react";
import { api, CurrentUser } from "@/lib/api";
import { Client, ClientDetail, STATUS_LABELS, PLAN_LABELS } from "@/lib/types";
import { ChatThread } from "./ChatThread";

/** Before this, a "client" was just free-text (name, phone) duplicated
 * independently across Лиды and Справки, with no single place to see one
 * person's whole history. Here the same client's leads, справки, and their
 * own profile-chat (see ChatThread) live together -- and the assistant in
 * that chat is given this exact history as context (see
 * app/ai/prompts.py::client_context_prompt), not generic advice. */
export function ClientsPanel({ user }: { user: CurrentUser }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<ClientDetail | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [spravkaMode, setSpravkaMode] = useState(false);

  useEffect(() => { api.clients().then(setClients); }, []);

  async function openClient(id: string) {
    setSelected(null);
    setConversationId(null);
    const [detail, conv] = await Promise.all([api.clientDetail(id), api.clientConversation(id)]);
    setSelected(detail);
    setConversationId(conv.id);
  }

  if (selected) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 16 }}>
        <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <button
            onClick={() => setSelected(null)}
            style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, color: "var(--color-text-soft)", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 99, padding: "7px 13px", cursor: "pointer" }}
          >
            ← Все клиенты
          </button>
          <div className="glass-panel" style={{ padding: "18px 20px" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>
              {selected.name || selected.phone}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--color-text-faint)", marginTop: 3 }}>{selected.phone}</div>
          </div>

          {selected.leads.length > 0 && (
            <div className="glass-panel" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>Лиды</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selected.leads.map((l) => (
                  <div key={l.id} style={{ fontSize: 12.5, color: "var(--color-text-soft)" }}>
                    {STATUS_LABELS[l.stage] || l.stage}{l.source ? ` · ${l.source}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selected.spravka_requests.length > 0 && (
            <div className="glass-panel" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>Справки</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {selected.spravka_requests.map((s) => (
                  <div key={s.id}>
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
              </div>
            </div>
          )}
        </div>

        <div className="glass-panel" style={{ flex: 1, minHeight: 0, padding: "20px 22px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>
              Чат с {selected.name || selected.phone}
            </div>
            <div
              data-quick-trigger
              onClick={() => setSpravkaMode((v) => !v)}
              style={{
                fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: "6px 13px", borderRadius: 99,
                color: spravkaMode ? "var(--v-text-on-accent)" : "var(--v-accent)",
                background: spravkaMode ? "var(--v-accent)" : "var(--v-accent-tint)",
              }}
            >
              {spravkaMode ? "Режим включён" : "Оформить справку"}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, paddingTop: 14 }}>
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
        {clients.map((c) => <ClientCard key={c.id} client={c} onOpen={() => openClient(c.id)} />)}
      </div>
    </div>
  );
}

function ClientCard({ client: c, onOpen }: { client: Client; onOpen: () => void }) {
  const active = c.leads_count > 0 || c.spravka_count > 0;
  const initial = (c.name || c.phone).trim()[0]?.toUpperCase() || "?";

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
      onClick={onOpen}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="glass-panel"
      style={{
        padding: "18px 19px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 12,
        opacity: active ? 1 : 0.6, transition: "transform .12s ease, box-shadow .2s ease, opacity .2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{
          width: 38, height: 38, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 14, color: "#fff",
          background: active
            ? "linear-gradient(150deg, var(--v-violet-strong, #7a5cff), var(--v-violet, #5b3fc4))"
            : "rgba(255,255,255,.08)",
        }}>
          {initial}
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
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
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
