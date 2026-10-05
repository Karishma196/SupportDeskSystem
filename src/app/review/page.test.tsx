import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import metricsReducer from "@/store/metricsSlice";
import agentReducer from "@/store/agentSlice";
import ReviewQueuePage from "./page";

describe("ReviewQueuePage Component", () => {
  let store: ReturnType<typeof configureStore>;

  const mockTickets = [
    {
      external_id: "T-2003",
      customer_id: "C-40",
      customer_plan: "free",
      subject: "Screenshot of the error",
      body: "See attachment",
      attachment_url: "javascript:alert(1)",
      created_at: "2026-09-20T10:40:00Z",
      status: "open",
      assigned_to: null,
      category: "bug",
      priority: "P3",
      summary: "Customer reports error",
      triage_decision: "manual_review",
      review_reason: "flagged_input",
    },
    {
      external_id: "T-2004",
      customer_id: "C-58",
      customer_plan: "platinum",
      subject: "Invoice question",
      body: "Can you resend invoice?",
      attachment_url: null,
      created_at: "2026-09-20T11:00:00Z",
      status: "open",
      assigned_to: null,
      category: "urgent_billing",
      priority: "P5",
      summary: null,
      triage_decision: "manual_review",
      review_reason: "invalid_output",
    },
    {
      external_id: "T-2012",
      customer_id: "C-52",
      customer_plan: "free",
      subject: "Account locked",
      body: "Locked after too many password attempts",
      attachment_url: null,
      created_at: "2026-09-21T11:15:00Z",
      status: "open",
      assigned_to: null,
      category: "account_access",
      priority: "P2",
      summary: "Account locked after failed logins",
      triage_decision: "maybe",
      review_reason: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    store = configureStore({
      reducer: {
        metrics: metricsReducer,
        agent: agentReducer,
      },
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/tickets?triage_decision=manual_review")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tickets: mockTickets }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });
  });

  it("loads and displays tickets requiring review including non-standard decision 'maybe'", async () => {
    const { getByText } = render(
      <Provider store={store}>
        <ReviewQueuePage />
      </Provider>
    );

    await waitFor(() => {
      expect(getByText("T-2003")).toBeDefined();
      expect(getByText("T-2004")).toBeDefined();
      expect(getByText("T-2012")).toBeDefined();
      expect(getByText('decision: maybe')).toBeDefined();
    });
  });

  it("opens modify modal and enforces minimum 10 characters for written reason", async () => {
    const { getAllByText, getByPlaceholderText, getByText } = render(
      <Provider store={store}>
        <ReviewQueuePage />
      </Provider>
    );

    await waitFor(() => {
      expect(getAllByText("Change Category / Priority").length).toBeGreaterThan(0);
    });

    // Click modify for first ticket
    const modifyBtns = getAllByText("Change Category / Priority");
    fireEvent.click(modifyBtns[0]);

    // Modal opens
    expect(getByText("Override Triage for T-2003")).toBeDefined();

    // Type short reason (<10 chars)
    const textarea = getByPlaceholderText(/Explain why you are changing/i);
    fireEvent.change(textarea, { target: { value: "Short" } });

    // Submit
    const saveBtn = getByText("Save and Remove from Queue");
    fireEvent.click(saveBtn);

    // Form error should appear
    expect(getByText(/Written reason must be at least 10 characters/i)).toBeDefined();
  });
});
