import React, { useRef } from 'react';
import { AlertTriangle, Hand, MoreVertical, User } from 'lucide-react';
import { cn } from '../lib/cn';
import { getPassLabels } from '../lib/ticketApprovals';
import { displayAssignee } from '../lib/queryPolicy';
import { MENU_WIDTH } from './ticket/TicketMenu';

const LONG_PRESS_MS = 500;

interface TicketCardProps {
  ticket: {
    key: string;
    title: string;
    assignee?: string;
    storyPoints?: number | null;
    labels?: string[];
    workOrder?: number | null;
    workOrderSource?: string | null;
    workManual?: boolean | null;
    pullRequests?: any[];
  };
  menuOpen: boolean;
  onClick: () => void;
  /** Opens the ticket menu at a point, or as a bottom sheet after a long press. */
  onMenu: (x: number, y: number, sheet: boolean) => void;
}

export const TicketCard: React.FC<TicketCardProps> = ({ ticket, menuOpen, onClick, onMenu }) => {
  const hasConflict = ticket.pullRequests?.some(pr => pr.status?.toUpperCase() === 'CONFLICT') ?? false;
  const passLabels = getPassLabels(ticket.labels);
  const assignee = displayAssignee(ticket.assignee);
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  // The click that ends a long press must not also open the ticket.
  const pressed = () => {
    const fired = press.current?.fired === true;
    press.current = null;
    return fired;
  };

  return (
    <article
      className={cn(
        'group relative rounded-md border border-border bg-surface-1 shadow-card transition-colors duration-150 ease-out hover:border-border-glow',
        menuOpen && 'border-border-glow ring-2 ring-accent/60',
      )}
      onContextMenu={(event) => {
        event.preventDefault();
        // A phone fires contextmenu for its own long press; that one opens the sheet too.
        if (press.current) {
          endPress();
          press.current.fired = true;
          onMenu(0, 0, true);
          return;
        }
        onMenu(event.clientX, event.clientY, false);
      }}
      onTouchStart={() => {
        endPress();
        const current = { timer: 0, fired: false };
        current.timer = window.setTimeout(() => {
          current.fired = true;
          onMenu(0, 0, true);
        }, LONG_PRESS_MS);
        press.current = current;
      }}
      onTouchMove={endPress}
      onTouchEnd={endPress}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-2 rounded-md px-4 py-3 pr-10 text-left max-[900px]:pr-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        onClick={() => { if (!pressed()) onClick(); }}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          onMenu(box.left + 24, box.bottom, false);
        }}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-extrabold text-accent">{ticket.key}</span>
          {ticket.workOrder != null && (
            <span
              className="font-mono text-xs font-semibold text-secondary-foreground tabular-nums"
              title={ticket.workOrderSource === 'dock' ? 'Work order set in DOCK' : 'Work order from the Jira label'}
            >
              #{ticket.workOrder}
            </span>
          )}
          {ticket.workManual && <span className="text-sky-200" title="Worked manually: the cron skips it"><Hand size={13} aria-hidden="true" /><span className="sr-only">Manual</span></span>}
          {hasConflict && <span className="flex items-center gap-1 text-xs font-semibold text-status-conflict"><AlertTriangle size={12} aria-hidden="true" />Conflict</span>}
        </span>

        <span className="text-pretty text-[0.92rem] leading-[1.4] font-bold text-foreground">{ticket.title}</span>

        {passLabels.length > 0 && (
          <span className="flex flex-wrap gap-1" aria-label="Approved by">
            {passLabels.map((label) => <span key={label} className="rounded-xs bg-status-merged-bg px-1.5 py-0.5 font-mono text-[0.68rem] font-semibold text-status-merged">{label}</span>)}
          </span>
        )}

        {(assignee || ticket.storyPoints != null) && (
          <span className="mt-auto flex items-center gap-1.5 border-t border-border pt-2 font-mono text-xs text-secondary-foreground">
            {assignee && <><User size={12} className="text-muted-foreground" aria-hidden="true" /><span className="font-semibold text-foreground">{assignee}</span></>}
            {ticket.storyPoints != null && <span className="ml-auto font-bold tabular-nums">{ticket.storyPoints} SP</span>}
          </span>
        )}
      </button>

      <button
        type="button"
        aria-label={`Actions for ${ticket.key}`}
        aria-haspopup="menu"
        className={cn(
          'absolute top-2 right-2 grid size-7 place-items-center rounded-xs text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover:opacity-100 [@media(hover:none)]:opacity-100 max-[900px]:size-11',
          menuOpen && 'opacity-100',
        )}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onMenu(box.right - MENU_WIDTH, box.bottom + 4, false);
        }}
      >
        <MoreVertical size={15} aria-hidden="true" />
      </button>
    </article>
  );
};
