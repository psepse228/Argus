"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { Unit, Lead, Client } from "@/lib/types";
import { Section } from "./Sidebar";

/** Cmd/Ctrl+K jump-to-anything -- units, leads (by phone), clients (by name
 * or phone) all client-side filtered over data already small enough to fetch
 * whole (a couple dozen units, a modest lead/client base), same as every
 * other panel in this app. Picking a unit or client hands off to the same "open this exact
 * record" plumbing Лиды's "Открыть карточку клиента" already uses. */
export function GlobalSearch({
  open, onOpenChange, onGoTo, onOpenUnit, onOpenClient,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onGoTo: (s: Section) => void;
  onOpenUnit: (unitId: string) => void;
  onOpenClient: (clientId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open && !loaded) {
      Promise.all([api.units(), api.leads(), api.clients()])
        .then(([u, l, c]) => { setUnits(u); setLeads(l); setClients(c); setLoaded(true); })
        .catch(() => {});
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    if (!open) setQuery("");
  }, [open, loaded]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const unitMatches = q ? units.filter((u) => u.unit_number.toLowerCase().includes(q) || u.buildings?.name?.toLowerCase().includes(q)).slice(0, 8) : [];
  const clientMatches = q ? clients.filter((c) => (c.name || "").toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 8) : [];
  const leadMatches = q ? leads.filter((l) => l.phone.includes(q)).slice(0, 8) : [];
  const noResults = !!q && unitMatches.length === 0 && clientMatches.length === 0 && leadMatches.length === 0;

  function close() { onOpenChange(false); }
  function pickUnit(u: Unit) { onGoTo("units"); onOpenUnit(u.id); close(); }
  function pickClient(c: Client) { onOpenClient(c.id); close(); }
  function pickLead() { onGoTo("leads"); close(); }

  return createPortal(
    <div
      onClick={close}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 2000, display: "flex", justifyContent: "center", paddingTop: "12vh" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel section-enter"
        style={{ width: 480, maxWidth: "90vw", maxHeight: "62vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", alignSelf: "flex-start" }}
      >
        <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--color-hairline-soft)", display: "flex", alignItems: "center", gap: 10 }}>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="var(--color-text-faint)" strokeWidth={2} style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Юнит, лид по телефону, клиент по имени…"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--color-text)", fontSize: 14.5 }}
          />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-faint)", background: "rgba(255,255,255,.05)", borderRadius: 6, padding: "2px 6px", flexShrink: 0 }}>ESC</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px" }}>
          {!q && <div style={{ padding: "22px 12px", fontSize: 12.5, color: "var(--color-text-faint)", textAlign: "center" }}>Начните вводить, чтобы искать по юнитам, лидам и клиентам</div>}
          {noResults && <div style={{ padding: "22px 12px", fontSize: 12.5, color: "var(--color-text-faint)", textAlign: "center" }}>Ничего не найдено</div>}
          {unitMatches.length > 0 && (
            <ResultGroup label="Юниты">
              {unitMatches.map((u) => (
                <ResultRow key={u.id} onClick={() => pickUnit(u)} title={`${u.buildings?.name || ""} №${u.unit_number}`} subtitle={`${u.floor} эт · ${u.room_type || "—"} · ${u.area_m2} м²`} />
              ))}
            </ResultGroup>
          )}
          {clientMatches.length > 0 && (
            <ResultGroup label="Клиенты">
              {clientMatches.map((c) => (
                <ResultRow key={c.id} onClick={() => pickClient(c)} title={c.name || c.phone} subtitle={c.phone} />
              ))}
            </ResultGroup>
          )}
          {leadMatches.length > 0 && (
            <ResultGroup label="Лиды">
              {leadMatches.map((l) => (
                <ResultRow key={l.id} onClick={pickLead} title={l.phone} subtitle={l.buy_intent || l.source || "—"} />
              ))}
            </ResultGroup>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-faint)", padding: "8px 10px 4px" }}>{label}</div>
      {children}
    </div>
  );
}

function ResultRow({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="press search-row" style={{ padding: "9px 10px", borderRadius: 9, cursor: "pointer", display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>{title}</span>
      <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{subtitle}</span>
    </div>
  );
}
