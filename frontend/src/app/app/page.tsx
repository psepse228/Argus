"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, CurrentUser } from "@/lib/api";
import { Sidebar, Section } from "@/components/Sidebar";
import { AssistantPanel } from "@/components/AssistantPanel";
import { UnitsPanel } from "@/components/UnitsPanel";
import { LeadsPanel } from "@/components/LeadsPanel";
import { ClientsPanel } from "@/components/ClientsPanel";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";

const TITLES: Record<Section, string> = {
  assistant: "Ассистент",
  units: "Юниты",
  leads: "Лиды",
  clients: "Клиенты",
  analytics: "Аналитика",
};

export default function AppPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [section, setSection] = useState<Section>("assistant");
  // Client-side "preview as" toggle for demoing both roles to the client
  // without switching Google accounts -- purely cosmetic: every API call
  // still runs as the real logged-in user, so boss-only endpoints still
  // 403 for a real agent even if they somehow flipped this. Only the real
  // boss account gets the control (see canPreviewRole below).
  const [previewRole, setPreviewRole] = useState<"boss" | "sales_agent" | null>(null);

  useEffect(() => {
    api.me().then((u) => {
      if (!u) router.replace("/");
      else setUser(u);
    });
  }, [router]);

  if (!user) return null;

  const canPreviewRole = user.role === "boss";
  const effectiveUser: CurrentUser = canPreviewRole && previewRole ? { ...user, role: previewRole } : user;
  const isAssistant = section === "assistant";

  function changePreviewRole(r: "boss" | "sales_agent") {
    setPreviewRole(r);
    if (r === "sales_agent" && section === "analytics") setSection("assistant");
  }

  return (
    <div style={{ display: "flex", height: "100vh", minHeight: 720, padding: 16, gap: 16 }}>
      <Sidebar
        user={effectiveUser} active={section} onChange={setSection}
        previewRole={canPreviewRole ? (previewRole || "boss") : undefined}
        onPreviewRoleChange={canPreviewRole ? changePreviewRole : undefined}
      />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Assistant is the primary surface -- it renders its own identity
            (greeting, digest, and now Справки too) instead of sitting under
            the same generic title-bar chrome every data page gets. */}
        {!isAssistant && (
          <div className="glass-panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 18px", flexShrink: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>{TITLES[section]}</div>
              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>Italiano Vero — Milano · Roma · Neapol · Venice · Florencia</div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", textAlign: "right", flexShrink: 0 }}>
              {effectiveUser.email}<br />{effectiveUser.role === "boss" ? "Босс" : "Агент"}
              {previewRole && <div style={{ color: "var(--v-accent)", fontWeight: 700 }}>Предпросмотр</div>}
            </div>
          </div>
        )}

        {section === "assistant" && <AssistantPanel user={effectiveUser} />}
        {section === "units" && <UnitsPanel />}
        {section === "leads" && <LeadsPanel />}
        {section === "clients" && <ClientsPanel user={effectiveUser} />}
        {section === "analytics" && effectiveUser.role === "boss" && <AnalyticsPanel />}
      </div>
    </div>
  );
}
