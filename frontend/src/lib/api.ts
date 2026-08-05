import { AiEvent, CalendarEvent, Client, ClientSegment, TelegramConversation, TelegramMessage } from "./types";

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

export const api = {
  me: (): Promise<CurrentUser | null> => request("/api/auth/me").catch(() => null),
  buildings: () => request("/api/units/buildings"),
  units: (building?: string) => request(`/api/units${building ? `?building=${encodeURIComponent(building)}` : ""}`),
  unitInterest: (unitId: string) => request(`/api/units/${unitId}/interest`),
  unitPdfUrl: (unitId: string) => `${API_BASE}/api/units/${unitId}/pdf`,
  leads: () => request("/api/leads"),
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
};
