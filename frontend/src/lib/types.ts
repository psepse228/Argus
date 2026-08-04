export type Unit = {
  id: string;
  unit_number: string;
  entrance: number | null;
  floor: number;
  room_type: string | null;
  area_m2: number;
  price_per_m2_usd: number;
  ceiling_height_m?: number | null;
  floor_plan_url?: string | null;
  status: string;
  building_id: string;
  buildings?: { name: string };
  assigned_manager?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
};

export type Building = { id: string; name: string; project_name: string; status: string };

export type UnitInterest = {
  spravka_requests: { id: string; client_id: string | null; client_name: string; client_phone: string; plan_type: string; status: string; created_at: string }[];
  soft_leads: { id: string; client_id: string | null; phone: string; stage: string; source: string | null; created_at: string }[];
};

export type Payment = {
  id: string;
  spravka_request_id: string;
  installment_number: number;
  label: string;
  due_date: string;
  amount_usd: number;
  status: "pending" | "paid" | "overdue";
  due_soon?: boolean;
  paid_at: string | null;
  spravka_requests?: {
    client_name: string;
    client_phone: string;
    requested_by: string;
    units?: { unit_number: string; buildings?: { name: string } };
  };
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидается",
  paid: "Оплачено",
  overdue: "Просрочено",
};

export const PAYMENT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "rgba(255,255,255,.06)", fg: "var(--color-text-soft)" },
  paid: { bg: "var(--success-tint)", fg: "var(--success)" },
  overdue: { bg: "var(--danger-tint)", fg: "var(--danger)" },
};

export type Priority = "hot" | "warm" | "cold";

export const PRIORITY_LABELS: Record<Priority, string> = { hot: "Горячий", warm: "Тёплый", cold: "Холодный" };
export const PRIORITY_COLORS: Record<Priority, { bg: string; fg: string }> = {
  hot: { bg: "var(--danger-tint)", fg: "var(--danger)" },
  warm: { bg: "var(--warning-tint)", fg: "var(--warning)" },
  cold: { bg: "rgba(125,211,252,0.14)", fg: "#7dd3fc" },
};

export type Lead = {
  id: string;
  phone: string;
  source: string | null;
  buy_intent: string | null;
  stage: string;
  assigned_manager: string | null;
  priority?: Priority | null;
  is_stale?: boolean;
  created_at: string;
};

export type SpravkaComputedSummary = {
  effective_price_per_m2_usd: number;
  effective_total_usd: number;
  payment_label: string;
  down_payment_usd: number;
  remaining_usd: number;
  monthly_payment_usd: number;
  total_installment_paid_usd: number;
  balloon_remaining_usd: number;
};

export type SpravkaRequest = {
  id: string;
  unit_id: string;
  client_id?: string | null;
  client_name: string;
  client_phone: string;
  requested_by: string;
  plan_type: string;
  down_payment_pct: number | null;
  status: "pending" | "approved" | "rejected" | "auto_approved";
  approved_by: string | null;
  approved_at: string | null;
  generated_file_url: string | null;
  real_price_per_m2_usd?: number;
  requested_price_per_m2_usd?: number | null;
  created_at: string;
  units?: { unit_number: string; floor: number; area_m2: number; buildings?: { name: string } };
  computed_summary?: SpravkaComputedSummary;
};

export type Client = {
  id: string;
  name: string | null;
  phone: string;
  created_at: string;
  leads_count: number;
  spravka_count: number;
  priority?: Priority | null;
  next_followup_at?: string | null;
  next_followup_note?: string | null;
  buildings?: string[];
  assigned_manager?: string | null;
  last_activity_at?: string | null;
  ai_context_summary?: string | null;
  ai_context_generated_at?: string | null;
};

export type ClientSegment = { label: string; reason: string; client_ids: string[] };

export type CalendarEvent = {
  id: string;
  client_id: string | null;
  telegram_conversation_id: string | null;
  title: string;
  event_at: string;
  note: string | null;
  source: "manual" | "monitor";
  status: "proposed" | "confirmed" | "dismissed";
  created_by: string | null;
  created_at: string;
  clients?: { name: string | null; phone: string } | null;
};

