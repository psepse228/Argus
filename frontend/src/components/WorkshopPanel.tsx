"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { Client, TelegramConversation } from "@/lib/types";
import { ClientWorkspace } from "./ClientWorkspace";
import { Skeleton } from "./Skeleton";
import { SpravkaApprovalTable } from "./SpravkaApprovalTable";

/** The api client throws `Error("{status} {path}: {rawJsonBody}")` -- pull
 * FastAPI's `detail` back out of that so a validation/collision message
 * from the backend (e.g. "phone already belongs to X") reaches the user
 * instead of a raw "409 /api/...: {...}" string. */
function extractErrorDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const jsonStart = msg.indexOf("{");
  if (jsonStart === -1) return msg;
  try {
    const parsed = JSON.parse(msg.slice(jsonStart));
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {}
  return msg;
}

/** Мастерская: the set of clients a rep has chosen to actively work on --
 * replaces the old standalone Справки tab. Add a client here (search or a
 * hand-off from Клиенты/Лиды) and you get the full workspace: stage,
 * apartments, справка mode, Cortège+, and an AI chat that reads this
 * client's whole history and keeps advising on the deal as it moves. */
export function WorkshopPanel({
  isBoss, pendingApprovals, initialClientId, onInitialClientHandled, onDecided,
}: {
  isBoss: boolean;
  /** Clients with a pending справка -- surfaced even if nobody pinned them
   * yet, so a boss's approval queue never disappears just because this is
   * now a curated workspace instead of a flat list of everything. */
  pendingApprovals: { client_id: string; client_name: string }[];
  initialClientId?: string | null;
  onInitialClientHandled?: () => void;
  /** Bubbled up to Ассистент's digest refresh after an approve/reject in
   * "Все справки" -- otherwise the pending badge stays stale until reload. */
  onDecided?: () => void;
}) {
  const [pinned, setPinned] = useState<Client[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [allClients, setAllClients] = useState<Client[] | null>(null);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [unmatchedTelegram, setUnmatchedTelegram] = useState<TelegramConversation[] | null>(null);
  const [recentMatchedTelegram, setRecentMatchedTelegram] = useState<
    (TelegramConversation & { clients: { name: string | null; phone: string } | null })[] | null
  >(null);
  // Which unmatched conversation the inline "attach to client" picker is open
  // for -- reuses the same allClients/pin machinery the main search box
  // already has, just a second entry point into it.
  const [linkingConvId, setLinkingConvId] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  // Separate from linkQuery/search -- typing a name doesn't look like a
  // phone number, so gating "create new" on linkQueryLooksLikePhone alone
  // left no way to create a client from this modal unless you happened to
  // type digits. This is its own explicit mode instead.
  const [creatingNew, setCreatingNew] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => { api.workspace().then(setPinned).catch(() => setPinned([])); }, []);
  useEffect(() => { api.telegramUnmatched().then(setUnmatchedTelegram).catch(() => setUnmatchedTelegram([])); }, []);
  useEffect(() => { api.telegramRecentMatched().then(setRecentMatchedTelegram).catch(() => setRecentMatchedTelegram([])); }, []);

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

  async function linkTelegramToClient(client: Client) {
    if (!linkingConvId) return;
    setLinkError("");
    try {
      await api.telegramLinkConversation(linkingConvId, { client_id: client.id });
      setUnmatchedTelegram((cur) => (cur || []).filter((c) => c.id !== linkingConvId));
      setLinkingConvId(null);
      setLinkQuery("");
      pin(client);
    } catch (e) {
      setLinkError(extractErrorDetail(e));
    }
  }

  async function linkTelegramToNewClient(name: string, phone: string) {
    if (!linkingConvId) return;
    setLinkError("");
    try {
      const updated = await api.telegramLinkConversation(linkingConvId, { new_client_name: name, new_client_phone: phone });
      setUnmatchedTelegram((cur) => (cur || []).filter((c) => c.id !== linkingConvId));
      setLinkingConvId(null);
      setLinkQuery("");
      setCreatingNew(false);
      setNewClientName("");
      setNewClientPhone("");
      if (updated.client_id) await openRecentTelegramClient(updated.client_id);
    } catch (e) {
      setLinkError(extractErrorDetail(e));
    }
  }

  async function openRecentTelegramClient(clientId: string) {
    await api.pinToWorkspace(clientId).catch(() => {});
    api.workspace().then(setPinned).catch(() => {});
    setSelectedId(clientId);
  }

  useEffect(() => {
    if (linkingConvId && !allClients) api.clients().then(setAllClients).catch(() => {});
  }, [linkingConvId, allClients]);

  // Reset the picker whenever the rep navigates away from the Мастерская
  // list (into a client's workspace) and back, so it doesn't silently stay
  // open with stale typed text.
  useEffect(() => {
    setLinkingConvId(null);
    setLinkQuery("");
    setCreatingNew(false);
    setNewClientName("");
    setNewClientPhone("");
    setLinkError("");
  }, [selectedId]);

  // Rendered as a centered modal (backdrop + portal), not an anchored
  // popover -- an anchored box next to the trigger card sat right in the
  // middle of the "В работе" grid and read as overlapping/broken clutter.
  // A modal is unambiguous about what's interactive, and side-steps the
  // .glass-panel overflow:hidden clipping issue Dropdown.tsx documents.
  useEffect(() => {
    if (!linkingConvId) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setLinkingConvId(null);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [linkingConvId]);

  const q = query.trim().toLowerCase();
  const searchResults = q && allClients
    ? allClients.filter((c) => (c.name || "").toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 6)
    : [];

  const pinnedIds = new Set((pinned || []).map((c) => c.id));
  const unpinnedApprovals = isBoss
    ? Array.from(new Map(pendingApprovals.filter((a) => !pinnedIds.has(a.client_id)).map((a) => [a.client_id, a])).values())
    : [];
  const newTelegramClients = (recentMatchedTelegram || []).filter((c) => c.client_id && !pinnedIds.has(c.client_id));
  // Mirrors backend/app/telegram/matching.py's normalize_phone: strip
  // everything but digits, then sanity-check the resulting length rather
  // than gating on punctuation the backend strips anyway (parens included).
  const linkQueryDigits = linkQuery.trim().replace(/\D/g, "");
  const linkQueryLooksLikePhone = linkQueryDigits.length >= 9 && linkQueryDigits.length <= 12;

  if (showAllRequests) {
    return (
      <AllSpravkaTable
        onBack={() => setShowAllRequests(false)}
        onOpenClient={(id) => { setShowAllRequests(false); setSelectedId(id); }}
        onDecided={onDecided}
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
        <ClientWorkspace clientId={selectedId} isBoss={isBoss} onDecided={onDecided} />
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

      {newTelegramClients.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "#2AABEE", marginBottom: 10 }}>
            Новое в Telegram — {newTelegramClients.length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {newTelegramClients.map((c) => (
              <div
                key={c.id}
                onClick={() => openRecentTelegramClient(c.client_id!)}
                className="glass-panel press"
                style={{ padding: "13px 15px", cursor: "pointer", boxShadow: "0 0 0 1px color-mix(in srgb, #2AABEE 40%, transparent)" }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
                  {c.clients?.name || c.clients?.phone || "Клиент"}
                </div>
                <div style={{ fontSize: 11, color: "#2AABEE", marginTop: 3 }}>Новое сообщение в Telegram</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {unmatchedTelegram && unmatchedTelegram.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "#2AABEE", marginBottom: 10 }}>
            Непривязанные Telegram-чаты — {unmatchedTelegram.length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {unmatchedTelegram.map((c) => (
              <div
                key={c.id}
                onClick={() => { setLinkingConvId(linkingConvId === c.id ? null : c.id); setLinkError(""); }}
                className="glass-panel press"
                style={{ padding: "13px 15px", cursor: "pointer", boxShadow: "0 0 0 1px color-mix(in srgb, #2AABEE 40%, transparent)" }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
                  {c.telegram_first_name || c.telegram_username || "Без имени"}
                </div>
                <div style={{ fontSize: 11, color: "#2AABEE", marginTop: 3 }}>Кто это? Нажмите, чтобы привязать</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {linkingConvId && (() => {
        const c = unmatchedTelegram?.find((x) => x.id === linkingConvId);
        if (!c) return null;
        return createPortal(
          <div
            onClick={() => setLinkingConvId(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.55)",
              display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "80px 20px",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="glass-panel"
              style={{
                width: "100%", maxWidth: 420, padding: 18,
                background: "var(--v-bg-soft)", boxShadow: "0 24px 48px -20px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 2 }}>
                Кто это? — {c.telegram_first_name || c.telegram_username || "Без имени"}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginBottom: 12 }}>
                Привяжите Telegram-чат к существующему клиенту или создайте нового.
              </div>
              {linkError && (
                <div style={{ fontSize: 12, color: "var(--danger)", background: "var(--danger-tint)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
                  {linkError}
                </div>
              )}

              {!creatingNew ? (
                <>
                  <input
                    autoFocus
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                    placeholder="Имя или телефон существующего клиента…"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13, marginBottom: 10 }}
                  />
                  {linkQuery.trim() && (allClients || [])
                    .filter((cl) => (cl.name || "").toLowerCase().includes(linkQuery.trim().toLowerCase()) || cl.phone.includes(linkQuery.trim()))
                    .slice(0, 5)
                    .map((cl) => (
                      <div
                        key={cl.id} onClick={() => linkTelegramToClient(cl)} className="press"
                        style={{ padding: "9px 11px", borderRadius: 8, cursor: "pointer", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 8 }}
                      >
                        <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{cl.name || cl.phone}</span>
                        <span style={{ color: "var(--color-text-faint)", fontSize: 11.5 }}>{cl.phone}</span>
                      </div>
                    ))}
                  {linkQueryLooksLikePhone && (
                    <div
                      onClick={() => linkTelegramToNewClient(c.telegram_first_name || "", linkQuery.trim())}
                      className="press"
                      style={{ padding: "9px 11px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "var(--v-accent)", fontWeight: 700 }}
                    >
                      + Создать нового клиента с номером {linkQuery.trim()}
                    </div>
                  )}
                  <div
                    onClick={() => { setCreatingNew(true); setNewClientName(c.telegram_first_name || ""); }}
                    className="press"
                    style={{ padding: "9px 11px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "var(--v-accent)", fontWeight: 700, marginTop: 4, borderTop: "1px solid var(--color-hairline-soft)" }}
                  >
                    + Создать новую карточку клиента
                  </div>
                  <button
                    onClick={() => setLinkingConvId(null)}
                    style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--color-text-soft)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Отмена
                  </button>
                </>
              ) : (
                <>
                  <input
                    autoFocus
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Имя клиента"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13, marginBottom: 8 }}
                  />
                  <input
                    value={newClientPhone}
                    onChange={(e) => setNewClientPhone(e.target.value)}
                    placeholder="Телефон (обязательно)"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13, marginBottom: 10 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="press"
                      disabled={newClientPhone.replace(/\D/g, "").length < 9}
                      onClick={() => linkTelegramToNewClient(newClientName.trim(), newClientPhone.trim())}
                      style={{
                        flex: 1, padding: "9px 11px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700,
                        background: "var(--v-accent)", color: "var(--v-text-on-accent)", border: "none",
                        opacity: newClientPhone.replace(/\D/g, "").length < 9 ? 0.5 : 1,
                      }}
                    >
                      Создать и привязать
                    </button>
                    <button
                      onClick={() => { setCreatingNew(false); setLinkError(""); }}
                      style={{ padding: "9px 13px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "var(--color-text-soft)", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", cursor: "pointer" }}
                    >
                      Назад
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        );
      })()}

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
function AllSpravkaTable({
  onBack, onOpenClient, onDecided,
}: { onBack: () => void; onOpenClient: (clientId: string) => void; onDecided?: () => void }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-soft)", background: "rgba(255,255,255,.04)", border: "1px solid var(--color-hairline)", borderRadius: 99, padding: "7px 13px", cursor: "pointer" }}>
          ← Мастерская
        </button>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 19, fontWeight: 700, margin: 0, color: "var(--color-text)" }}>Все справки</h1>
      </div>
      <div className="glass-panel" style={{ padding: "6px 22px 10px" }}>
        <SpravkaApprovalTable onOpenClient={onOpenClient} onDecided={onDecided} />
      </div>
    </div>
  );
}
