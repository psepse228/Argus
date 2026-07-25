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
  leads: () => request("/api/leads"),
  updateLeadStage: (id: string, stage: string) =>
    request(`/api/leads/${id}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) }),
  spravkaRequests: () => request("/api/spravka-requests"),
  createSpravka: (body: {
    unit_id: string; client_name: string; client_phone: string;
    plan_type: string; down_payment_pct?: number;
    balloon_months?: number; balloon_monthly_payment_usd?: number;
  }) => request("/api/spravka-requests", { method: "POST", body: JSON.stringify(body) }),
  approveSpravka: (id: string) => request(`/api/spravka-requests/${id}/approve`, { method: "POST" }),
  rejectSpravka: (id: string) => request(`/api/spravka-requests/${id}/reject`, { method: "POST" }),
  paymentPlanRates: (buildingId?: string) =>
    request(`/api/payment-plan-rates${buildingId ? `?building_id=${buildingId}` : ""}`),
  bossChat: (message: string, history?: any[], mode?: string) =>
    request("/api/assistant/boss/chat", { method: "POST", body: JSON.stringify({ message, history, mode }) }),
  agentChat: (message: string, history?: any[], mode?: string) =>
    request("/api/assistant/agent/chat", { method: "POST", body: JSON.stringify({ message, history, mode }) }),
  analyticsSummary: () => request("/api/analytics/summary"),
  spravkaDownloadUrl: (requestId: string) => `${API_BASE}/api/spravka-requests/${requestId}/download`,
  spravkaPreview: (requestId: string) => request(`/api/spravka-requests/${requestId}/preview`),
  loginUrl: () => `${API_BASE}/api/auth/google/start`,
};