export type ClientDetail = Client & {
  leads: (Lead & { buildings?: { name: string } })[];
  spravka_requests: SpravkaRequest[];
  payments: Payment[];
};

export type Conversation = {
  id: string;
  user_email: string;
  client_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  events: any[] | null;
  created_at: string;
};

export type ManagerPerformance = {
  id: string;
  name: string;
  email: string;
  leads_assigned: number;
  leads_converted: number;
  conversion_rate: number;
  spravka_created: number;
  spravka_approved: number;
  approval_rate: number;
  collected_usd: number;
};

export type Commission = {
  id: string;
  name: string;
  email: string;
  commission_pct: number;
  collected_usd: number;
  commission_usd: number;
};

export type PlanRate = {
  id: string;
  building_id: string;
  plan_type: string;
  price_per_m2_usd: number;
  buildings?: { name: string };
};

export const PLAN_LABELS: Record<string, string> = {
  cash: "Наличные (100%)",
  installment_6: "Рассрочка 6 мес",
  installment_12: "Рассрочка 12 мес",
  installment_24: "Рассрочка 24 мес",
};

export const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  for_sale: { bg: "var(--v-accent-tint)", fg: "var(--v-accent)" },
  reserved: { bg: "var(--warning-tint)", fg: "var(--warning)" },
  paid_reservation: { bg: "var(--warning-tint)", fg: "var(--warning)" },
  deal_in_progress: { bg: "rgba(125,211,252,0.14)", fg: "#7dd3fc" },
  deal_completed: { bg: "var(--success-tint)", fg: "var(--success)" },
  marketing_reserve: { bg: "rgba(255,255,255,0.08)", fg: "var(--color-text-soft)" },
  marketing_deal: { bg: "rgba(122,92,255,0.14)", fg: "var(--v-violet-strong, #7a5cff)" },
  pending: { bg: "var(--warning-tint)", fg: "var(--warning)" },
  approved: { bg: "var(--success-tint)", fg: "var(--success)" },
  auto_approved: { bg: "var(--success-tint)", fg: "var(--success)" },
  rejected: { bg: "var(--danger-tint)", fg: "var(--danger)" },
};

// Mirrors LeadsPanel's own STAGES palette (kept as a separate export here
// rather than refactoring that array -- both read the same colors, but
// LeadsPanel's copy also carries its own labels/ordering it shouldn't lose).
export const STAGE_COLORS: Record<string, string> = {
  unsorted: "var(--color-text-faint)",
  matching: "var(--v-violet-strong, #7a5cff)",
  meeting_scheduled: "#7dd3fc",
  meeting_held: "var(--warning)",
  reserved: "var(--v-accent)",
  paid_reservation: "var(--success)",
};

export const STATUS_LABELS: Record<string, string> = {
  for_sale: "В продаже",
  reserved: "Бронь",
  paid_reservation: "Платная бронь",
  deal_in_progress: "Сделка в работе",
  deal_completed: "Продано",
  marketing_reserve: "Маркетинговый резерв",
  marketing_deal: "Маркетинговая сделка",
  pending: "Ожидает",
  approved: "Одобрено",
  auto_approved: "Одобрено (авто)",
  rejected: "Отклонено",
  // Lead-stage labels (matches LeadsPanel's Kanban columns) -- shared here
  // too since ClientWorkspace/ClientInfoCard render a lead's stage via this
  // same map; without these four, "unsorted" etc. leaked through in English
  // wherever the map's `|| stage` fallback kicked in.
  unsorted: "Неразобранное",
  matching: "Подбор",
  meeting_scheduled: "Встреча назначена",
  meeting_held: "Встреча проведена",
};

export type TelegramConversation = {
  id: string;
  tenant_id: string;
  connection_id: string;
  client_id: string | null;
  telegram_chat_id: number;
  telegram_first_name: string | null;
  telegram_username: string | null;
  summary: string | null;
  next_step_suggestion: string | null;
  draft_reply: string | null;
  coaching_tip: string | null;
  draft_generated_at: string | null;
  last_message_at: string;
  created_at: string;
};

export type TelegramMessage = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  content: string;
  telegram_message_id: number | null;
  sent_by: string | null;
  created_at: string;
};
