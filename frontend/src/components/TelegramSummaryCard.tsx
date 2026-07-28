"use client";
import { TelegramConversation } from "@/lib/types";

/** The right-column "Итог диалога" block above ClientWorkspace's existing
 * AI-assistant ChatThread -- surfaces the bot's per-message evaluation
 * (summary + next-step) of the live Telegram thread, kept fully separate
 * from the rep-facing assistant chat below it. */
export function TelegramSummaryCard({ conversation }: { conversation: TelegramConversation | null }) {
  if (!conversation || (!conversation.summary && !conversation.next_step_suggestion)) return null;
  return (
    <div className="glass-panel" style={{ padding: "14px 16px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)" }}>
        Итог диалога в Telegram
      </div>
      {conversation.summary && (
        <div style={{ fontSize: 12.5, color: "var(--color-text)", lineHeight: 1.5 }}>{conversation.summary}</div>
      )}
      {conversation.next_step_suggestion && (
        <div style={{ fontSize: 12, color: "var(--v-accent)", fontWeight: 600, lineHeight: 1.5 }}>
          → {conversation.next_step_suggestion}
        </div>
      )}
    </div>
  );
}
