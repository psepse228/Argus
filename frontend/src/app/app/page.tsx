"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, CurrentUser } from "@/lib/api";
import { SpaceIndicator, Section, SPACES } from "@/components/SpaceIndicator";
import { HudToolbar } from "@/components/HudToolbar";
import { AssistantPanel } from "@/components/AssistantPanel";
import { UnitsPanel } from "@/components/UnitsPanel";
import { LeadsPanel } from "@/components/LeadsPanel";
import { ClientsPanel } from "@/components/ClientsPanel";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { CalendarPanel } from "@/components/CalendarPanel";
import { AiJournalPanel } from "@/components/AiJournalPanel";
import { AssistantWidget } from "@/components/AssistantWidget";
import { GlobalSearch } from "@/components/GlobalSearch";
import { HelpChatWidget } from "@/components/HelpChatWidget";

const TITLES: Record<Section, string> = {
  assistant: "Ассистент",
  units: "Юниты",
  leads: "Лиды",
  clients: "Клиенты",
  analytics: "Аналитика",
  calendar: "Календарь",
  ai_journal: "Argus Brain",
};

/** Вариант А: no persistent rail -- every section is a full-screen HUD
 * "space" you move between (swipe/scroll/arrow keys/click a dot), not tabs
 * next to a fixed sidebar. All spaces stay mounted simultaneously (data
 * pre-fetched, state preserved) and the container just slides -- switching
 * feels instant, like real OS Spaces already being "live" in the background. */
