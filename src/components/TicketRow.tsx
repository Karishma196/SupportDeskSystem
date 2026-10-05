"use client";

import React, { memo } from "react";
import Link from "next/link";
import { Ticket, VALID_AGENTS } from "@/types/ticket";
import {
  PriorityBadge,
  StatusBadge,
  PlanBadge,
  CategoryBadge,
} from "./Badges";
import { DeadlineBadge } from "./DeadlineBadge";
import { formatRelativeTime } from "@/lib/dateUtils";

interface TicketRowProps {
  ticket: Ticket;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onClaimTicket?: (id: string) => void;
  isClaiming?: boolean;
}

function getAgentDisplayName(agentId: string | null): string {
  if (!agentId) return "Unassigned";
  const found = VALID_AGENTS.find((a) => a.id === agentId);
  return found ? found.name : agentId;
}

export const TicketRow = memo(
  function TicketRow({
    ticket,
    isSelected,
    onToggleSelect,
    onClaimTicket,
    isClaiming = false,
  }: TicketRowProps) {
    const agentName = getAgentDisplayName(ticket.assigned_to);
    const displaySubject = ticket.subject?.trim() || "(No subject)";

    return (
      <tr
        className={`group border-b border-neutral-100 transition-colors hover:bg-neutral-50/80 ${
          isSelected ? "bg-blue-50/50" : ""
        }`}
      >
        {/* Selection Checkbox */}
        <td className="w-10 px-3 py-3 text-center">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(ticket.external_id)}
            aria-label={`Select ticket ${ticket.external_id}`}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
          />
        </td>

        {/* Subject & ID */}
        <td className="max-w-[280px] px-3 py-3 sm:max-w-xs md:max-w-md">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-2xs font-semibold text-neutral-500">
                {ticket.external_id}
              </span>
              {ticket.triage_decision === "manual_review" && (
                <span className="rounded bg-amber-100 px-1 py-0.2 text-3xs font-semibold text-amber-800">
                  Review
                </span>
              )}
            </div>
            <Link
              href={`/tickets/${ticket.external_id}`}
              dir="auto"
              className="line-clamp-1 break-all text-xs font-medium text-neutral-900 hover:text-blue-600 hover:underline"
              title={ticket.subject || "(No subject)"}
            >
              {displaySubject}
            </Link>
          </div>
        </td>

        {/* Plan */}
        <td className="whitespace-nowrap px-3 py-3">
          <PlanBadge plan={ticket.customer_plan} />
        </td>

        {/* Category */}
        <td className="whitespace-nowrap px-3 py-3">
          <CategoryBadge category={ticket.category} />
        </td>

        {/* Priority */}
        <td className="whitespace-nowrap px-3 py-3">
          <PriorityBadge
            priority={ticket.priority}
            aiPriority={ticket.ai_priority}
          />
        </td>

        {/* Status */}
        <td className="whitespace-nowrap px-3 py-3">
          <StatusBadge status={ticket.status} />
        </td>

        {/* Agent */}
        <td className="whitespace-nowrap px-3 py-3 text-xs">
          <span
            className={
              ticket.assigned_to ? "font-medium text-neutral-800" : "text-neutral-400 italic"
            }
          >
            {agentName}
          </span>
        </td>

        {/* Created Time */}
        <td className="whitespace-nowrap px-3 py-3 text-xs text-neutral-500">
          <span title={ticket.created_at}>
            {formatRelativeTime(ticket.created_at)}
          </span>
        </td>

        {/* SLA Deadline */}
        <td className="whitespace-nowrap px-3 py-3">
          <DeadlineBadge
            createdAt={ticket.created_at}
            priority={ticket.priority}
          />
        </td>

        {/* Quick Actions */}
        <td className="whitespace-nowrap px-3 py-3 text-right">
          {ticket.assigned_to === null && onClaimTicket && (
            <button
              onClick={() => onClaimTicket(ticket.external_id)}
              disabled={isClaiming}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-2xs font-medium text-neutral-700 shadow-2xs hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-50"
            >
              {isClaiming ? "Claiming..." : "Claim"}
            </button>
          )}
        </td>
      </tr>
    );
  },
  // Custom memo comparison function to prevent sibling row re-renders when one ticket updates
  (prev, next) => {
    return (
      prev.ticket.external_id === next.ticket.external_id &&
      prev.ticket.status === next.ticket.status &&
      prev.ticket.priority === next.ticket.priority &&
      prev.ticket.category === next.ticket.category &&
      prev.ticket.customer_plan === next.ticket.customer_plan &&
      prev.ticket.assigned_to === next.ticket.assigned_to &&
      prev.ticket.updated_at === next.ticket.updated_at &&
      prev.isSelected === next.isSelected &&
      prev.isClaiming === next.isClaiming
    );
  }
);
