"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { TelegramConversation } from "@/lib/types";
import { Skeleton } from "./Skeleton";

type Conv = TelegramConversation & { clients: { name: string | null; phone: string } | null };

const MAX_ITEMS = 6;

/** UI/UX audit (2026-08): live Telegram monitoring -- summarized, drafted
 * replies, meeting detection -- only became visible once a manager already
 * knew to open a specific client in Мастерская. This surfaces it on Обзор
 * instead: who's mid-conversation right now, and who has an unanswered
 * message waiting. draft_reply is cleared the moment a reply is actually
 * sent (see telegram_business.py's send_reply), so its presence IS the
 * "still waiting on you" signal -- no separate tracking needed. */
export function LiveConversationsCard({ onOpenClient }: { onOpenClient: (clientId: string) => void }) {
  const [conversations, setConversations] = useState<Conv[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.telegramRecentMatched()
      .then((data) => setConversations(data as Conv[]))
      .catch((e: any) => setError(`Не удалось загрузить переписки: ${e.message}`));
  }, []);

  if (conversations === null && !error) {
    return (
      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)", marginBottom: 12 }}>В переписке сейчас</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1].map((i) => <Skeleton key={i} height={32} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)", marginBottom: 8 }}>В переписке сейчас</div>
        <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div>
      </div>
    );
  }

  const list = conversations ?? [];
  if (list.length === 0) return null; // nothing to show -- don't clutter Обзор with an empty card

  const waiting = list.filter((c) => c.draft_reply).length;
  const visible = [...list].sort((a, b) => (b.draft_reply ? 1 : 0) - (a.draft_reply ? 1 : 0)).slice(0, MAX_ITEMS);

  return (
    <div className="glass-panel" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)" }}>В переписке сейчас</div>
        {waiting > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)", background: "var(--danger-tint)", borderRadius: 99, padding: "2px 9px" }}>
            {waiting} ждут ответа
          </span>
        )}
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-faint)", margin: "0 0 12px" }}>
        Живой мониторинг Telegram — Argus сам следит и предлагает ответ.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.map((c) => (
          <div
            key={c.id}
            onClick={() => c.client_id && onOpenClient(c.client_id)}
            role={c.client_id ? "button" : undefined}
            tabIndex={c.client_id ? 0 : undefined}
            onKeyDown={(e) => { if (c.client_id && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpenClient(c.client_id); } }}
            className={c.client_id ? "press" : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10,
              background: c.draft_reply ? "var(--danger-tint)" : "var(--surface-04)",
              cursor: c.client_id ? "pointer" : "default",
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: 99, flexShrink: 0,
              background: c.draft_reply ? "var(--danger)" : "var(--color-text-faint)",
            }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.clients?.name || c.clients?.phone || c.telegram_first_name || "Без имени"}
              </div>
              {c.summary && (
                <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.summary}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
