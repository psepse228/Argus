import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";

export function StatusChip({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || { bg: "var(--surface-06)", fg: "var(--color-text-soft)" };
  return (
    <span
      style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em",
        padding: "3px 9px", borderRadius: 99, fontWeight: 700, whiteSpace: "nowrap",
        background: c.bg, color: c.fg,
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
