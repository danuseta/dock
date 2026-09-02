import React from 'react';
import { 
  User, 
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { PRBadge } from './PRBadge';
import { cn } from '../lib/cn';
import { getApprovalLabels } from '../lib/ticketApprovals';
import { displayAssignee } from '../lib/queryPolicy';

interface TicketCardProps {
  ticket: {
    key: string;
    title: string;
    status: string;
    assignee?: string;
    sprintName?: string;
    sprintState?: string;
    storyPoints?: number | null;
    labels?: string[];
    pullRequests?: any[];
    demoLink?: { url: string };
  };
  onClick: () => void;
}

export const TicketCard: React.FC<TicketCardProps> = ({ ticket, onClick }) => {
  const hasConflict = ticket.pullRequests?.some(pr => pr.status?.toUpperCase() === 'CONFLICT') ?? false;
  const isOldSprint = ticket.sprintState === 'CLOSED';
  const approvalLabels = getApprovalLabels(ticket.labels);
  const assignee = displayAssignee(ticket.assignee);

  return (
    <button
      type="button"
      className={cn(
        'flex w-full flex-col justify-between gap-3 rounded-md border border-border bg-surface-1 px-4 py-3.5 text-left shadow-card transition-colors duration-150 ease-out hover:border-border-glow',
        hasConflict && 'border-status-conflict/60 shadow-conflict',
      )}
      onClick={onClick}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="rounded-xs border border-accent/30 bg-accent-dim px-[9px] py-[3px] font-mono text-sm font-extrabold text-accent">
            {ticket.key}
          </span>

          {ticket.storyPoints != null && (
            <span className="rounded-xs border border-amber-300/35 bg-amber-300/10 px-[7px] py-0.5 font-mono text-xs font-extrabold text-amber-200 tabular-nums">
              {ticket.storyPoints}
            </span>
          )}

          {hasConflict && (
            <span className="flex items-center gap-1 rounded-xs border border-status-conflict bg-status-conflict-bg px-[7px] py-0.5 font-mono text-[0.72rem] font-bold text-status-conflict">
              <AlertTriangle size={12} aria-hidden="true" /> CONFLICT
            </span>
          )}
        </div>

        <PRBadge status={ticket.status} />
      </div>

      {ticket.sprintName && ticket.sprintName !== 'No Sprint' && (
        <div className={cn('font-mono text-[0.72rem] font-semibold text-green-300', isOldSprint && 'text-muted-foreground')}>
          {ticket.sprintName}
        </div>
      )}

      <h3 className="text-pretty text-[0.95rem] leading-[1.45] font-bold text-foreground">
        {ticket.title}
      </h3>

      {approvalLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Approved checks">
          {approvalLabels.map((label) => (
            <span className="inline-flex items-center gap-1 rounded-xs border border-status-merged/40 bg-status-merged/10 px-2 py-1 font-mono text-[0.68rem] font-bold text-status-merged" key={label}>
              <CheckCircle2 size={12} aria-hidden="true" /> {label}
            </span>
          ))}
        </div>
      )}

      {assignee && (
        <div className="mt-auto flex items-center border-t border-border pt-2">
          <div className="flex items-center gap-1.5 font-mono text-xs text-secondary-foreground">
            <User size={12} className="text-muted-foreground" aria-hidden="true" />
            <span className="font-semibold text-foreground">{assignee}</span>
          </div>
        </div>
      )}
    </button>
  );
};
