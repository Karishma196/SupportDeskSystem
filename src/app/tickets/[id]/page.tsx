"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppSelector, useAppDispatch } from "@/store";
import { incrementMyTickets, decrementMyTickets } from "@/store/metricsSlice";
import { Ticket, Status, VALID_AGENTS } from "@/types/ticket";
import {
  PriorityBadge,
  StatusBadge,
  PlanBadge,
  CategoryBadge,
} from "@/components/Badges";
import { DeadlineBadge } from "@/components/DeadlineBadge";
import { sanitizeCustomerHtml, validateSafeUrl } from "@/lib/sanitize";
import { formatRelativeTime } from "@/lib/dateUtils";
import {
  ArrowLeft,
  UserCheck,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  Paperclip,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Clock,
  RotateCcw,
} from "lucide-react";

export default function TicketDetailsPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolvedParams =
    params && typeof (params as Promise<{ id: string }>).then === "function"
      ? use(params as Promise<{ id: string }>)
      : (params as { id: string });
  const ticketId = resolvedParams.id;
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { selectedAgentId } = useAppSelector((state) => state.agent);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNotFound, setIsNotFound] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // In-flight guard to prevent double-clicks
  const [isClaiming, setIsClaiming] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isRetriaging, setIsRetriaging] = useState(false);

  // Toast notifications
  const [toast, setToast] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Fetch ticket details
  const fetchTicket = useCallback(
    async (showLoading = true) => {
      if (showLoading) setIsLoading(true);
      setErrorMessage(null);

      try {
        const res = await fetch(`/api/tickets/${ticketId}`);
        if (res.status === 404) {
          setIsNotFound(true);
          return;
        }
        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }
        const data: Ticket = await res.json();
        setTicket((prev) => {
          // If another agent claimed it while looking at it, inform current agent
          if (
            prev &&
            prev.assigned_to !== data.assigned_to &&
            data.assigned_to !== selectedAgentId &&
            data.assigned_to !== null
          ) {
            setToast({
              type: "info",
              message: `Notice: Ticket was claimed by ${data.assigned_to}.`,
            });
          }
          return data;
        });
      } catch (err: unknown) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load ticket"
        );
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [ticketId, selectedAgentId]
  );

  useEffect(() => {
    fetchTicket(true);
  }, [fetchTicket]);

  // Poll for updates every 6 seconds while looking at this ticket
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTicket(false);
    }, 6000);

    return () => clearInterval(interval);
  }, [fetchTicket]);

  // Optimistic Claim action
  const handleClaim = async () => {
    if (!ticket || isClaiming) return;
    setIsClaiming(true);

    const previousTicket = { ...ticket };

    // Apply optimistic update immediately
    setTicket((prev) =>
      prev
        ? {
            ...prev,
            assigned_to: selectedAgentId,
            status: prev.status === "open" ? "in_progress" : prev.status,
          }
        : null
    );
    dispatch(incrementMyTickets());

    try {
      const res = await fetch(`/api/tickets/${ticketId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: selectedAgentId }),
      });

      if (res.ok) {
        const updated = await res.json();
        setTicket(updated);
        setToast({
          type: "success",
          message: "Ticket claimed successfully.",
        });
      } else {
        // Rollback on server conflict or failure
        setTicket(previousTicket);
        dispatch(decrementMyTickets());
        const err = await res.json().catch(() => ({}));
        setToast({
          type: "error",
          message:
            res.status === 409
              ? `Conflict: ${err.error || "Another agent claimed this ticket first."}`
              : err.error || "Failed to claim ticket.",
        });
      }
    } catch {
      // Rollback on network failure
      setTicket(previousTicket);
      dispatch(decrementMyTickets());
      setToast({
        type: "error",
        message: "Network error while claiming ticket. Reverting changes.",
      });
    } finally {
      setIsClaiming(false);
    }
  };

  // Status transition action with double-click guard
  const handleStatusChange = async (nextStatus: Status) => {
    if (!ticket || isUpdatingStatus) return;
    setIsUpdatingStatus(true);

    const previousTicket = { ...ticket };

    // Optimistically update status
    setTicket((prev) => (prev ? { ...prev, status: nextStatus } : null));

    try {
      const res = await fetch(`/api/tickets/${ticketId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (res.ok) {
        const updated = await res.json();
        setTicket(updated);
        setToast({
          type: "success",
          message: `Status updated to ${nextStatus.replace("_", " ")}.`,
        });
      } else {
        setTicket(previousTicket);
        const err = await res.json().catch(() => ({}));
        setToast({
          type: "error",
          message: err.error || "Failed to update ticket status.",
        });
      }
    } catch {
      setTicket(previousTicket);
      setToast({
        type: "error",
        message: "Network error while updating status. Reverting change.",
      });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Re-run AI Triage action
  const handleRetriage = async () => {
    if (!ticket || isRetriaging) return;
    setIsRetriaging(true);

    try {
      const res = await fetch(`/api/tickets/${ticketId}/retriage`, {
        method: "POST",
      });

      if (res.ok) {
        const updated = await res.json();
        setTicket(updated);
        setToast({
          type: "success",
          message: "AI triage completed successfully.",
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setToast({
          type: "error",
          message: err.error || "Failed to re-triage ticket.",
        });
      }
    } catch {
      setToast({
        type: "error",
        message: "Network error during AI triage.",
      });
    } finally {
      setIsRetriaging(false);
    }
  };

  // 404 Not Found Page
  if (isNotFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-neutral-900">
          Ticket Not Found
        </h1>
        <p className="mt-2 text-xs text-neutral-500">
          No ticket exists with identifier &ldquo;{ticketId}&rdquo;. It may have been deleted or never existed.
        </p>
        <div className="mt-6">
          <Link
            href="/tickets"
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-neutral-800"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Return to Tickets</span>
          </Link>
        </div>
      </div>
    );
  }

  // Loading State
  if (isLoading || !ticket) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-neutral-400" />
        <p className="mt-3 text-xs text-neutral-500">Loading ticket details...</p>
      </div>
    );
  }

  // Calculate allowed status transitions
  const allowedTransitions: Status[] = [];
  if (ticket.status === "open") {
    allowedTransitions.push("in_progress");
  } else if (ticket.status === "in_progress") {
    allowedTransitions.push("resolved");
  } else if (ticket.status === "resolved") {
    allowedTransitions.push("open", "closed");
  } else if (ticket.status === "closed") {
    allowedTransitions.push("open");
  }

  const assignedAgentName =
    VALID_AGENTS.find((a) => a.id === ticket.assigned_to)?.name ||
    ticket.assigned_to ||
    "Unassigned";

  const isAssignedToMe = ticket.assigned_to === selectedAgentId;
  const isClaimedByOther =
    ticket.assigned_to !== null && ticket.assigned_to !== selectedAgentId;

  // Validate attachment URL
  const attachmentValidation = validateSafeUrl(ticket.attachment_url);

  // Safe HTML content
  const sanitizedBody = sanitizeCustomerHtml(ticket.body);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Toast Feedback */}
      {toast && (
        <div
          className={`fixed top-16 right-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg transition-all ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : toast.type === "info"
              ? "border-blue-200 bg-blue-50 text-blue-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Back button & Title header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/tickets"
          className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Ticket List</span>
        </Link>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Claim Button */}
          {ticket.assigned_to === null && (
            <button
              onClick={handleClaim}
              disabled={isClaiming}
              className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-neutral-800 disabled:opacity-50"
            >
              {isClaiming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserCheck className="h-3.5 w-3.5" />
              )}
              <span>Claim ticket</span>
            </button>
          )}

          {/* Allowed Next Status Buttons */}
          {allowedTransitions.map((nextSt) => (
            <button
              key={nextSt}
              onClick={() => handleStatusChange(nextSt)}
              disabled={isUpdatingStatus}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold shadow-2xs disabled:opacity-50 ${
                nextSt === "resolved"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  : nextSt === "closed"
                  ? "border-neutral-300 bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                  : nextSt === "in_progress"
                  ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
              }`}
            >
              {isUpdatingStatus ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5" />
              )}
              <span>Move to {nextSt.replace("_", " ")}</span>
            </button>
          ))}

          {/* Re-run AI Button */}
          <button
            onClick={handleRetriage}
            disabled={isRetriaging}
            className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs hover:bg-neutral-50 disabled:opacity-50"
            title="Trigger secure server-side AI re-triage"
          >
            {isRetriaging ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            )}
            <span>Re-run AI</span>
          </button>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column (2 cols): Ticket Body & Customer Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Main Card */}
          <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-2xs">
            {/* ID & Status Row */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-neutral-600">
                  {ticket.external_id}
                </span>
                <PlanBadge plan={ticket.customer_plan} />
                <StatusBadge status={ticket.status} />
              </div>
              <DeadlineBadge
                createdAt={ticket.created_at}
                priority={ticket.priority}
              />
            </div>

            {/* Subject */}
            <h1
              dir="auto"
              className="mt-3 text-lg font-bold tracking-tight text-neutral-900 break-words"
            >
              {ticket.subject || "(No subject provided)"}
            </h1>

            {/* Meta Row */}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-neutral-500">
              <span>Customer: {ticket.customer_id}</span>
              <span>•</span>
              <span title={ticket.created_at}>
                Created {formatRelativeTime(ticket.created_at)}
              </span>
            </div>

            {/* Body */}
            <div className="mt-5 border-t border-neutral-100 pt-4">
              <h2 className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">
                Customer Message
              </h2>
              {sanitizedBody ? (
                <div
                  dir="auto"
                  className="prose prose-sm mt-2 max-w-none text-neutral-800 break-words"
                  dangerouslySetInnerHTML={{ __html: sanitizedBody }}
                />
              ) : (
                <p className="mt-2 text-xs italic text-neutral-400">
                  (No message body provided)
                </p>
              )}
            </div>

            {/* Attachment Section */}
            {ticket.attachment_url && (
              <div className="mt-5 border-t border-neutral-100 pt-4">
                <h2 className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">
                  Customer Attachment
                </h2>
                {attachmentValidation.isSafe && attachmentValidation.sanitizedUrl ? (
                  <div className="mt-2">
                    <a
                      href={attachmentValidation.sanitizedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100 hover:text-blue-600"
                    >
                      <Paperclip className="h-3.5 w-3.5 text-neutral-500" />
                      <span className="truncate max-w-xs">
                        {attachmentValidation.sanitizedUrl}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-neutral-400" />
                    </a>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>{attachmentValidation.warning}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 col): Metadata & AI Triage Analysis */}
        <div className="space-y-6">
          {/* Assignment & Status Card */}
          <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-2xs">
            <h2 className="text-xs font-semibold text-neutral-900">
              Assignment & SLA
            </h2>
            <div className="mt-3 space-y-3 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-neutral-100">
                <span className="text-neutral-500">Assigned Agent</span>
                <span
                  className={
                    ticket.assigned_to
                      ? "font-semibold text-neutral-900"
                      : "italic text-neutral-400"
                  }
                >
                  {assignedAgentName}
                  {isAssignedToMe && " (You)"}
                </span>
              </div>

              {isClaimedByOther && (
                <div className="rounded bg-amber-50 p-2 text-2xs text-amber-800">
                  This ticket is currently assigned to another agent ({ticket.assigned_to}).
                </div>
              )}

              <div className="flex justify-between items-center py-1 border-b border-neutral-100">
                <span className="text-neutral-500">Status</span>
                <StatusBadge status={ticket.status} />
              </div>

              <div className="flex justify-between items-center py-1 border-b border-neutral-100">
                <span className="text-neutral-500">Customer Plan</span>
                <PlanBadge plan={ticket.customer_plan} />
              </div>

              <div className="flex justify-between items-center py-1">
                <span className="text-neutral-500">Category</span>
                <CategoryBadge category={ticket.category} />
              </div>
            </div>
          </div>

          {/* AI Triage Card */}
          <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-900">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span>AI Triage Inspection</span>
            </div>

            <div className="mt-3 space-y-3 text-xs">
              <div>
                <span className="text-2xs text-neutral-400 uppercase font-semibold">
                  AI Summary
                </span>
                <p className="mt-1 text-xs text-neutral-800 bg-neutral-50 p-2 rounded border border-neutral-100">
                  {ticket.summary || "No AI summary generated"}
                </p>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-neutral-100">
                <span className="text-neutral-500">Triage Decision</span>
                <span
                  className={`font-semibold rounded px-1.5 py-0.5 text-2xs ${
                    ticket.triage_decision === "auto_accept"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {ticket.triage_decision}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-neutral-100">
                <span className="text-neutral-500">Current Priority</span>
                <PriorityBadge priority={ticket.priority} />
              </div>

              {/* Show both priorities if AI suggested something different */}
              {ticket.ai_priority && ticket.ai_priority !== ticket.priority && (
                <div className="rounded border border-amber-200 bg-amber-50/70 p-2 text-2xs">
                  <div className="font-semibold text-amber-900">
                    Priority Adjusted from AI
                  </div>
                  <div className="mt-1 text-amber-800">
                    AI suggested:{" "}
                    <span className="font-mono font-bold">
                      {ticket.ai_priority}
                    </span>
                    , but final priority was set to{" "}
                    <span className="font-mono font-bold">{ticket.priority}</span>.
                  </div>
                  {ticket.review_reason && (
                    <div className="mt-1 text-amber-700">
                      Reason: {ticket.review_reason}
                    </div>
                  )}
                </div>
              )}

              {ticket.review_reason && (!ticket.ai_priority || ticket.ai_priority === ticket.priority) && (
                <div className="py-1">
                  <span className="text-2xs text-neutral-400 uppercase font-semibold">
                    Review Reason
                  </span>
                  <p className="mt-1 text-xs text-neutral-600">
                    {ticket.review_reason}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
