import { AiEvent, BrainGreeting, BrainItem, CalendarEvent, Client, ClientSegment, CompanySummary, TelegramConversation, TelegramMessage } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8010";

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

export type CurrentUser = { email: string; role: "boss" | "sales_agent"; tenant_id: string };

// GET /api/brain/items triggers a real GPT-backed sync on the backend with
// no server-side staleness check -- multiple components on the same page
// (TodayQueue, HudToolbar's presence indicator, the Argus Brain screen)
// each mounting and fetching independently would otherwise mean 2-3 full
// resyncs per page load. This dedupes concurrent/rapid calls into one
// shared in-flight request; `force: true` (an explicit user-initiated
// refresh) bypasses it and always fetches fresh.
let brainItemsCache: { promise: Promise<BrainItem[]>; timestamp: number } | null = null;
const BRAIN_ITEMS_CACHE_MS = 60_000;

function fetchBrainItems(force?: boolean): Promise<BrainItem[]> {
  const now = Date.now();
  if (!force && brainItemsCache && now - brainItemsCache.timestamp < BRAIN_ITEMS_CACHE_MS) {
    return brainItemsCache.promise;
  }
  const promise = request("/api/brain/items") as Promise<BrainItem[]>;
  brainItemsCache = { promise, timestamp: now };
  promise.catch(() => { brainItemsCache = null; }); // don't cache a failed request
  return promise;
}

