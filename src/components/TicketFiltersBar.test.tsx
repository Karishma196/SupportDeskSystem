import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import filterReducer from "@/store/filterSlice";
import { TicketFiltersBar } from "./TicketFiltersBar";

// Mock next/navigation
const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
}));

describe("TicketFiltersBar Component", () => {
  let store: ReturnType<typeof configureStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = configureStore({
      reducer: {
        filters: filterReducer,
      },
    });
  });

  it("renders search input and filter dropdowns", () => {
    const { getByPlaceholderText, getByLabelText } = render(
      <Provider store={store}>
        <TicketFiltersBar />
      </Provider>
    );

    expect(getByPlaceholderText("Search tickets by subject, body, or ID...")).toBeDefined();
    expect(getByLabelText("Filter by Status")).toBeDefined();
    expect(getByLabelText("Filter by Priority")).toBeDefined();
    expect(getByLabelText("Filter by Category")).toBeDefined();
    expect(getByLabelText("Filter by AI Decision")).toBeDefined();
  });

  it("updates local search input and triggers debounced URL update", () => {
    vi.useFakeTimers();

    const { getByPlaceholderText } = render(
      <Provider store={store}>
        <TicketFiltersBar />
      </Provider>
    );

    const input = getByPlaceholderText("Search tickets by subject, body, or ID...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "SSO login" } });
    expect(input.value).toBe("SSO login");

    // Before debounce runs, replace not called yet
    expect(mockReplace).not.toHaveBeenCalled();

    // Fast-forward debounce timer (300ms)
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockReplace).toHaveBeenCalledWith("?search=SSO+login", expect.any(Object));

    vi.useRealTimers();
  });

  it("updates filter selection and synchronizes to URL and store", () => {
    const { getByLabelText } = render(
      <Provider store={store}>
        <TicketFiltersBar />
      </Provider>
    );

    const statusSelect = getByLabelText("Filter by Status") as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: "open" } });

    expect(mockReplace).toHaveBeenCalledWith("?status=open", expect.any(Object));
  });
});