export default function AppPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewRole, setPreviewRole] = useState<"boss" | "sales_agent" | null>(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);
  const [pendingUnitId, setPendingUnitId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Bumped whenever Help opens, so AssistantWidget (which owns its own
  // open state) can watch this and force itself closed -- keeps the two
  // floating panels (top-right Help, bottom-right Assistant) mutually
  // exclusive instead of visibly overlapping.
  const [assistantForceClose, setAssistantForceClose] = useState(0);
  const [pendingWorkspaceClientId, setPendingWorkspaceClientId] = useState<string | null>(null);
  const [assistantPending, setAssistantPending] = useState(0);
  const [brainItemsPending, setBrainItemsPending] = useState(0);
  // Adjacent moves (arrow keys / swipe) animate; this locks out re-triggers
  // faster than the animation itself, since unlocked rapid-fire (key-repeat,
  // a fast trackpad swipe) used to queue several index changes inside one
  // transition and show overlapping/ghosted frames instead of settling.
  // Shared by both step() and jumpTo() -- click-based navigation (dock icons,
  // search/help/brain shortcuts) drives the same activeIndex/transitionEnabled
  // state and could otherwise still race step() or itself mid-transition.
  const stepLockRef = useRef(false);
  // Distant dot-clicks cut straight there instead of visibly sliding past
  // every space in between -- toggled off just long enough for the index
  // change to paint with no transition, then back on for the next move.
  const [transitionEnabled, setTransitionEnabled] = useState(true);

  useEffect(() => {
    api.me().then((u) => {
      if (!u) router.replace("/");
      else setUser(u);
    });
  }, [router]);

  const canPreviewRole = user?.role === "boss";
  const effectiveUser: CurrentUser | null = user && canPreviewRole && previewRole ? { ...user, role: previewRole } : user;
  const visibleSpaces = SPACES.filter((s) => !s.bossOnly || effectiveUser?.role === "boss");

  // Keep activeIndex in range if the space list shrinks (previewing as
  // agent removes Аналитика).
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, visibleSpaces.length - 1));
  }, [visibleSpaces.length]);

  function step(delta: number) {
    if (stepLockRef.current) return;
    stepLockRef.current = true;
    setActiveIndex((cur) => Math.min(visibleSpaces.length - 1, Math.max(0, cur + delta)));
    setTimeout(() => { stepLockRef.current = false; }, 550);
  }

  // Direct jumps (SpaceIndicator dot clicks): adjacent moves still slide like
  // a step; anything further snaps instantly instead of visibly sliding past
  // every space in between (which read as slow and is where the transition
  // could get caught mid-flight, see stepLockRef above).
  function jumpTo(target: number) {
    if (target === activeIndex || stepLockRef.current) return;
    stepLockRef.current = true;
    if (Math.abs(target - activeIndex) <= 1) {
      setActiveIndex(target);
      setTimeout(() => { stepLockRef.current = false; }, 550);
      return;
    }
    setTransitionEnabled(false);
    requestAnimationFrame(() => {
      setActiveIndex(target);
      requestAnimationFrame(() => setTransitionEnabled(true));
    });
    setTimeout(() => { stepLockRef.current = false; }, 550);
  }

  function goToSection(section: Section) {
    const idx = visibleSpaces.findIndex((s) => s.key === section);
    if (idx >= 0) jumpTo(idx);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    }
    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 30) return;
      step(e.deltaX > 0 ? 1 : -1);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSpaces.length]);

  function openClientFromLead(clientId: string) {
    setPendingClientId(clientId);
    goToSection("clients");
  }

  function openUnitFromSearch(unitId: string) {
    setPendingUnitId(unitId);
  }

  function openWorkspaceClient(clientId: string) {
    setPendingWorkspaceClientId(clientId);
    goToSection("assistant");
  }

  function changePreviewRole(r: "boss" | "sales_agent") {
    setPreviewRole(r);
    if (r === "sales_agent" && visibleSpaces[activeIndex]?.key === "analytics") goToSection("assistant");
  }

  if (!user || !effectiveUser) return null;

  const activeKey = visibleSpaces[activeIndex]?.key;
  const isAssistant = activeKey === "assistant";

  return (
    // overflow: "clip", not "hidden" -- "hidden" still lets a descendant's
    // native .scrollIntoView() (e.g. an input scrolling into view) set this
    // element's scrollLeft, which fights the translateX below and briefly
    // shows two spaces overlapping. "clip" isn't a scroll container at all,
    // so nothing but our own transform can move this.
    <div style={{ position: "relative", height: "100vh", minHeight: 720, overflow: "clip" }}>
      <HudToolbar
        user={effectiveUser}
        previewRole={canPreviewRole ? (previewRole || "boss") : undefined}
        onPreviewRoleChange={canPreviewRole ? changePreviewRole : undefined}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenHelp={() => { setHelpOpen(true); setAssistantForceClose((c) => c + 1); }}
        presentationMode={presentationMode}
        onTogglePresentation={() => setPresentationMode((v) => !v)}
        onOpenBrain={() => goToSection("ai_journal")}
        onBrainCountChange={setBrainItemsPending}
      />
      <GlobalSearch
        open={searchOpen} onOpenChange={setSearchOpen} onGoTo={goToSection}
        onOpenUnit={openUnitFromSearch} onOpenClient={openClientFromLead}
      />
      <HelpChatWidget open={helpOpen} onClose={() => setHelpOpen(false)} user={effectiveUser} />
      <SpaceIndicator
        user={effectiveUser} activeIndex={activeIndex} onJump={jumpTo}
        badges={{ assistant: assistantPending, ai_journal: brainItemsPending }}
      />

      <div
        style={{
          display: "flex", height: "100%", width: `${visibleSpaces.length * 100}%`,
          transform: `translateX(-${(100 / visibleSpaces.length) * activeIndex}%)`,
          transition: transitionEnabled ? "transform .5s cubic-bezier(.2,.7,.3,1)" : "none",
        }}
      >
        {visibleSpaces.map((s) => (
          <div key={s.key} style={{ width: `${100 / visibleSpaces.length}%`, height: "100%", padding: "72px 16px 16px", display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
            {s.key !== "assistant" && (
              <div className="glass-panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 18px", flexShrink: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>{TITLES[s.key]}</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 2 }}>Italiano Vero — Milano · Roma · Neapol · Venice · Florencia</div>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", textAlign: "right", flexShrink: 0 }}>
                  {effectiveUser.email}<br />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {effectiveUser.role === "boss" ? "Босс" : "Агент"}
                    {previewRole && (
                      <span style={{
                        color: "var(--v-accent)", fontWeight: 700, fontSize: 10, lineHeight: 1.5,
                        background: "var(--v-accent-tint)", borderRadius: 99, padding: "2px 8px",
                      }}>
                        Предпросмотр
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {s.key === "assistant" && (
                <AssistantPanel
                  user={effectiveUser}
                  openWorkspaceClientId={pendingWorkspaceClientId}
                  onWorkspaceClientHandled={() => setPendingWorkspaceClientId(null)}
                  onPendingChange={setAssistantPending}
                />
              )}
              {s.key === "units" && (
                <UnitsPanel
                  openUnitId={pendingUnitId} onOpenUnitHandled={() => setPendingUnitId(null)} onOpenClient={openClientFromLead}
                  presentationMode={presentationMode}
                  onTogglePresentation={() => setPresentationMode((v) => !v)}
                />
              )}
              {s.key === "leads" && <LeadsPanel onOpenClient={openClientFromLead} />}
              {s.key === "clients" && (
                <ClientsPanel
                  openClientId={pendingClientId}
                  onOpenClientHandled={() => setPendingClientId(null)}
                  onOpenWorkspace={openWorkspaceClient}
                />
              )}
              {s.key === "calendar" && <CalendarPanel onOpenClient={openClientFromLead} />}
              {s.key === "ai_journal" && <AiJournalPanel onOpenClient={openClientFromLead} />}
              {s.key === "analytics" && effectiveUser.role === "boss" && <AnalyticsPanel />}
            </div>
          </div>
        ))}
      </div>

      {!isAssistant && (
        <AssistantWidget
          user={effectiveUser}
          forceClose={assistantForceClose}
          onOpen={() => setHelpOpen(false)}
        />
      )}
    </div>
  );
}
