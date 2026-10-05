import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import metricsReducer from "@/store/metricsSlice";
import agentReducer from "@/store/agentSlice";
import TicketDetailsPage from "./page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe("TicketDetailsPage Component", () => {
  let store: ReturnType<typeof configureStore>;

  const mockTicket = {
    external_id: "T-2001",
    customer_id: "C-12",
    customer_plan: "enterprise",
    subject: "SSO login down for whole team",
    body: "Nobody on our team can log in with SSO since 9 AM.",
    attachment_url: null,
    created_at: "2026-09-20T09:15:00Z",
    status: "open",
    assigned_to: null,
    category: "account_access",
    priority: "P0",
    summary: "Whole team cannot log in with SSO.",
    triage_decision: "auto_accept",
    review_reason: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = configureStore({
      reducer: {
        metrics: metricsReducer,
        agent: agentReducer,
      },
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/tickets/T-2001")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTicket),
        });
      }
      if (url.includes("/api/tickets/T-UNKNOWN")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "Ticket not found." }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
      });
    });
  });

  it("renders ticket details, customer message, and allowed next status actions", async () => {
    const { getByText } = render(
      <Provider store={store}>
        <TicketDetailsPage params={{ id: "T-2001" }} />
      </Provider>
    );

    await waitFor(() => {
      expect(getByText("SSO login down for whole team")).toBeDefined();
      expect(getByText(/Nobody on our team can log in/i)).toBeDefined();
      expect(getByText("Claim ticket")).toBeDefined();
      expect(getByText("Move to in progress")).toBeDefined();
      expect(getByText("Re-run AI")).toBeDefined();
    });
  });

  it("shows proper 'Ticket Not Found' 404 page for nonexistent ticket IDs", async () => {
    const { getByText } = render(
      <Provider store={store}>
        <TicketDetailsPage params={{ id: "T-UNKNOWN" }} />
      </Provider>
    );

    await waitFor(() => {
      expect(getByText("Ticket Not Found")).toBeDefined();
      expect(getByText("Return to Tickets")).toBeDefined();
    });
  });

  it("optimistically claims ticket on Claim button click", async () => {
    const { getByText } = render(
      <Provider store={store}>
        <TicketDetailsPage params={{ id: "T-2001" }} />
      </Provider>
    );

    await waitFor(() => {
      expect(getByText("Claim ticket")).toBeDefined();
    });

    const claimBtn = getByText("Claim ticket");
    fireEvent.click(claimBtn);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tickets/T-2001/claim",
      expect.objectContaining({ method: "POST" })
    );
  });
});
