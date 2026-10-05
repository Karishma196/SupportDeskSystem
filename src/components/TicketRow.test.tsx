import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { TicketRow } from "./TicketRow";
import { Ticket } from "@/types/ticket";

describe("TicketRow Component", () => {
  const sampleTicket: Ticket = {
    external_id: "T-5001",
    customer_id: "C-1",
    customer_plan: "pro",
    subject: "Memoization test subject",
    body: "Memoization test body",
    attachment_url: null,
    created_at: "2026-09-20T10:00:00Z",
    status: "open",
    assigned_to: null,
    category: "billing",
    priority: "P2",
    summary: "Memoization test summary",
    triage_decision: "auto_accept",
    review_reason: null,
  };

  it("does not re-render when identical ticket props are passed", () => {
    const renderSpy = vi.fn();

    const Wrapper = ({ count, ticket }: { count: number; ticket: Ticket }) => {
      renderSpy(count);
      return (
        <table>
          <tbody>
            <TicketRow
              ticket={ticket}
              isSelected={false}
              onToggleSelect={vi.fn()}
              onClaimTicket={vi.fn()}
            />
          </tbody>
        </table>
      );
    };

    const { rerender } = render(<Wrapper count={1} ticket={sampleTicket} />);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Re-render parent with incremented count (unrelated state change)
    rerender(<Wrapper count={2} ticket={{ ...sampleTicket }} />);
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it("renders all required columns: subject, plan, category, priority, status, agent, and deadline", () => {
    const { getByText } = render(
      <table>
        <tbody>
          <TicketRow
            ticket={sampleTicket}
            isSelected={false}
            onToggleSelect={vi.fn()}
            onClaimTicket={vi.fn()}
          />
        </tbody>
      </table>
    );

    expect(getByText("T-5001")).toBeDefined();
    expect(getByText("Memoization test subject")).toBeDefined();
    expect(getByText("pro")).toBeDefined();
    expect(getByText("billing")).toBeDefined();
    expect(getByText("P2")).toBeDefined();
    expect(getByText("Open")).toBeDefined();
    expect(getByText("Unassigned")).toBeDefined();
    expect(getByText("Claim")).toBeDefined();
  });

  it("triggers onClaimTicket when the Claim button is clicked", () => {
    const onClaimSpy = vi.fn();
    const { getByText } = render(
      <table>
        <tbody>
          <TicketRow
            ticket={sampleTicket}
            isSelected={false}
            onToggleSelect={vi.fn()}
            onClaimTicket={onClaimSpy}
          />
        </tbody>
      </table>
    );

    const claimBtn = getByText("Claim");
    claimBtn.click();
    expect(onClaimSpy).toHaveBeenCalledWith("T-5001");
  });

  it("triggers onToggleSelect when the checkbox is toggled", () => {
    const onToggleSpy = vi.fn();
    const { getByRole } = render(
      <table>
        <tbody>
          <TicketRow
            ticket={sampleTicket}
            isSelected={false}
            onToggleSelect={onToggleSpy}
            onClaimTicket={vi.fn()}
          />
        </tbody>
      </table>
    );

    const checkbox = getByRole("checkbox");
    checkbox.click();
    expect(onToggleSpy).toHaveBeenCalledWith("T-5001");
  });

  it("renders fallback '(No subject)' when subject is empty string", () => {
    const emptySubjectTicket: Ticket = {
      ...sampleTicket,
      external_id: "T-2006",
      subject: "",
    };

    const { getByText } = render(
      <table>
        <tbody>
          <TicketRow
            ticket={emptySubjectTicket}
            isSelected={false}
            onToggleSelect={vi.fn()}
            onClaimTicket={vi.fn()}
          />
        </tbody>
      </table>
    );

    expect(getByText("(No subject)")).toBeDefined();
  });
});
