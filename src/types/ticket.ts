export type Priority = "P0" | "P1" | "P2" | "P3";

export type Status = "open" | "in_progress" | "resolved" | "closed";

export type StandardCategory =
  | "account_access"
  | "billing"
  | "bug"
  | "feature_request"
  | "other";

export type CustomerPlan = "free" | "pro" | "enterprise" | "platinum";

export type TriageDecision = "auto_accept" | "manual_review" | "maybe";

export interface Agent {
  id: string;
  name: string;
}

export const VALID_AGENTS: Agent[] = [
  { id: "agent-1", name: "Priya" },
  { id: "agent-2", name: "Rahul" },
  { id: "agent-3", name: "Meera" },
];

export interface Ticket {
  external_id: string;
  customer_id: string;
  customer_plan: CustomerPlan | string;
  subject: string;
  body: string | null;
  attachment_url: string | null;
  created_at: string;
  status: Status;
  assigned_to: string | null;
  category: StandardCategory | string;
  priority: Priority | string;
  ai_priority?: Priority | string;
  summary: string | null;
  triage_decision: TriageDecision | string;
  review_reason: string | null;
  updated_at?: string;
}

export type TicketStatus = Status;
export type TicketPriority = Priority;
export type TicketCategory = StandardCategory;

export interface Customer {
  id: string;
  plan: CustomerPlan | string;
  email?: string;
  name?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: ApiError | string;
  success?: boolean;
  [key: string]: unknown;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TicketUpdateEvent {
  type:
    | "created"
    | "updated"
    | "claimed"
    | "status_changed"
    | "triaged"
    | "retriaged";
  ticket: Ticket;
  timestamp: string;
}

export interface TicketFilters {
  status: string;
  priority: string;
  category: string;
  triage_decision: string;
  search: string;
}

export interface TicketsApiResponse {
  tickets: Ticket[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UpdatesApiResponse {
  updated_tickets: Ticket[];
  server_time: string;
}

