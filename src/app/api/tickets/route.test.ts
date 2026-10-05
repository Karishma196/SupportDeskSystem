import { describe, it, expect, beforeEach } from "vitest";
import { GET as getTickets } from "./route";
import { GET as getTicketById } from "./[id]/route";
import { POST as claimTicket } from "./[id]/claim/route";
import { PATCH as updateStatus } from "./[id]/status/route";
import { PATCH as updateTriage } from "./[id]/triage/route";
import { POST as retriageTicket } from "./[id]/retriage/route";
import { GET as getUpdates } from "./updates/route";
import { GET as getMetrics } from "./metrics/route";
import { NextRequest } from "next/server";
import { ticketStore } from "@/lib/server/ticketStore";
import { validateSafeUrl } from "@/lib/sanitize";

describe("API Route Handlers Integration", () => {
  beforeEach(() => {
    ticketStore.reset();
  });

  // 1. Ticket retrieval and filtering
  it("1. Ticket retrieval and filtering: GET /api/tickets supports status, priority, category, and search", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/tickets?status=open&priority=P0&category=account_access&search=SSO",
      { headers: { "x-bypass-chaos": "1" } }
    );

    const res = await getTickets(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tickets).toBeDefined();
    expect(Array.isArray(data.tickets)).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(1);

    for (const ticket of data.tickets) {
      expect(ticket.status).toBe("open");
      expect(ticket.priority).toBe("P0");
      expect(ticket.category).toBe("account_access");
      expect(ticket.subject.toLowerCase()).toContain("sso");
    }
  });

  // 2. Invalid status transition rejection
  it("2. Invalid status transition rejection: PATCH /api/tickets/:id/status rejects illegal transitions", async () => {
    // T-2001 starts as "open"
    const req = new NextRequest("http://localhost:3000/api/tickets/T-2001/status", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({ status: "resolved" }), // open -> resolved is illegal
    });

    const res = await updateStatus(req, {
      params: Promise.resolve({ id: "T-2001" }),
    });

    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toContain("Invalid status transition");

    // Valid transition: open -> in_progress succeeds
    const validReq = new NextRequest("http://localhost:3000/api/tickets/T-2001/status", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({ status: "in_progress" }),
    });

    const validRes = await updateStatus(validReq, {
      params: Promise.resolve({ id: "T-2001" }),
    });
    expect(validRes.status).toBe(200);
    const updated = await validRes.json();
    expect(updated.status).toBe("in_progress");
  });

  // 3. Conflicting ticket claim
  it("3. Conflicting ticket claim: POST /api/tickets/:id/claim rejects second claiming agent with 409", async () => {
    // First claim by Priya (agent-1) succeeds
    const req1 = new NextRequest("http://localhost:3000/api/tickets/T-2001/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({ agent_id: "agent-1" }),
    });

    const res1 = await claimTicket(req1, {
      params: Promise.resolve({ id: "T-2001" }),
    });
    expect(res1.status).toBe(200);

    // Second claim by Rahul (agent-2) fails with 409 Conflict
    const req2 = new NextRequest("http://localhost:3000/api/tickets/T-2001/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({ agent_id: "agent-2" }),
    });

    const res2 = await claimTicket(req2, {
      params: Promise.resolve({ id: "T-2001" }),
    });
    expect(res2.status).toBe(409);
    const err = await res2.json();
    expect(err.error).toContain("Conflict");
  });

  // 4. Invalid agent rejection
  it("4. Invalid agent rejection: POST /api/tickets/:id/claim rejects non-existent agents with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/tickets/T-2002/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({ agent_id: "agent-99" }),
    });

    const res = await claimTicket(req, {
      params: Promise.resolve({ id: "T-2002" }),
    });

    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toContain('Invalid agent "agent-99"');
  });

  // 5. Enterprise priority enforcement
  it("5. Enterprise priority enforcement: PATCH /api/tickets/:id/triage enforces priority floor and reason length", async () => {
    // T-2001 is an Enterprise customer
    // Attempting to downgrade to P2 or P3 must fail
    const req = new NextRequest("http://localhost:3000/api/tickets/T-2001/triage", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({
        priority: "P3",
        reason: "Downgrading priority because user was unresponsive",
      }),
    });

    const res = await updateTriage(req, {
      params: Promise.resolve({ id: "T-2001" }),
    });
    expect(res.status).toBe(400);

    const err = await res.json();
    expect(err.error).toContain("Enterprise tickets must always stay at least P1");

    // Short reason (< 10 chars) must also fail
    const shortReasonReq = new NextRequest("http://localhost:3000/api/tickets/T-2002/triage", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({
        priority: "P1",
        reason: "Too short",
      }),
    });

    const shortRes = await updateTriage(shortReasonReq, {
      params: Promise.resolve({ id: "T-2002" }),
    });
    expect(shortRes.status).toBe(400);
    const shortErr = await shortRes.json();
    expect(shortErr.error).toContain("at least 10 characters");
  });

  // 6. Invalid triage decision handling
  it("6. Invalid triage decision handling: T-2012 with triage_decision 'maybe' is handled safely", async () => {
    const req = new NextRequest("http://localhost:3000/api/tickets/T-2012", {
      headers: { "x-bypass-chaos": "1" },
    });

    const res = await getTicketById(req, {
      params: Promise.resolve({ id: "T-2012" }),
    });
    expect(res.status).toBe(200);

    const ticket = await res.json();
    expect(ticket.external_id).toBe("T-2012");
    expect(ticket.triage_decision).toBe("maybe");

    // Agent triage resolution normalizes it to auto_accept
    const triageReq = new NextRequest("http://localhost:3000/api/tickets/T-2012/triage", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({
        priority: "P2",
        category: "account_access",
        reason: "Agent verified account locked issue and confirmed details",
      }),
    });

    const triageRes = await updateTriage(triageReq, {
      params: Promise.resolve({ id: "T-2012" }),
    });
    expect(triageRes.status).toBe(200);
    const triagedTicket = await triageRes.json();
    expect(triagedTicket.triage_decision).toBe("auto_accept");
  });

  // 7. Unknown ticket ID
  it("7. Unknown ticket ID: Returns 404 for nonexistent ticket queries and actions", async () => {
    const getReq = new NextRequest("http://localhost:3000/api/tickets/T-99999", {
      headers: { "x-bypass-chaos": "1" },
    });

    const getRes = await getTicketById(getReq, {
      params: Promise.resolve({ id: "T-99999" }),
    });
    expect(getRes.status).toBe(404);
    const getErr = await getRes.json();
    expect(getErr.error).toBe("Ticket not found.");

    const claimReq = new NextRequest("http://localhost:3000/api/tickets/T-99999/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bypass-chaos": "1",
      },
      body: JSON.stringify({ agent_id: "agent-1" }),
    });

    const claimRes = await claimTicket(claimReq, {
      params: Promise.resolve({ id: "T-99999" }),
    });
    expect(claimRes.status).toBe(404);
  });

  // 8. Malicious attachment URL handling
  it("8. Malicious attachment URL handling: Server preserves raw data; security validation blocks unsafe URI", async () => {
    const req = new NextRequest("http://localhost:3000/api/tickets/T-2003", {
      headers: { "x-bypass-chaos": "1" },
    });

    const res = await getTicketById(req, {
      params: Promise.resolve({ id: "T-2003" }),
    });
    expect(res.status).toBe(200);

    const ticket = await res.json();
    expect(ticket.attachment_url).toBe("javascript:alert(document.cookie)");

    // Verify safe URL validator blocks executable javascript protocol
    const validation = validateSafeUrl(ticket.attachment_url);
    expect(validation.isSafe).toBe(false);
    expect(validation.sanitizedUrl).toBeNull();
    expect(validation.warning).toContain("Blocked unsafe attachment link");
  });

  // 9. Duplicate test ticket handling
  it("9. Duplicate test ticket handling: Deduplicates T-2001 so exactly one instance exists", async () => {
    const req = new NextRequest("http://localhost:3000/api/tickets?search=T-2001", {
      headers: { "x-bypass-chaos": "1" },
    });

    const res = await getTickets(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    const matching = data.tickets.filter((t: { external_id: string }) => t.external_id === "T-2001");
    expect(matching.length).toBe(1);
    expect(ticketStore.getTicket("T-2001")).toBeDefined();
  });

  // Additional Endpoints Verification
  it("retriage endpoint requires server-side TRIAGE_API_KEY", async () => {
    const originalKey = process.env.TRIAGE_API_KEY;

    // With key configured
    process.env.TRIAGE_API_KEY = "test-secret-key";
    const req = new NextRequest("http://localhost:3000/api/tickets/T-2004/retriage", {
      method: "POST",
      headers: { "x-bypass-chaos": "1" },
    });

    const res = await retriageTicket(req, {
      params: Promise.resolve({ id: "T-2004" }),
    });
    expect(res.status).toBe(200);

    // Without key configured
    delete process.env.TRIAGE_API_KEY;
    const reqNoKey = new NextRequest("http://localhost:3000/api/tickets/T-2004/retriage", {
      method: "POST",
      headers: { "x-bypass-chaos": "1" },
    });

    const resNoKey = await retriageTicket(reqNoKey, {
      params: Promise.resolve({ id: "T-2004" }),
    });
    expect(resNoKey.status).toBe(500);

    process.env.TRIAGE_API_KEY = originalKey;
  });

  it("updates endpoint returns recent changes since a timestamp", async () => {
    const timestamp = new Date(Date.now() - 2000).toISOString();
    const req = new NextRequest(`http://localhost:3000/api/tickets/updates?since=${encodeURIComponent(timestamp)}`, {
      headers: { "x-bypass-chaos": "1" },
    });

    const res = await getUpdates(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.updated_tickets).toBeDefined();
    expect(data.server_time).toBeDefined();
  });

  it("metrics endpoint returns active ticket and review queue counts", async () => {
    const req = new NextRequest("http://localhost:3000/api/tickets/metrics?agent_id=agent-1", {
      headers: { "x-bypass-chaos": "1" },
    });

    const res = await getMetrics(req);
    expect(res.status).toBe(200);
    const metrics = await res.json();
    expect(typeof metrics.myTicketsCount).toBe("number");
    expect(typeof metrics.toReviewCount).toBe("number");
    expect(metrics.toReviewCount).toBeGreaterThanOrEqual(1);
  });
});

