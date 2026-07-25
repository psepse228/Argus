"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Cell = {
  value: string; rowSpan: number; colSpan: number; bold: boolean;
  fontFamily: string; fontSize: number; align: string; wrap: boolean;
  border: { top: string; bottom: string; left: string; right: string };
};
type PreviewData = { rows: Cell[][]; colWidths: number[]; rowHeights: number[] };

/** Real HUD over the real generated .xlsx -- not a hand-built summary. The
 * grid, fonts, borders, and merges below come straight from the actual
 * stored file (see backend/app/excel_gen/preview.py), so this can never
 * show something different from what "Скачать" gives you. */
export function ExcelPreviewModal({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.spravkaPreview(requestId).then(setData).catch((e) => setError(e.message));
  }, [requestId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel"
        style={{ maxWidth: "95vw", maxHeight: "90vh", overflow: "auto", padding: 20, background: "rgba(12,14,18,0.92)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>
            Просмотр справки
          </div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--color-hairline)", color: "var(--color-text-soft)", borderRadius: 99, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}
          >
            Закрыть
          </button>
        </div>

        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        {!data && !error && <div style={{ color: "var(--color-text-faint)", fontSize: 13 }}>Загрузка…</div>}

        {data && (
          <div style={{ overflow: "auto", borderRadius: 10, background: "#ffffff" }}>
            <table style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                {data.colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <tbody>
                {data.rows.map((row, ri) => (
                  <tr key={ri} style={{ height: data.rowHeights[ri] }}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        rowSpan={cell.rowSpan}
                        colSpan={cell.colSpan}
                        style={{
                          fontFamily: cell.fontFamily, fontSize: cell.fontSize,
                          fontWeight: cell.bold ? 700 : 400,
                          textAlign: cell.align as any, verticalAlign: "middle",
                          whiteSpace: cell.wrap ? "normal" : "nowrap",
                          padding: "2px 4px", color: "#111",
                          borderTop: cell.border.top, borderBottom: cell.border.bottom,
                          borderLeft: cell.border.left, borderRight: cell.border.right,
                        }}
                      >
                        {cell.value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
