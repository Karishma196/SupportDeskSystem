"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAppSelector, useAppDispatch } from "@/store";
import { incrementMyTickets, decrementMyTickets } from "@/store/metricsSlice";
import { Ticket } from "@/types/ticket";
import { TicketFiltersBar } from "@/components/TicketFiltersBar";
import { TicketRow } from "@/components/TicketRow";
import { MobileTicketCard } from "@/components/MobileTicketCard";
import { BulkActionBar } from "@/components/BulkActionBar";
import { NewTicketsBanner } from "@/components/NewTicketsBanner";
import { TICKET_UPDATED_EVENT } from "@/components/LiveUpdatesManager";
import {
  AlertCircle,
  RefreshCw,
  Loader2,
  Inbox,
  CheckSquare,
} from "lucide-react";

function TicketsContent() {
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const { selectedAgentId } = useAppSelector((state) => state.agent);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Multi-selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [claimingIds, setClaimingIds] = useState<Set<string>>(new Set());
  const [feedbackToast, setFeedbackToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (feedbackToast) {
      const timer = setTimeout(() => setFeedbackToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [feedbackToast]);

  // Construct query string from URL search params
  const fetchTickets = useCallback(
    async (pageToFetch = 1, append = false) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      const params = new URLSearchParams(searchParams.toString());
      params.set("page", pageToFetch.toString());
      params.set("limit", "25");

      try {
        const res = await fetch(`/api/tickets?${params.toString()}`);
        if (!res.ok) {
          throw new Error(
            res.status === 500
              ? "Simulated server failure. Please retry."
              : `Server returned HTTP ${res.status}`
          );
        }
        const data = await res.json();

        setTickets((prev) => (append ? [...prev, ...data.tickets] : data.tickets));
        setTotal(data.total);
        setCurrentPage(data.page);
        setTotalPages(data.totalPages);
        setError(null);
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to load tickets. Please check your connection.";
        setError(msg);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [searchParams]
  );

  // Re-fetch when searchParams change (page resets to 1)
  useEffect(() => {
    setSelectedIds([]);
    fetchTickets(1, false);
  }, [fetchTickets]);

  // Listen for in-place live updates of existing tickets
  useEffect(() => {
    const handleTicketUpdates = (event: Event) => {
      const customEvent = event as CustomEvent<Ticket[]>;
      const modified = customEvent.detail;
      if (!modified || modified.length === 0) return;

      const modifiedMap = new Map(modified.map((t) => [t.external_id, t]));
      setTickets((prev) =>
        prev.map((t) => modifiedMap.get(t.external_id) || t)
      );
    };

    window.addEventListener(TICKET_UPDATED_EVENT, handleTicketUpdates);
    return () => {
      window.removeEventListener(TICKET_UPDATED_EVENT, handleTicketUpdates);
    };
  }, []);

  const handleLoadMore = () => {
    if (currentPage < totalPages && !isLoadingMore) {
      fetchTickets(currentPage + 1, true);
    }
  };

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const handleSelectAllVisible = () => {
    if (selectedIds.length === tickets.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(tickets.map((t) => t.external_id));
    }
  };

  // Optimistic Single Ticket Claim
  const handleClaimTicket = useCallback(
    async (id: string) => {
      // Find current ticket to store backup for rollback
      const originalTicket = tickets.find((t) => t.external_id === id);
      if (!originalTicket) return;

      // Optimistic update
      setTickets((prev) =>
        prev.map((t) =>
          t.external_id === id
            ? { ...t, assigned_to: selectedAgentId, status: "in_progress" }
            : t
        )
      );
      dispatch(incrementMyTickets());
      setClaimingIds((prev) => new Set(prev).add(id));

      try {
        const res = await fetch(`/api/tickets/${id}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: selectedAgentId }),
        });

        if (res.ok) {
          const updated = await res.json();
          setTickets((prev) =>
            prev.map((t) => (t.external_id === id ? updated : t))
          );
          setFeedbackToast({
            type: "success",
            message: `Ticket ${id} claimed successfully.`,
          });
        } else {
          // Revert optimistic update
          const errData = await res.json().catch(() => ({}));
          setTickets((prev) =>
            prev.map((t) => (t.external_id === id ? originalTicket : t))
          );
          dispatch(decrementMyTickets());
          setFeedbackToast({
            type: "error",
            message:
              res.status === 409
                ? `Conflict: Another agent claimed ticket ${id} first.`
                : errData.error || `Failed to claim ticket ${id}.`,
          });
        }
      } catch {
        // Rollback on network failure
        setTickets((prev) =>
          prev.map((t) => (t.external_id === id ? originalTicket : t))
        );
        dispatch(decrementMyTickets());
        setFeedbackToast({
          type: "error",
          message: `Network error while claiming ${id}. Reverting change.`,
        });
      } finally {
        setClaimingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [tickets, selectedAgentId, dispatch]
  );

  // Handle incoming live tickets from banner
  const handleShowNewTickets = (newTickets: Ticket[]) => {
    setTickets((prev) => {
      const existing = new Set(prev.map((t) => t.external_id));
      const filteredNew = newTickets.filter((t) => !existing.has(t.external_id));
      return [...filteredNew, ...prev];
    });
    setTotal((prev) => prev + newTickets.length);
  };

  // Callback from BulkActionBar when tickets are updated
  const handleBulkUpdated = (updatedTickets: Ticket[]) => {
    const updatedMap = new Map(updatedTickets.map((t) => [t.external_id, t]));
    setTickets((prev) =>
      prev.map((t) => updatedMap.get(t.external_id) || t)
    );
    setSelectedIds([]);
  };

  const isAllSelected =
    tickets.length > 0 && selectedIds.length === tickets.length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Toast Feedback */}
      {feedbackToast && (
        <div
          className={`fixed top-16 right-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg transition-all ${
            feedbackToast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{feedbackToast.message}</span>
        </div>
      )}

      {/* Floating live updates banner */}
      <NewTicketsBanner onShowNewTickets={handleShowNewTickets} />

      {/* Header Info & Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Support Tickets
            </h1>
            <p className="text-xs text-neutral-500">
              {total.toLocaleString()} total tickets matching active criteria
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchTickets(1, false)}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs hover:bg-neutral-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filters and search box */}
        <TicketFiltersBar />
      </div>

      {/* Error state */}
      {error && (
        <div className="my-6 rounded-lg border border-rose-200 bg-rose-50/70 p-4 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-rose-600" />
          <p className="mt-2 text-xs font-medium text-rose-900">{error}</p>
          <button
            onClick={() => fetchTickets(currentPage, false)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry request</span>
          </button>
        </div>
      )}

      {/* Loading Initial State */}
      {isLoading && !error && (
        <div className="my-8 flex flex-col items-center justify-center gap-3 py-12 text-neutral-400">
          <Loader2 className="h-8 w-8 animate-spin text-neutral-600" />
          <p className="text-xs font-medium">Loading tickets from server...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && tickets.length === 0 && (
        <div className="my-8 rounded-lg border border-neutral-200 bg-white p-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-neutral-400" />
          <h3 className="mt-3 text-sm font-semibold text-neutral-900">
            No tickets found
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            No tickets match your search query or filter selection.
          </p>
        </div>
      )}

      {/* Ticket Table (Desktop) & Cards (Mobile) */}
      {!isLoading && !error && tickets.length > 0 && (
        <div className="mt-4">
          {/* Mobile view (< 640px) */}
          <div className="flex flex-col gap-2.5 sm:hidden">
            <div className="flex items-center justify-between px-1 py-1 text-xs text-neutral-500">
              <button
                onClick={handleSelectAllVisible}
                className="flex items-center gap-1.5 font-medium hover:text-neutral-900"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                <span>
                  {isAllSelected ? "Deselect all" : "Select all visible"}
                </span>
              </button>
              <span>Showing {tickets.length} of {total}</span>
            </div>

            {tickets.map((ticket) => (
              <MobileTicketCard
                key={ticket.external_id}
                ticket={ticket}
                isSelected={selectedIds.includes(ticket.external_id)}
                onToggleSelect={handleToggleSelect}
                onClaimTicket={handleClaimTicket}
                isClaiming={claimingIds.has(ticket.external_id)}
              />
            ))}
          </div>

          {/* Desktop view (>= 640px) */}
          <div className="hidden overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xs sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 font-medium text-neutral-600">
                  <tr>
                    <th className="w-10 px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAllVisible}
                        aria-label="Select all visible tickets"
                        className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                      />
                    </th>
                    <th className="px-3 py-2.5">Subject & ID</th>
                    <th className="px-3 py-2.5">Plan</th>
                    <th className="px-3 py-2.5">Category</th>
                    <th className="px-3 py-2.5">Priority</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Agent</th>
                    <th className="px-3 py-2.5">Created</th>
                    <th className="px-3 py-2.5">Deadline</th>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {tickets.map((ticket) => (
                    <TicketRow
                      key={ticket.external_id}
                      ticket={ticket}
                      isSelected={selectedIds.includes(ticket.external_id)}
                      onToggleSelect={handleToggleSelect}
                      onClaimTicket={handleClaimTicket}
                      isClaiming={claimingIds.has(ticket.external_id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Continuous Scrolling / Load More Trigger */}
          {currentPage < totalPages && (
            <div className="mt-6 flex flex-col items-center justify-center gap-2">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-5 py-2 text-xs font-semibold text-neutral-800 shadow-2xs hover:bg-neutral-50 disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading more tickets...</span>
                  </>
                ) : (
                  <span>
                    Scroll & Load more ({tickets.length} of {total.toLocaleString()})
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedIds={selectedIds}
        onClearSelection={() => setSelectedIds([])}
        onTicketsUpdated={handleBulkUpdated}
      />
    </div>
  );
}

export default function TicketsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      }
    >
      <TicketsContent />
    </Suspense>
  );
}
