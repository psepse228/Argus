"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Unit, Building } from "@/lib/types";
import { StatusChip } from "./StatusChip";

export function UnitsPanel() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [filter, setFilter] = useState("Все");

  useEffect(() => {
    api.buildings().then(setBuildings);
    api.units().then(setUnits);
  }, []);

  const filtered = filter === "Все" ? units : units.filter((u) => u.buildings?.name === filter || u.building_id === filter);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 23, fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>Юниты</h1>
      <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 16px" }}>{filtered.length} из {units.length} юнитов</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
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