export const api = {
  me: (): Promise<CurrentUser | null> => request("/api/auth/me").catch(() => null),
  buildings: () => request("/api/units/buildings"),
  units: (building?: string) => request(`/api/units${building ? `?building=${encodeURIComponent(building)}` : ""}`),
  unitInterest: (unitId: string) => request(`/api/units/${unitId}/interest`),
  unitPdfUrl: (unitId: string) => `${API_BASE}/api/units/${unitId}/pdf`,
  leads: () => request("/api/leads"),
  createLead: (body: { client_name?: string; client_phone: string; building_id?: string; source?: string }) =>
    request("/api/leads", { method: "POST", body: JSON.stringify(body) }),
  updateLeadStage: (id: string, stage: string) =>
    request(`/api/leads/${id}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) }),
  openLeadClient: (id: string): Promise<{ client_id: string }> =>
    request(`/api/leads/${id}/client`, { method: "POST" }),
  updateLeadPriority: (id: string, priority: string | null) =>
    request(`/api/leads/${id}/priority`, { method: "PATCH", body: JSON.stringify({ priority }) }),
  logCallOutcome: (body: { outcome: "answered" | "no_answer" | "postponed"; lead_id?: string; client_id?: string }) =>
    request("/api/call-logs", { method: "POST", body: JSON.stringify(body) }),
  spravkaRequests: () => request("/api/spravka-requests"),
  createSpravka: (body: {
    unit_id: string; client_name: string; client_phone: string;
    plan_type: string; down_payment_pct?: number;
    balloon_months?: number; balloon_monthly_payment_usd?: number;
    requested_price_per_m2_usd?: number;
  }) => request("/api/spravka-requests", { method: "POST", body: JSON.stringify(body) }),
  approveSpravka: (id: string) => request(`/api/spravka-requests/${id}/approve`, { method: "POST" }),
  rejectSpravka: (id: string) => request(`/api/spravka-requests/${id}/reject`, { method: "POST" }),
  paymentPlanRates: (buildingId?: string) =>
    request(`/api/payment-plan-rates${buildingId ? `?building_id=${buildingId}` : ""}`),
  exchangeRates: (): Promise<{ building_id: string; exchange_rate_sum: number; buildings?: { name: string } }[]> =>
    request("/api/exchange-rates"),
  updateExchangeRate: (buildingId: string, exchange_rate_sum: number) =>
    request(`/api/exchange-rates/${buildingId}`, { method: "PATCH", body: JSON.stringify({ exchange_rate_sum }) }),
  bossChat: (message: string, conversationId: string, mode?: string) =>
    request("/api/assistant/boss/chat", { method: "POST", body: JSON.stringify({ message, conversation_id: conversationId, mode }) }),
  agentChat: (message: string, conversationId: string, mode?: string) =>
    request("/api/assistant/agent/chat", { method: "POST", body: JSON.stringify({ message, conversation_id: conversationId, mode }) }),
  helpChat: (message: string, conversationId: string) =>
    request("/api/assistant/help/chat", { method: "POST", body: JSON.stringify({ message, conversation_id: conversationId }) }),
  helpConversation: () => request("/api/conversations/help", { method: "POST" }),
  analyticsSummary: () => request("/api/analytics/summary"),
  commissions: () => request("/api/analytics/commissions"),
  managerPerformance: () => request("/api/analytics/manager-performance"),
  updateCommissionRate: (tenantUserId: string, commission_pct: number) =>
    request(`/api/analytics/commissions/${tenantUserId}`, { method: "PATCH", body: JSON.stringify({ commission_pct }) }),
  spravkaDownloadUrl: (requestId: string) => `${API_BASE}/api/spravka-requests/${requestId}/download`,
  spravkaPreview: (requestId: string) => request(`/api/spravka-requests/${requestId}/preview`),
  loginUrl: () => `${API_BASE}/api/auth/google/start`,

  conversations: () => request("/api/conversations"),
  createConversation: (title?: string) =>
    request("/api/conversations", { method: "POST", body: JSON.stringify({ title }) }),
  deleteConversation: (id: string) => request(`/api/conversations/${id}`, { method: "DELETE" }),
  conversationMessages: (id: string) => request(`/api/conversations/${id}/messages`),
  clientConversation: (clientId: string) => request(`/api/conversations/client/${clientId}`, { method: "POST" }),

  clients: (): Promise<Client[]> => request("/api/clients"),
  clientDetail: (id: string) => request(`/api/clients/${id}`),
  refreshClientContext: (id: string) => request(`/api/clients/${id}/context-summary`, { method: "POST" }),
  clientAISegments: (clientIds: string[]): Promise<{ segments: ClientSegment[] }> =>
    request("/api/clients/ai-segments", { method: "POST", body: JSON.stringify({ client_ids: clientIds }) }),
  updateClientFollowup: (id: string, body: { priority?: string | null; next_followup_at?: string | null; next_followup_note?: string | null }) =>
    request(`/api/clients/${id}/followup`, { method: "PATCH", body: JSON.stringify(body) }),

  payments: () => request("/api/payments"),
  markPaymentPaid: (id: string) => request(`/api/payments/${id}/mark-paid`, { method: "POST" }),

  workspace: (): Promise<Client[]> => request("/api/workspace"),
  pinToWorkspace: (clientId: string) => request(`/api/workspace/${clientId}`, { method: "POST" }),
  unpinFromWorkspace: (clientId: string) => request(`/api/workspace/${clientId}`, { method: "DELETE" }),

  telegramByClient: (clientId: string): Promise<{ conversation: TelegramConversation | null; messages: TelegramMessage[] }> =>
    request(`/api/telegram-business/conversations/by-client/${clientId}`),
  telegramSendReply: (conversationId: string, text: string) =>
    request(`/api/telegram-business/conversations/${conversationId}/send`, { method: "POST", body: JSON.stringify({ text }) }),
  telegramUnmatched: (): Promise<TelegramConversation[]> =>
    request("/api/telegram-business/conversations/unmatched"),
  telegramRecentMatched: (): Promise<(TelegramConversation & { clients: { name: string | null; phone: string } | null })[]> =>
    request("/api/telegram-business/conversations/recent-matched"),
  calendarEvents: (): Promise<CalendarEvent[]> => request("/api/calendar"),
  createCalendarEvent: (body: { title: string; event_at: string; note?: string; client_id?: string }) =>
    request("/api/calendar", { method: "POST", body: JSON.stringify(body) }),
  updateCalendarEvent: (id: string, body: { title?: string; event_at?: string; note?: string }) =>
    request(`/api/calendar/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  confirmCalendarEvent: (id: string) => request(`/api/calendar/${id}/confirm`, { method: "POST" }),
  dismissCalendarEvent: (id: string) => request(`/api/calendar/${id}/dismiss`, { method: "POST" }),

  telegramLinkConversation: (
    conversationId: string,
    body: { client_id?: string; new_client_name?: string; new_client_phone?: string }
  ): Promise<TelegramConversation> =>
    request(`/api/telegram-business/conversations/${conversationId}/link`, { method: "PATCH", body: JSON.stringify(body) }),

  aiEvents: (params?: { kind?: string; client_id?: string }): Promise<AiEvent[]> => {
    const query = new URLSearchParams();
    if (params?.kind) query.set("kind", params.kind);
    if (params?.client_id) query.set("client_id", params.client_id);
    const qs = query.toString();
    return request(`/api/ai-events${qs ? `?${qs}` : ""}`);
  },
  addMeetingNote: (eventId: string, note: string) =>
    request(`/api/calendar/${eventId}/meeting-note`, { method: "POST", body: JSON.stringify({ note }) }),
  companySummary: (): Promise<CompanySummary> =>
    request("/api/brain/company-summary", { method: "POST" }),

  brainItems: (force?: boolean): Promise<BrainItem[]> => fetchBrainItems(force),
  dismissBrainItem: (id: string) => request(`/api/brain/items/${id}/dismiss`, { method: "POST" }),
  confirmBrainItem: (id: string) => request(`/api/brain/items/${id}/confirm`, { method: "POST" }),
  snoozeBrainItem: (id: string, days?: number) =>
    request(`/api/brain/items/${id}/snooze`, { method: "POST", body: JSON.stringify({ days }) }),
  brainGreeting: (): Promise<BrainGreeting> => request("/api/brain/greeting"),

  telegramBrainStatus: (): Promise<{ connected: boolean }> => request("/api/telegram-brain/status"),
  telegramBrainLinkCode: (): Promise<{ code: string; deep_link: string }> =>
    request("/api/telegram-brain/link-code", { method: "POST" }),
  telegramBrainSendNow: (): Promise<{ ok: boolean; text: string }> =>
    request("/api/telegram-brain/send-now", { method: "POST" }),
};
