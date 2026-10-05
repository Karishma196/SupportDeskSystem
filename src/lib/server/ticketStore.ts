import {
  Ticket,
  TicketFilters,
  TicketsApiResponse,
  Status,
  Priority,
  StandardCategory,
} from "@/types/ticket";
import { TEST_TICKETS_RAW, generateSeedTickets } from "./seedData";
import {
  isValidAgent,
  validateStatusTransition,
  validateEnterprisePriority,
  validateTriageUpdate,
} from "./rules";

export class TicketStore {
  private tickets: Map<string, Ticket> = new Map();
  private updateLog: Ticket[] = [];
  private simulationInterval: NodeJS.Timeout | null = null;
  private newTicketCounter = 9000;

  constructor() {
    this.init();
    this.startSimulation();
  }

  private init() {
    this.tickets.clear();
    this.updateLog = [];

    // Ingest test tickets first with deduplication by external_id
    const seenIds = new Set<string>();
    for (const testTicket of TEST_TICKETS_RAW) {
      if (!seenIds.has(testTicket.external_id)) {
        seenIds.add(testTicket.external_id);
        const cloned: Ticket = {
          ...testTicket,
          updated_at: testTicket.updated_at || testTicket.created_at,
        };
        this.tickets.set(cloned.external_id, cloned);
      }
    }

    // Ingest 5000 generated seed tickets
    const generated = generateSeedTickets(5000);
    for (const ticket of generated) {
      if (!this.tickets.has(ticket.external_id)) {
        this.tickets.set(ticket.external_id, ticket);
      }
    }
  }

  public reset() {
    this.init();
  }

  public stopSimulation() {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }

  public startSimulation() {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    if (this.simulationInterval) {
      return;
    }

    // Run background event simulation every 6 seconds
    this.simulationInterval = setInterval(() => {
      this.performSimulationTick();
    }, 6000);

    // Prevent interval from keeping Node process alive during exit
    if (this.simulationInterval && typeof this.simulationInterval.unref === "function") {
      this.simulationInterval.unref();
    }
  }

  private performSimulationTick() {
    const rand = Math.random();
    const now = new Date().toISOString();

    if (rand < 0.4) {
      // Create a new incoming ticket
      this.newTicketCounter += 1;
      const newId = `T-${this.newTicketCounter}`;
      const isEnterprise = Math.random() < 0.2;
      const requiresReview = Math.random() < 0.3;

      const newTicket: Ticket = {
        external_id: newId,
        customer_id: `C-${Math.floor(Math.random() * 400) + 1}`,
        customer_plan: isEnterprise ? "enterprise" : "pro",
        subject: `Live issue reported from dashboard (${newId})`,
        body: "A live user reported an issue through our support widget.",
        attachment_url: null,
        created_at: now,
        status: "open",
        assigned_to: null,
        category: "bug",
        priority: isEnterprise ? "P1" : "P2",
        summary: "Live issue reported from dashboard.",
        triage_decision: requiresReview ? "manual_review" : "auto_accept",
        review_reason: requiresReview ? "automated_anomaly_detection" : null,
        updated_at: now,
      };

      this.tickets.set(newTicket.external_id, newTicket);
      this.recordUpdate(newTicket);
    } else if (rand < 0.7) {
      // Another agent claims an open ticket
      const openTickets = Array.from(this.tickets.values()).filter(
        (t) => t.status === "open" && t.assigned_to === null
      );
      if (openTickets.length > 0) {
        const target = openTickets[Math.floor(Math.random() * Math.min(openTickets.length, 20))];
        const randomAgent = Math.random() < 0.5 ? "agent-2" : "agent-3";
        target.assigned_to = randomAgent;
        target.status = "in_progress";
        target.updated_at = now;
        this.tickets.set(target.external_id, target);
        this.recordUpdate(target);
      }
    } else {
      // Resolve/close an in-progress ticket
      const inProgressTickets = Array.from(this.tickets.values()).filter(
        (t) => t.status === "in_progress"
      );
      if (inProgressTickets.length > 0) {
        const target = inProgressTickets[Math.floor(Math.random() * Math.min(inProgressTickets.length, 20))];
        target.status = "resolved";
        target.updated_at = now;
        this.tickets.set(target.external_id, target);
        this.recordUpdate(target);
      }
    }
  }

