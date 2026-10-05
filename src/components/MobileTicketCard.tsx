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

interface MobileTicketCardProps {
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

export const MobileTicketCard = memo(
  function MobileTicketCard({
    ticket,
    isSelected,
    onToggleSelect,
    onClaimTicket,
    isClaiming = false,
  }: MobileTicketCardProps) {
    const agentName = getAgentDisplayName(ticket.assigned_to);
    const displaySubject = ticket.subject?.trim() || "(No subject)";

    return (
      <div
        className={`flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-2xs transition-colors ${
          isSelected ? "border-blue-300 bg-blue-50/40" : ""
        }`}
      >
        {/* Top Header: Checkbox, ID, Plan, SLA */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(ticket.external_id)}
              aria-label={`Select ticket ${ticket.external_id}`}
              className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
            />
            <span className="font-mono text-xs font-bold text-neutral-700">
              {ticket.external_id}
            </span>
            <PlanBadge plan={ticket.customer_plan} />
          </div>
          <DeadlineBadge
            createdAt={ticket.created_at}
            priority={ticket.priority}
          />
        </div>

        {/* Subject */}
        <div>
          <Link
            href={`/tickets/${ticket.external_id}`}
            dir="auto"
            className="line-clamp-2 break-all text-sm font-medium text-neutral-900 hover:text-blue-600"
          >
            {displaySubject}
          </Link>
        </div>

        {/* Metadata Badges */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
          <StatusBadge status={ticket.status} />
          <PriorityBadge
            priority={ticket.priority}
            aiPriority={ticket.ai_priority}
          />
          <div className="text-neutral-400">•</div>
          <CategoryBadge category={ticket.category} />
        </div>

        {/* Footer: Agent, Created Time, Claim Button */}
        <div className="flex items-center justify-between border-t border-neutral-100 pt-2 text-2xs text-neutral-500">
          <div className="flex items-center gap-1">
            <span>Agent:</span>
            <span
              className={
                ticket.assigned_to ? "font-semibold text-neutral-800" : "italic"
              }
            >
              {agentName}
            </span>
            <span>•</span>
            <span>{formatRelativeTime(ticket.created_at)}</span>
          </div>

          {ticket.assigned_to === null && onClaimTicket && (
            <button
              onClick={() => onClaimTicket(ticket.external_id)}
              disabled={isClaiming}
              className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-2xs font-semibold text-neutral-800 shadow-2xs hover:bg-neutral-50 disabled:opacity-50"
            >
              {isClaiming ? "Claiming..." : "Claim"}
            </button>
          )}
        </div>
      </div>
    );
  },
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
