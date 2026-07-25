"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Unit, Building, STATUS_LABELS } from "@/lib/types";
import { StatusChip } from "./StatusChip";

const SORTS = {
  default: { label: "По умолчанию", fn: null },
  price_asc: { label: "Цена ↑", fn: (a: Unit, b: Unit) => a.area_m2 * a.price_per_m2_usd - b.area_m2 * b.price_per_m2_usd },
  price_desc: { label: "Цена ↓", fn: (a: Unit, b: Unit) => b.area_m2 * b.price_per_m2_usd - a.area_m2 * a.price_per_m2_usd },
  area_asc: { label: "Площадь ↑", fn: (a: Unit, b: Unit) => a.area_m2 - b.area_m2 },
  area_desc: { label: "Площадь ↓", fn: (a: Unit, b: Unit) => b.area_m2 - a.area_m2 },
} as const;

export function UnitsPanel() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [filter, setFilter] = useState("Все");
  const [statusFilter, setStatusFilter] = useState<string>("Все");
  const [roomFilter, setRoomFilter] = useState<string>("Все");
  const [sort, setSort] = useState<keyof typeof SORTS>("default");

  useEffect(() => {
    api.buildings().then(setBuildings);
    api.units().then(setUnits);
  }, []);

  const roomTypes = useMemo(
    () => Array.from(new Set(units.map((u) => u.room_type).filter(Boolean))) as string[],
    [units]
  );
  const statuses = useMemo(() => Array.from(new Set(units.map((u) => u.status))), [units]);

  const filtered = useMemo(() => {
    let rows = units;
    if (filter !== "Все") rows = rows.filter((u) => u.buildings?.name === filter || u.building_id === filter);
    if (statusFilter !== "Все") rows = rows.filter((u) => u.status === statusFilter);
    if (roomFilter !== "Все") rows = rows.filter((u) => u.room_type === roomFilter);
    const sortFn = SORTS[sort].fn;
    return sortFn ? [...rows].sort(sortFn) : rows;
  }, [units, filter, statusFilter, roomFilter, sort]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Юниты</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 16px" }}>{filtered.length} из {units.length} юнитов</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {["Все", ...buildings.map((b) => b.name)].map((name) => (
          <div
            key={name}
            onClick={() => setFilter(name)}
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
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={chipSelectStyle}>
          <option value="Все">Все статусы</option>
          {statuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
        </select>
        {roomTypes.length > 0 && (
          <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} style={chipSelectStyle}>
            <option value="Все">Все типы комнат</option>
            {roomTypes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)} style={chipSelectStyle}>
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(232px,1fr))", gap: 14 }}>
        {filtered.map((u) => (
          <div key={u.id} className="glass-panel" style={{ padding: "16px 17px", display: "flex", flexDirection: "column", gap: 12 }}>
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
    </div>
  );
}

const chipSelectStyle: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 99, fontSize: 12.5, fontWeight: 600,
  background: "rgba(255,255,255,.04)", color: "var(--color-text-soft)",
  border: "1px solid var(--color-hairline-soft)", cursor: "pointer",
};
