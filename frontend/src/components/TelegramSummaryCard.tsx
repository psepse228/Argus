"use client";
import { TelegramConversation } from "@/lib/types";

/** Sits flush inside ClientWorkspace's advisor panel, directly above
 * ChatThread -- deliberately NOT its own nested glass-panel anymore (that
 * read as two separate AI voices stacked on top of each other, flagged
 * directly during the 2026-08-05 brainstorm). One panel, one advisor: this
 * is that panel's live-conversation section; the Q&A chat below it is the
 * same advisor, just conversational -- and now shares the same context via
 * app/ai/brain.py's gather_client_context. */
export function TelegramSummaryCard({ conversation }: { conversation: TelegramConversation | null }) {
  if (!conversation || (!conversation.summary && !conversation.next_step_suggestion && !conversation.coaching_tip)) return null;
  return (
    <div style={{ paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid var(--color-hairline-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)" }}>
        Разговор в Telegram
      </div>
      {conversation.summary && (
        <div style={{ fontSize: 12.5, color: "var(--color-text)", lineHeight: 1.5 }}>{conversation.summary}</div>
      )}
      {conversation.coaching_tip && (
        <div style={{ fontSize: 12, color: "var(--v-accent)", fontWeight: 600, lineHeight: 1.5 }}>
          💡 {conversation.coaching_tip}
        </div>
      )}
      {conversation.next_step_suggestion && (
        <div style={{ fontSize: 12, color: "var(--color-text-soft)", lineHeight: 1.5 }}>
          → {conversation.next_step_suggestion}
        </div>
      )}
    </div>
  );
}
