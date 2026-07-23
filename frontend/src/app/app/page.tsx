"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, CurrentUser } from "@/lib/api";
import { Sidebar, Section } from "@/components/Sidebar";
import { AssistantPanel } from "@/components/AssistantPanel";
import { UnitsPanel } from "@/components/UnitsPanel";
import { LeadsPanel } from "@/components/LeadsPanel";
import { DocsPanel } from "@/components/DocsPanel";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";

const TITLES: Record<Section, string> = {
  assistant: "Ассистент",
  units: "Юниты",
  leads: "Лиды",
  docs: "Справки",
  analytics: "Аналитика",
};

export default function AppPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [section, setSection] = useState<Section>("assistant");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    api.me().then((u) => {
      if (!u) router.replace("/");
      else setUser(u);
    });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    api.spravkaRequests().then((reqs: any[]) => setPendingCount(reqs.filter((r) => r.status === "pending").length));
  }, [user, section]);

  if (!user) return null;

  return (
    <div style={{ display: "flex", height: "100vh", minHeight: 720, padding: 16, gap: 16 }}>
      <Sidebar user={user} active={section} onChange={setSection} pendingCount={pendingCount} />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="glass-panel" style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 18px", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>{TITLES[section]}</div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>Italiano Vero — Milano · Roma · Neapol · Venice · Florencia</div>
          </div>
        </div>

        {section === "assistant" && <AssistantPanel user={user} />}
        {section === "units" && <UnitsPanel />}
        {section === "leads" && <LeadsPanel />}
        {section === "docs" && <DocsPanel user={user} />}
        {section === "analytics" && user.role === "boss" && <AnalyticsPanel />}
      </div>
    </div>
  );
}
