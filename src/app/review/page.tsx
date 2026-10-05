"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAppDispatch } from "@/store";
import { decrementToReview } from "@/store/metricsSlice";
import { Ticket, Priority, StandardCategory } from "@/types/ticket";
import {
  PriorityBadge,
  PlanBadge,
  CategoryBadge,
} from "@/components/Badges";
import {
  Sparkles,
  Check,
  Edit3,
  AlertTriangle,
  RefreshCw,
  Loader2,
  CheckCircle2,
  X,
  FileText,
} from "lucide-react";

interface ModifyModalState {
  ticket: Ticket;
  category: string;
  priority: string;
  reason: string;
}

export default function ReviewQueuePage() {
  const dispatch = useAppDispatch();

  const [reviewTickets, setReviewTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active modal for changing category/priority
  const [modalState, setModalState] = useState<ModifyModalState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Toast feedback
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Fetch all tickets with triage_decision=manual_review
  const fetchReviewTickets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/tickets?triage_decision=manual_review&limit=100");
      if (!res.ok) {
        throw new Error(
          res.status === 500
            ? "Server error. Please retry."
            : `Failed with HTTP ${res.status}`
        );
      }
      const data = await res.json();
      setReviewTickets(data.tickets);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load review queue"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviewTickets();
  }, [fetchReviewTickets]);

  // Accept action: ticket leaves queue immediately
  const handleAccept = async (ticket: Ticket) => {
    const originalList = [...reviewTickets];

    // Optimistically remove from queue straight away
    setReviewTickets((prev) =>
      prev.filter((t) => t.external_id !== ticket.external_id)
    );
    dispatch(decrementToReview());

    try {
      const res = await fetch(`/api/tickets/${ticket.external_id}/triage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept: true }),
      });

      if (res.ok) {
        setToast({
          type: "success",
          message: `Ticket ${ticket.external_id} accepted and removed from review queue.`,
        });
      } else {
        // Rollback on failure
        setReviewTickets(originalList);
        const err = await res.json().catch(() => ({}));
        setToast({
          type: "error",
          message: err.error || `Failed to accept ticket ${ticket.external_id}.`,
        });
      }
    } catch {
      setReviewTickets(originalList);
      setToast({
        type: "error",
        message: "Network error while accepting ticket. Reverting change.",
      });
    }
  };

  // Open modal for modifying category or priority
  const openModifyModal = (ticket: Ticket) => {
    // If ticket has invalid priority like P5 (e.g. T-2004), default to valid P2 or P1 if enterprise
    let initialPriority = ticket.priority;
    if (initialPriority === "P5" || initialPriority === "P4") {
      initialPriority = ticket.customer_plan === "enterprise" ? "P1" : "P2";
    }

    setModalState({
      ticket,
      category: ticket.category,
      priority: initialPriority,
      reason: "",
    });
    setFormError(null);
  };

  // Submit modify triage form
  const handleModifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalState) return;

    const { ticket, category, priority, reason } = modalState;

    // Validation 1: Written reason must be at least 10 characters
    if (!reason || reason.trim().length < 10) {
      setFormError(
        `Written reason must be at least 10 characters (currently ${reason.trim().length}).`
      );
      return;
    }

    // Validation 2: Enterprise tickets must always stay at least P1
    if (
      ticket.customer_plan === "enterprise" &&
      (priority === "P2" || priority === "P3" || priority === "P4" || priority === "P5")
    ) {
      setFormError(
        "Enterprise customer tickets must always stay at least P1 (only P0 or P1 allowed)."
      );
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    const originalList = [...reviewTickets];

    // Optimistically remove from queue
    setReviewTickets((prev) =>
      prev.filter((t) => t.external_id !== ticket.external_id)
    );
    dispatch(decrementToReview());

    try {
      const res = await fetch(`/api/tickets/${ticket.external_id}/triage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          priority,
          reason: reason.trim(),
        }),
      });

      if (res.ok) {
        setToast({
          type: "success",
          message: `Ticket ${ticket.external_id} triage updated and removed from queue.`,
        });
        setModalState(null);
      } else {
        // Revert on error
        setReviewTickets(originalList);
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || "Failed to update triage on server.");
      }
    } catch {
      setReviewTickets(originalList);
      setFormError("Network error while submitting triage override.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-16 right-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg transition-all ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              AI Review Queue
            </h1>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Tickets flagged by the AI for human double-checking (`manual_review`).
            Handled tickets leave the queue immediately.
          </p>
        </div>

        <button
          onClick={fetchReviewTickets}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs hover:bg-neutral-50 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="my-6 rounded-lg border border-rose-200 bg-rose-50/70 p-4 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-rose-600" />
          <p className="mt-2 text-xs font-medium text-rose-900">{error}</p>
          <button
            onClick={fetchReviewTickets}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && !error && (
        <div className="my-12 flex flex-col items-center justify-center gap-3 py-12 text-neutral-400">
          <Loader2 className="h-8 w-8 animate-spin text-neutral-600" />
          <p className="text-xs font-medium">Loading AI review queue...</p>
        </div>
      )}

      {/* Empty Queue State */}
      {!isLoading && !error && reviewTickets.length === 0 && (
        <div className="my-12 rounded-lg border border-neutral-200 bg-white p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-sm font-bold text-neutral-900">
            All caught up!
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            There are currently no tickets requiring manual AI review.
          </p>
          <div className="mt-5">
            <Link
              href="/tickets"
              className="inline-flex items-center rounded-md bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800"
            >
              Go to Tickets
            </Link>
          </div>
        </div>
      )}

      {/* Review Ticket Cards Grid */}
      {!isLoading && !error && reviewTickets.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="text-xs font-semibold text-neutral-500">
            Showing {reviewTickets.length} ticket{reviewTickets.length > 1 ? "s" : ""} pending review
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {reviewTickets.map((ticket) => {
              const isEnterprise = ticket.customer_plan === "enterprise";

              return (
                <div
                  key={ticket.external_id}
                  className="flex flex-col justify-between rounded-lg border border-neutral-200 bg-white p-4 shadow-2xs transition-all hover:border-neutral-300"
                >
                  <div>
                    {/* Header: ID, Plan, Priority, Category */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-neutral-700">
                          {ticket.external_id}
                        </span>
                        <PlanBadge plan={ticket.customer_plan} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <PriorityBadge priority={ticket.priority} />
                        <span className="text-neutral-300">•</span>
                        <CategoryBadge category={ticket.category} />
                      </div>
                    </div>

                    {/* Subject */}
                    <h3
                      dir="auto"
                      className="mt-2.5 text-sm font-semibold text-neutral-900 break-words"
                    >
                      <Link
                        href={`/tickets/${ticket.external_id}`}
                        className="hover:text-blue-600 hover:underline"
                      >
                        {ticket.subject || "(No subject provided)"}
                      </Link>
                    </h3>

                    {/* Body Preview */}
                    <p
                      dir="auto"
                      className="mt-1 line-clamp-2 text-xs text-neutral-600 break-words"
                    >
                      {ticket.body || "(No message body)"}
                    </p>

                    {/* AI Analysis Details */}
                    <div className="mt-3 rounded-md border border-amber-200/70 bg-amber-50/50 p-2.5 text-xs text-neutral-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-900 text-2xs uppercase">
                          AI Flag Reason:
                        </span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.2 font-mono text-3xs font-bold text-amber-800">
                          {ticket.review_reason || (ticket.triage_decision !== "manual_review" ? `decision: ${ticket.triage_decision}` : "manual_review")}
                        </span>
                      </div>

                      {ticket.triage_decision !== "manual_review" && (
                        <div className="text-3xs font-semibold text-amber-800">
                          * Flagged due to unrecognized AI decision: &quot;{ticket.triage_decision}&quot;.
                        </div>
                      )}

                      {ticket.summary ? (
                        <div className="text-2xs text-neutral-700">
                          <span className="font-semibold">AI Summary: </span>
                          <span>{ticket.summary}</span>
                        </div>
                      ) : (
                        <div className="text-2xs italic text-neutral-400">
                          (No AI summary generated for this ticket)
                        </div>
                      )}

                      {isEnterprise && (
                        <div className="text-3xs font-semibold text-purple-700">
                          * Enterprise Rule: Minimum priority P1 required.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="mt-4 flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
                    <button
                      onClick={() => openModifyModal(ticket)}
                      className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>Change Category / Priority</span>
                    </button>

                    <button
                      onClick={() => handleAccept(ticket)}
                      className="flex items-center gap-1 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Accept AI Answer</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal: Change Category / Priority with Written Reason */}
      {modalState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-neutral-600" />
                <h3 className="text-sm font-bold text-neutral-900">
                  Override Triage for {modalState.ticket.external_id}
                </h3>
              </div>
              <button
                onClick={() => setModalState(null)}
                className="text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleModifySubmit} className="mt-4 space-y-4 text-xs">
              {/* Error Alert */}
              {formError && (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900">
                  {formError}
                </div>
              )}

              {/* Customer Plan info */}
              <div className="flex items-center justify-between rounded bg-neutral-50 p-2">
                <span className="text-neutral-500">Customer Plan:</span>
                <PlanBadge plan={modalState.ticket.customer_plan} />
              </div>

              {/* Priority Select */}
              <div>
                <label className="block font-semibold text-neutral-700">
                  Select Priority:
                </label>
                <select
                  value={modalState.priority}
                  onChange={(e) =>
                    setModalState({ ...modalState, priority: e.target.value })
                  }
                  className="mt-1 h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="P0">P0 (Critical)</option>
                  <option value="P1">P1 (High)</option>
                  <option
                    value="P2"
                    disabled={modalState.ticket.customer_plan === "enterprise"}
                  >
                    P2 (Medium){" "}
                    {modalState.ticket.customer_plan === "enterprise"
                      ? "— Disabled (Enterprise min P1)"
                      : ""}
                  </option>
                  <option
                    value="P3"
                    disabled={modalState.ticket.customer_plan === "enterprise"}
                  >
                    P3 (Low){" "}
                    {modalState.ticket.customer_plan === "enterprise"
                      ? "— Disabled (Enterprise min P1)"
                      : ""}
                  </option>
                </select>
                {modalState.ticket.customer_plan === "enterprise" && (
                  <p className="mt-1 text-3xs text-purple-700 font-medium">
                    Enterprise tickets cannot be set lower than P1.
                  </p>
                )}
              </div>

              {/* Category Select */}
              <div>
                <label className="block font-semibold text-neutral-700">
                  Select Category:
                </label>
                <select
                  value={modalState.category}
                  onChange={(e) =>
                    setModalState({ ...modalState, category: e.target.value })
                  }
                  className="mt-1 h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value="account_access">Account Access</option>
                  <option value="billing">Billing</option>
                  <option value="bug">Bug</option>
                  <option value="feature_request">Feature Request</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Written Reason (min 10 characters) */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-neutral-700">
                    Written Reason:
                  </label>
                  <span
                    className={`text-3xs font-mono ${
                      modalState.reason.trim().length >= 10
                        ? "text-emerald-600 font-semibold"
                        : "text-neutral-400"
                    }`}
                  >
                    {modalState.reason.trim().length} / 10 chars minimum
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={modalState.reason}
                  onChange={(e) =>
                    setModalState({ ...modalState, reason: e.target.value })
                  }
                  placeholder="Explain why you are changing the category or priority (at least 10 characters)..."
                  className="mt-1 w-full rounded-md border border-neutral-300 p-2 text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              {/* Form buttons */}
              <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
                <button
                  type="button"
                  onClick={() => setModalState(null)}
                  disabled={isSubmitting}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-neutral-800 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>Save and Remove from Queue</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
