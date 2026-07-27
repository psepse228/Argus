"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Client } from "@/lib/types";
import { ClientWorkspace } from "./ClientWorkspace";
import { Skeleton } from "./Skeleton";
import { SpravkaApprovalTable } from "./SpravkaApprovalTable";

/** Мастерская: the set of clients a rep has chosen to actively work on --
 * replaces the old standalone Справки tab. Add a client here (search or a
 * hand-off from Клиенты/Лиды) and you get the full workspace: stage,
 * apartments, справка mode, Cortège+, and an AI chat that reads this
 * client's whole history and keeps advising on the deal as it moves. */
export function WorkshopPanel({
  isBoss, pendingApprovals, initialClientId, onInitialClientHandled,
}: {
  isBoss: boolean;
  /** Clients with a pending справка -- surfaced even if nobody pinned them
   * yet, so a boss's approval queue never disappears just because this is
   * now a curated workspace instead of a flat list of everything. */
  pendingApprovals: { client_id: string; client_name: string }[];
  initialClientId?: string | null;
  onInitialClientHandled?: () => void;
}) {
  const [pinned, setPinned] = useState<Client[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [allClients, setAllClients] = useState<Client[] | null>(null);
  const [showAllRequests, setShowAllRequests] = useState(false);

  useEffect(() => { api.workspace().then(setPinned).catch(() => setPinned([])); }, []);

  useEffect(() => {
    if (initialClientId) {
      setSelectedId(initialClientId);
      onInitialClientHandled?.();
    }
  }, [initialClientId, onInitialClientHandled]);

  async function pin(client: Client) {
    await api.pinToWorkspace(client.id).catch(() => {});
    setPinned((cur) => (cur && cur.some((c) => c.id === client.id) ? cur : [client, ...(cur || [])]));
    setSelectedId(client.id);
    setQuery("");
  }

  async function unpin(clientId: string) {
    await api.unpinFromWorkspace(clientId).catch(() => {});
    setPinned((cur) => cur && cur.filter((c) => c.id !== clientId));
    setSelectedId((cur) => (cur === clientId ? null : cur));
  }

  const q = query.trim().toLowerCase();
  const searchResults = q && allClients
    ? allClients.filter((c) => (c.name || "").toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 6)
    : [];

  const pinnedIds = new Set((pinned || []).map((c) => c.id));
  const unpinnedApprovals = isBoss
    ? Array.from(new Map(pendingApprovals.filter((a) => !pinnedIds.has(a.client_id)).map((a) => [a.client_id, a])).values())
    : [];

  if (showAllRequests) {
    return (
      <AllSpravkaTable
        onBack={() => setShowAllRequests(false)}
        onOpenClient={(id) => { setShowAllRequests(false); setSelectedId(id); }}
      />
    );
  }

  if (selectedId) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => setSelectedId(null)}
            style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-soft)", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 99, padding: "7px 13px", cursor: "pointer" }}
          >
            ← Мастерская
          </button>
          <button
            onClick={() => unpin(selectedId)}
            style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-faint)", background: "transparent", border: "none", cursor: "pointer" }}
          >
            Убрать из Мастерской
          </button>
        </div>
        <ClientWorkspace clientId={selectedId} isBoss={isBoss} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Мастерская</h1>
          <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: 0, maxWidth: 560, lineHeight: 1.5 }}>
            Добавьте клиента, над которым сейчас работаете — бот полностью помогает и советует по сделке: оформит справку, подскажет план оплаты, следующий шаг и что ответить дальше.
          </p>
        </div>
        {isBoss && (
          <button
            onClick={() => setShowAllRequests(true)}
            className="press"
            style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-soft)", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 99, padding: "8px 15px", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}
          >
            Все справки →
          </button>
        )}
      </div>

      <div style={{ position: "relative", maxWidth: 420 }}>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!allClients) api.clients().then(setAllClients).catch(() => {}); }}
          placeholder="Добавить клиента в работу — имя или телефон…"
          style={{ width: "100%", padding: "11px 14px", borderRadius: 12, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
        />
        {searchResults.length > 0 && (
          <div className="glass-panel" style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, zIndex: 10, padding: 6 }}>
            {searchResults.map((c) => (
              <div
                key={c.id}
                onClick={() => pin(c)}
                className="press"
                style={{ padding: "9px 11px", borderRadius: 9, cursor: "pointer", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 10 }}
              >
                <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{c.name || c.phone}</span>
                <span style={{ color: "var(--color-text-faint)", fontSize: 11.5 }}>{c.phone}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {unpinnedApprovals.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--warning)", marginBottom: 10 }}>
            Ждут решения — {unpinnedApprovals.length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {unpinnedApprovals.map((a) => (
              <div
                key={a.client_id}
                onClick={() => setSelectedId(a.client_id)}
                className="glass-panel press"
                style={{ padding: "13px 15px", cursor: "pointer", boxShadow: "0 0 0 1px color-mix(in srgb, var(--warning) 40%, transparent)" }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>{a.client_name}</div>
                <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 3 }}>Справка на согласовании</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", marginBottom: 10 }}>
          В работе {pinned && pinned.length > 0 ? `— ${pinned.length}` : ""}
        </div>
        {!pinned ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} height={56} radius={14} />)}
          </div>
        ) : pinned.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>
            Пока никого не добавили — начните с поиска выше или откройте клиента из Клиенты/Лиды.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {pinned.map((c) => (
              <div key={c.id} onClick={() => setSelectedId(c.id)} className="glass-panel press" style={{ padding: "13px 15px", cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>{c.name || c.phone}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 3 }}>{c.phone}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The boss-only "see everything" view -- the old Справки tab's table
 * (every справка, any status, expand for a real preview, approve/reject
 * inline) still exists, just reached from inside Мастерская instead of
 * being the tab's default content. Approving/rejecting one client's справка
 * one at a time inside ClientWorkspace is fine for working a deal; this is
 * for scanning the whole queue at once. */
function AllSpravkaTable({ onBack, onOpenClient }: { onBack: () => void; onOpenClient: (clientId: string) => void }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-soft)", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 99, padding: "7px 13px", cursor: "pointer" }}>
          ← Мастерская
        </button>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 19, fontWeight: 700, margin: 0, color: "var(--color-text)" }}>Все справки</h1>
      </div>
      <div className="glass-panel" style={{ padding: "6px 22px 10px" }}>
        <SpravkaApprovalTable onOpenClient={onOpenClient} />
      </div>
    </div>
  );
}