  private recordUpdate(ticket: Ticket) {
    this.updateLog.push({ ...ticket });
    // Keep update log trimmed to last 1,000 entries
    if (this.updateLog.length > 1000) {
      this.updateLog.splice(0, this.updateLog.length - 1000);
    }
  }

  public getTickets(
    filters: Partial<TicketFilters> = {},
    page = 1,
    limit = 50
  ): TicketsApiResponse {
    let result = Array.from(this.tickets.values());

    // Filter by status
    if (filters.status && filters.status !== "all") {
      result = result.filter((t) => t.status === filters.status);
    }

    // Filter by priority
    if (filters.priority && filters.priority !== "all") {
      result = result.filter((t) => t.priority === filters.priority);
    }

    // Filter by category
    if (filters.category && filters.category !== "all") {
      result = result.filter((t) => t.category === filters.category);
    }

    // Filter by triage decision (manual_review includes non-standard decisions like 'maybe')
    if (filters.triage_decision && filters.triage_decision !== "all") {
      if (filters.triage_decision === "manual_review") {
        result = result.filter(
          (t) => t.triage_decision === "manual_review" || t.triage_decision === "maybe"
        );
      } else {
        result = result.filter((t) => t.triage_decision === filters.triage_decision);
      }
    }

    // Search query on subject and body
    if (filters.search && filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      result = result.filter((t) => {
        const matchSubject = t.subject ? t.subject.toLowerCase().includes(q) : false;
        const matchBody = t.body ? t.body.toLowerCase().includes(q) : false;
        const matchId = t.external_id.toLowerCase().includes(q);
        return matchSubject || matchBody || matchId;
      });
    }

    // Sort by created_at descending (latest first)
    result.sort((a, b) => {
      const timeA = new Date(a.created_at).getTime() || 0;
      const timeB = new Date(b.created_at).getTime() || 0;
      return timeB - timeA;
    });

    const total = result.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage = Math.max(1, Math.min(page, totalPages));
    const offset = (safePage - 1) * limit;
    const paginatedTickets = result.slice(offset, offset + limit);

    return {
      tickets: paginatedTickets,
      total,
      page: safePage,
      limit,
      totalPages,
    };
  }

  public getTicket(id: string): Ticket | null {
    return this.tickets.get(id) || null;
  }

  public claimTicket(
    id: string,
    agentId: string
  ): { success: boolean; ticket?: Ticket; status: number; error?: string } {
    const ticket = this.tickets.get(id);
    if (!ticket) {
      return { success: false, status: 404, error: "Ticket not found." };
    }

    if (!isValidAgent(agentId)) {
      return { success: false, status: 400, error: `Invalid agent "${agentId}".` };
    }

    // Check if another agent already claimed it
    if (ticket.assigned_to && ticket.assigned_to !== agentId) {
      return {
        success: false,
        status: 409,
        error: `Conflict: Ticket already assigned to ${ticket.assigned_to}.`,
      };
    }

    ticket.assigned_to = agentId;
    if (ticket.status === "open") {
      ticket.status = "in_progress";
    }
    ticket.updated_at = new Date().toISOString();
    this.tickets.set(id, ticket);
    this.recordUpdate(ticket);

    return { success: true, status: 200, ticket };
  }

  public updateStatus(
    id: string,
    nextStatus: Status
  ): { success: boolean; ticket?: Ticket; status: number; error?: string } {
    const ticket = this.tickets.get(id);
    if (!ticket) {
      return { success: false, status: 404, error: "Ticket not found." };
    }

    const validation = validateStatusTransition(ticket.status, nextStatus);
    if (!validation.valid) {
      return { success: false, status: 400, error: validation.error };
    }

    ticket.status = nextStatus;
    ticket.updated_at = new Date().toISOString();
    this.tickets.set(id, ticket);
    this.recordUpdate(ticket);

    return { success: true, status: 200, ticket };
  }

