"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Dropdown } from "./Dropdown";

/** Manual lead intake -- added 2026-08-10 after a live QA pass found there
 * was no way at all in the UI to add a client/lead by hand (a walk-in, a
 * referral, a phone call). Same glass-panel-over-scrim modal shell as
 * ExcelPreviewModal.tsx. */
export function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [buildings, setBuildings] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.buildings().then(setBuildings).catch(() => {});
  }, []);

  async function save() {
    if (!phone.trim()) {
      setError("Введите номер телефона");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createLead({
        client_name: name.trim() || undefined,
        client_phone: phone.trim(),
        building_id: buildingId || undefined,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(`Не удалось создать лид: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel"
        style={{ width: 380, padding: 22, background: "rgba(12,14,18,0.92)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>Новый лид</div>
          <button
            onClick={onClose}
            style={{ background: "var(--surface-06)", border: "1px solid var(--color-hairline)", color: "var(--color-text-soft)", borderRadius: 99, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}
          >
            Закрыть
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11.5, color: "var(--color-text-faint)", display: "block", marginBottom: 6 }}>Имя (необязательно)</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)} placeholder="Иванов"
              style={{ width: "100%", padding: "10px 13px", borderRadius: 11, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: "var(--color-text-faint)", display: "block", marginBottom: 6 }}>Телефон</label>
            <input
              value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 000 00 00"
              style={{ width: "100%", padding: "10px 13px", borderRadius: 11, background: "var(--surface-04)", border: "1px solid var(--color-hairline)", color: "var(--color-text)", fontSize: 13 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: "var(--color-text-faint)", display: "block", marginBottom: 6 }}>Интересующий дом (необязательно)</label>
            <Dropdown
              value={buildingId} onChange={setBuildingId} placeholder="Не выбрано"
              options={buildings.map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</div>}
          <button
            onClick={save} disabled={saving} className="press"
            style={{
              marginTop: 4, fontSize: 13, fontWeight: 700, color: "var(--v-text-on-accent)", background: "var(--v-accent)",
              border: "none", borderRadius: 99, padding: "11px 0", cursor: "pointer",
            }}
          >
            {saving ? "Создаю…" : "Создать лид"}
          </button>
        </div>
      </div>
    </div>
  );
}
