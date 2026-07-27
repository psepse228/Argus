"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PLAN_LABELS, SpravkaRequest } from "@/lib/types";
import { ExcelPreviewModal } from "./ExcelPreviewModal";
import { Skeleton } from "./Skeleton";
import { StatusChip } from "./StatusChip";

const primaryBtnStyle: React.CSSProperties = { padding: "6px 12px", borderRadius: 99, background: "var(--v-accent)", color: "var(--v-text-on-accent)", fontSize: 11.5, fontWeight: 700, border: "none", cursor: "pointer" };

/** The real "see the actual Справка" table -- every row expands into a real
 * preview of the generated .xlsx (fonts/borders/merges, not a hand-built
 * summary), plus download and approve/reject. Shared by Обзор's Одобрения
 * quick-tab (onlyPending) and Мастерская's "Все справки" (every status) --
 * one implementation instead of two copies drifting apart. */
export function SpravkaApprovalTable({
  onlyPending, onOpenClient,
}: {
  onlyPending?: boolean;
  onOpenClient?: (clientId: string) => void;
}) {
  const [requests, setRequests] = useState<SpravkaRequest[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  async function refresh() {
    const all = await api.spravkaRequests();
    setRequests(onlyPending ? all.filter((r: SpravkaRequest) => r.status === "pending") : all);
  }
  useEffect(() => { refresh(); }, [onlyPending]);

  async function act(id: string, decision: "approve" | "reject") {
    setActionError("");
    try {
      await (decision === "approve" ? api.approveSpravka(id) : api.rejectSpravka(id));
      await refresh();
    } catch (e: any) {
      setActionError(e.message);
    }
  }

  if (!requests) {
    return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div>;
  }

  return (
    <div>
      {actionError && <div style={{ fontSize: 12.5, color: "var(--danger)", padding: "0 4px 10px" }}>{actionError}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.2fr 1fr 1fr 0.9fr auto", gap: 14, padding: "10px 4px", borderBottom: "1px solid var(--color-hairline)", fontSize: 11, color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: ".05em" }}>
        <span>Юнит</span><span>План</span><span>Клиент</span><span>Кем создано</span><span>Статус</span><span></span>
      </div>
      {requests.map((r) => {
        const s = r.computed_summary;
        const isOpen = expandedId === r.id;
        return (
          <div key={r.id} style={{ borderBottom: "1px solid var(--color-hairline-soft)" }}>
            <div
              onClick={() => setExpandedId(isOpen ? null : r.id)}
              style={{ display: "grid", gridTemplateColumns: "1.3fr 1.2fr 1fr 1fr 0.9fr auto", gap: 14, padding: "15px 4px", alignItems: "center", fontSize: 13, cursor: "pointer" }}
            >
              <span style={{ color: "var(--color-text)", fontWeight: 600 }}>
                {r.units ? <>№{r.units.unit_number} · {r.units.buildings?.name}</> : "—"}
              </span>
              <span style={{ color: "var(--color-text-soft)" }}>{PLAN_LABELS[r.plan_type] || r.plan_type}</span>
              <span
                onClick={(e) => { if (r.client_id && onOpenClient) { e.stopPropagation(); onOpenClient(r.client_id); } }}
                style={{ color: r.client_id && onOpenClient ? "var(--v-accent)" : "var(--color-text-soft)", fontWeight: r.client_id && onOpenClient ? 700 : 400, cursor: r.client_id && onOpenClient ? "pointer" : "default" }}
              >
                {r.client_name}
              </span>
              <span style={{ color: "var(--color-text-soft)" }}>{r.requested_by}</span>
              <span><StatusChip status={r.status} /></span>
              <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                {r.generated_file_url && (
                  <>
                    <button
                      onClick={() => setPreviewId(r.id)}
                      style={{ padding: "6px 12px", borderRadius: 99, background: "var(--v-accent-tint)", border: "1px solid transparent", color: "var(--v-accent)", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      Просмотр
                    </button>
                    <a href={api.spravkaDownloadUrl(r.id)} style={{ padding: "6px 12px", borderRadius: 99, background: "rgba(255,255,255,.05)", border: "1px solid var(--color-hairline)", color: "var(--color-text-soft)", fontSize: 11.5, fontWeight: 600 }}>
                      Скачать
                    </a>
                  </>
                )}
                {r.status === "pending" && (
                  <>
                    <button onClick={() => act(r.id, "approve")} style={primaryBtnStyle}>Одобрить</button>
                    <button onClick={() => act(r.id, "reject")} style={{ padding: "6px 12px", borderRadius: 99, background: "transparent", color: "var(--color-text-soft)", fontSize: 11.5, fontWeight: 600, border: "1px solid var(--color-hairline)", cursor: "pointer" }}>Отклонить</button>
                  </>
                )}
              </div>
            </div>
            {isOpen && (
              <div style={{ padding: "4px 4px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                {!s && (
                  <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: "var(--color-text-faint)" }}>
                    Предпросмотр недоступен для справок, сгенерированных до этого обновления — скачайте файл.
                  </div>
                )}
                {s && (
                  <>
                    <PreviewStat label="Площадь" value={r.units ? `${r.units.area_m2} м²` : "—"} />
                    <PreviewStat label="Цена/м² (реальная)" value={`$${s.effective_price_per_m2_usd.toLocaleString()}`} />
                    {r.requested_price_per_m2_usd != null && (
                      <PreviewStat label="Запрошенная цена" value={`$${r.requested_price_per_m2_usd.toLocaleString()}/м²`} />
                    )}
                    <PreviewStat label="Итого" value={`$${s.effective_total_usd.toLocaleString()}`} />
                    <PreviewStat label="Условие" value={s.payment_label.trim()} />
                    {s.monthly_payment_usd > 0 && (
                      <>
                        <PreviewStat label="Первый взнос" value={`$${s.down_payment_usd.toLocaleString()}`} />
                        <PreviewStat label="Остаток" value={`$${s.remaining_usd.toLocaleString()}`} />
                        <PreviewStat label="Ежемесячно" value={`$${s.monthly_payment_usd.toLocaleString()}`} />
                        {s.balloon_remaining_usd > 0 && (
                          <PreviewStat label="Остаток после частичной оплаты" value={`$${s.balloon_remaining_usd.toLocaleString()}`} />
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {requests.length === 0 && <div style={{ padding: "30px 0", textAlign: "center", color: "var(--color-text-faint)", fontSize: 13 }}>Пока нет сгенерированных справок</div>}
      {previewId && <ExcelPreviewModal requestId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,.03)", border: "1px solid var(--color-hairline-soft)" }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--color-text-faint)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>{value}</div>
    </div>
  );
}
