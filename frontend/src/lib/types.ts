export type Unit = {
  id: string;
  unit_number: string;
  floor: number;
  room_type: string | null;
  area_m2: number;
  price_per_m2_usd: number;
  status: string;
  building_id: string;
  buildings?: { name: string };
  assigned_manager?: string | null;
  client_name?: string | null;
};

export type Building = { id: string; name: string; project_name: string; status: string };

export type Payment = {
  id: string;
  spravka_request_id: string;
  installment_number: number;
  label: string;
  due_date: string;
  amount_usd: number;
  status: "pending" | "paid" | "overdue";
  paid_at: string | null;
  spravka_requests?: {
    client_name: string;
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

export type Lead = {
  id: string;
  phone: string;
  source: string | null;
  buy_intent: string | null;
  stage: string;
  assigned_manager: string | null;
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
};

export type ClientDetail = Client & {
  leads: (Lead & { buildings?: { name: string } })[];
  spravka_requests: SpravkaRequest[];
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
  pending: { bg: "var(--warning-tint)", fg: "var(--warning)" },
  approved: { bg: "var(--success-tint)", fg: "var(--success)" },
  auto_approved: { bg: "var(--success-tint)", fg: "var(--success)" },
  rejected: { bg: "var(--danger-tint)", fg: "var(--danger)" },
};

export const STATUS_LABELS: Record<string, string> = {
  for_sale: "В продаже",
  reserved: "Бронь",
  paid_reservation: "Платная бронь",
  deal_in_progress: "Сделка в работе",
  deal_completed: "Продано",
  marketing_reserve: "Резерв",
  pending: "Ожидает",
  approved: "Одобрено",
  auto_approved: "Одобрено (авто)",
  rejected: "Отклонено",
};
