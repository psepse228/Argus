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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
        {clients.map((c) => (
          <div
            key={c.id}
            onClick={() => openClient(c.id)}
            className="glass-panel"
            style={{ padding: "16px 17px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 600, color: "var(--color-text)" }}>
              {c.name || c.phone}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>{c.phone}</div>
            <div style={{ display: "flex", gap: 8, paddingTop: 6, borderTop: "1px solid var(--color-hairline-soft)" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-soft)" }}>{c.leads_count} лидов</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v-accent)" }}>{c.spravka_count} справок</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
