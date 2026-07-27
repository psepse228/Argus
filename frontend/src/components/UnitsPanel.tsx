"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Unit, Building, STATUS_LABELS, STATUS_COLORS } from "@/lib/types";
import { StatusChip } from "./StatusChip";
import { Dropdown } from "./Dropdown";

const SORTS = {
  default: { label: "По умолчанию", fn: null },
  price_asc: { label: "Цена ↑", fn: (a: Unit, b: Unit) => a.area_m2 * a.price_per_m2_usd - b.area_m2 * b.price_per_m2_usd },
  price_desc: { label: "Цена ↓", fn: (a: Unit, b: Unit) => b.area_m2 * b.price_per_m2_usd - a.area_m2 * a.price_per_m2_usd },
  area_asc: { label: "Площадь ↑", fn: (a: Unit, b: Unit) => a.area_m2 - b.area_m2 },
  area_desc: { label: "Площадь ↓", fn: (a: Unit, b: Unit) => b.area_m2 - a.area_m2 },
} as const;

export function UnitsPanel({
  openUnitId, onOpenUnitHandled,
}: {
  /** Set from outside (e.g. global search) to drill straight into a unit. */
  openUnitId?: string | null;
  onOpenUnitHandled?: () => void;
} = {}) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [filter, setFilter] = useState("Все");
  const [statusFilter, setStatusFilter] = useState<string>("Все");
  const [roomFilter, setRoomFilter] = useState<string>("Все");
  const [sort, setSort] = useState<keyof typeof SORTS>("default");
  // Real Macro CRM reference is the "chess grid" (floors × units, colored by
  // status) -- that's now the default view; the filterable card list is kept
  // for when someone actually wants to sort/scan by price or area.
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Unit | null>(null);

  useEffect(() => {
    api.buildings().then(setBuildings);
    api.units().then(setUnits);
  }, []);

  useEffect(() => {
    if (openUnitId && units.length) {
      const u = units.find((x) => x.id === openUnitId);
      if (u) setSelected(u);
      onOpenUnitHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUnitId, units]);

  const roomTypes = useMemo(
    () => Array.from(new Set(units.map((u) => u.room_type).filter(Boolean))) as string[],
    [units]
  );
  const statuses = useMemo(() => Array.from(new Set(units.map((u) => u.status))), [units]);

  const filtered = useMemo(() => {
    let rows = units;
    if (filter !== "Все") rows = rows.filter((u) => u.buildings?.name === filter);
    if (statusFilter !== "Все") rows = rows.filter((u) => u.status === statusFilter);
    if (roomFilter !== "Все") rows = rows.filter((u) => u.room_type === roomFilter);
    const sortFn = SORTS[sort].fn;
    return sortFn ? [...rows].sort(sortFn) : rows;
  }, [units, filter, statusFilter, roomFilter, sort]);

  const groupedForGrid = useMemo(() => {
    const byBuilding = new Map<string, Unit[]>();
    for (const u of filtered) {
      const key = u.buildings?.name || "Без здания";
      if (!byBuilding.has(key)) byBuilding.set(key, []);
      byBuilding.get(key)!.push(u);
    }
    return Array.from(byBuilding.entries());
  }, [filtered]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Юниты</h1>
            <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 16px" }}>{filtered.length} из {units.length} юнитов</p>
          </div>
          <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,.04)", borderRadius: 10, padding: 3, flexShrink: 0 }}>
            {(["grid", "list"] as const).map((v) => (
              <div
                key={v}
                onClick={() => setView(v)}
                className="press"
                style={{
                  padding: "6px 13px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  background: view === v ? "var(--v-accent)" : "transparent",
                  color: view === v ? "var(--v-text-on-accent)" : "var(--color-text-soft)",
                }}
              >
                {v === "grid" ? "Сетка" : "Список"}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {["Все", ...buildings.map((b) => b.name)].map((name) => (
            <div
              key={name}
              onClick={() => setFilter(name)}
              className="press"
              style={{
                padding: "7px 14px", borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                background: filter === name ? "var(--v-accent)" : "rgba(255,255,255,.04)",
                color: filter === name ? "var(--v-text-on-accent)" : "var(--color-text-soft)",
                border: filter === name ? "none" : "1px solid var(--color-hairline-soft)",
              }}
            >
              {name}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
          <Dropdown
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 170 }}
            options={[{ value: "Все", label: "Все статусы" }, ...statuses.map((s) => ({ value: s, label: STATUS_LABELS[s] || s }))]}
          />
          {roomTypes.length > 0 && (
            <Dropdown
              value={roomFilter}
              onChange={setRoomFilter}
              style={{ width: 170 }}
              options={[{ value: "Все", label: "Все типы комнат" }, ...roomTypes.map((r) => ({ value: r, label: r }))]}
            />
          )}
          {view === "list" && (
            <Dropdown
              value={sort}
              onChange={(v) => setSort(v as keyof typeof SORTS)}
              style={{ width: 150 }}
              options={Object.entries(SORTS).map(([k, v]) => ({ value: k, label: v.label }))}
            />
          )}
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-faint)", fontSize: 13 }}>
            Нет юнитов по этим фильтрам — попробуйте сбросить здание, статус или тип комнат.
          </div>
        )}

        {view === "grid" && filtered.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            {groupedForGrid.map(([buildingName, buildingUnits]) => (
              <ChessGrid key={buildingName} buildingName={buildingName} units={buildingUnits} selectedId={selected?.id} onSelect={setSelected} />
            ))}
          </div>
        )}

        {view === "list" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(232px,1fr))", gap: 14 }}>
            {filtered.map((u) => (
              <div key={u.id} onClick={() => setSelected(u)} className="glass-panel press" style={{ padding: "16px 17px", display: "flex", flexDirection: "column", gap: 12, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>
                      {u.buildings?.name} №{u.unit_number}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 3 }}>
                      {u.floor} эт · {u.room_type || "—"} · {u.area_m2} м²
                    </div>
                  </div>
                  <StatusChip status={u.status} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 11, borderTop: "1px solid var(--color-hairline-soft)" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 700, color: "var(--color-text)" }}>
                    ${Math.round(u.area_m2 * u.price_per_m2_usd).toLocaleString("ru-RU")}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{u.assigned_manager || u.client_name || ""}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="glass-panel section-enter" style={{ width: 260, flexShrink: 0, padding: "20px 20px", alignSelf: "flex-start" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>
              {selected.buildings?.name} №{selected.unit_number}
            </div>
            <div onClick={() => setSelected(null)} className="press" style={{ cursor: "pointer", color: "var(--color-text-faint)", fontSize: 13, fontWeight: 700 }}>✕</div>
          </div>
          <div style={{ marginBottom: 14 }}><StatusChip status={selected.status} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12.5, color: "var(--color-text-soft)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Этаж</span><b style={{ color: "var(--color-text)" }}>{selected.floor}</b></div>
            {selected.entrance != null && (
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Подъезд</span><b style={{ color: "var(--color-text)" }}>{selected.entrance}</b></div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Тип</span><b style={{ color: "var(--color-text)" }}>{selected.room_type || "—"}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Площадь</span><b style={{ color: "var(--color-text)" }}>{selected.area_m2} м²</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 9, borderTop: "1px solid var(--color-hairline-soft)" }}>
              <span>Цена</span><b style={{ color: "var(--color-text)" }}>${Math.round(selected.area_m2 * selected.price_per_m2_usd).toLocaleString("ru-RU")}</b>
            </div>
            {(selected.assigned_manager || selected.client_name) && (
              <div style={{ paddingTop: 9, borderTop: "1px solid var(--color-hairline-soft)" }}>
                {selected.assigned_manager && <div>Менеджер: <b style={{ color: "var(--color-text)" }}>{selected.assigned_manager}</b></div>}
                {selected.client_name && <div style={{ marginTop: 4 }}>Клиент: <b style={{ color: "var(--color-text)" }}>{selected.client_name}</b></div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChessGrid({
  buildingName, units, selectedId, onSelect,
}: { buildingName: string; units: Unit[]; selectedId?: string; onSelect: (u: Unit) => void }) {
  const floors = Array.from(new Set(units.map((u) => u.floor))).sort((a, b) => b - a);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--color-text)", marginBottom: 10 }}>{buildingName}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {floors.map((floor) => {
          const inFloor = units
            .filter((u) => u.floor === floor)
            .sort((a, b) => (a.entrance ?? 0) - (b.entrance ?? 0) || a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));
          return (
            <div key={floor} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 22, fontSize: 10.5, fontWeight: 700, color: "var(--color-text-faint)", flexShrink: 0, textAlign: "right" }}>{floor}</span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {inFloor.map((u) => {
                  const c = STATUS_COLORS[u.status] || { bg: "rgba(255,255,255,.06)", fg: "var(--color-text-soft)" };
                  const isSelected = selectedId === u.id;
                  return (
                    <div
                      key={u.id}
                      onClick={() => onSelect(u)}
                      title={`№${u.unit_number} · ${u.floor} эт · ${STATUS_LABELS[u.status] || u.status}`}
                      className="press"
                      style={{
                        width: 38, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9.5, fontWeight: 700, cursor: "pointer", background: c.bg, color: c.fg,
                        border: isSelected ? `1.5px solid ${c.fg}` : "1px solid transparent",
                        boxShadow: isSelected ? `0 0 0 2px color-mix(in srgb, ${c.fg} 30%, transparent)` : "none",
                      }}
                    >
                      {u.unit_number}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