  public updateTriage(
    id: string,
    params: {
      category?: StandardCategory | string;
      priority?: Priority | string;
      reason: string;
      accept?: boolean;
    }
  ): { success: boolean; ticket?: Ticket; status: number; error?: string } {
    const ticket = this.tickets.get(id);
    if (!ticket) {
      return { success: false, status: 404, error: "Ticket not found." };
    }

    if (params.accept) {
      ticket.triage_decision = "auto_accept";
      ticket.review_reason = "accepted_by_agent";
      ticket.updated_at = new Date().toISOString();
      this.tickets.set(id, ticket);
      this.recordUpdate(ticket);
      return { success: true, status: 200, ticket };
    }

    const validation = validateTriageUpdate({
      plan: ticket.customer_plan,
      newPriority: params.priority,
      reason: params.reason,
    });

    if (!validation.valid) {
      return { success: false, status: 400, error: validation.error };
    }

    if (params.priority) {
      if (ticket.priority !== params.priority && !ticket.ai_priority) {
        ticket.ai_priority = ticket.priority;
      }
      ticket.priority = params.priority;
    }

    if (params.category) {
      ticket.category = params.category;
    }

    ticket.triage_decision = "auto_accept";
    ticket.review_reason = params.reason;
    ticket.updated_at = new Date().toISOString();
    this.tickets.set(id, ticket);
    this.recordUpdate(ticket);

    return { success: true, status: 200, ticket };
  }

  public retriageTicket(id: string): {
    success: boolean;
    ticket?: Ticket;
    status: number;
    error?: string;
  } {
    const ticket = this.tickets.get(id);
    if (!ticket) {
      return { success: false, status: 404, error: "Ticket not found." };
    }

    // AI simulation logic
    const categories: StandardCategory[] = [
      "account_access",
      "billing",
      "bug",
      "feature_request",
      "other",
    ];
    // Re-evaluate category and priority based on body and customer plan
    let newPriority: Priority = "P2";
    if (ticket.customer_plan === "enterprise") {
      newPriority = "P1";
    }

    ticket.ai_priority = newPriority;
    ticket.priority = newPriority;
    ticket.summary = `Re-triaged: ${ticket.subject.slice(0, 50)}.`;
    ticket.triage_decision = "auto_accept";
    ticket.review_reason = "re-triaged_by_service";
    ticket.updated_at = new Date().toISOString();

    this.tickets.set(id, ticket);
    this.recordUpdate(ticket);

    return { success: true, status: 200, ticket };
  }

  public getUpdatesSince(sinceTimestamp: string): Ticket[] {
    const sinceDate = new Date(sinceTimestamp).getTime();
    if (isNaN(sinceDate)) {
      return [];
    }

    return this.updateLog.filter((t) => {
      const updatedTime = new Date(t.updated_at || t.created_at).getTime();
      return updatedTime > sinceDate;
    });
  }

  public getMetrics(agentId: string): { myTicketsCount: number; toReviewCount: number } {
    let myTicketsCount = 0;
    let toReviewCount = 0;

    for (const ticket of this.tickets.values()) {
      if (ticket.status !== "closed" && ticket.assigned_to === agentId) {
        myTicketsCount++;
      }
      if (
        ticket.status !== "closed" &&
        (ticket.triage_decision === "manual_review" || ticket.triage_decision === "maybe")
      ) {
        toReviewCount++;
      }
    }

    return { myTicketsCount, toReviewCount };
  }
}

// Global singleton to preserve in-memory state across Next.js HMR reloads
const globalForStore = globalThis as unknown as { __ticketStore__?: TicketStore };

export const ticketStore = globalForStore.__ticketStore__ || new TicketStore();

if (process.env.NODE_ENV !== "production") {
  globalForStore.__ticketStore__ = ticketStore;
}
