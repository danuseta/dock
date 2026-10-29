import React, { useState } from 'react';
import { Bot, ChevronDown, ExternalLink } from 'lucide-react';
import { cn } from '../lib/cn';
import { isPhone } from '../lib/phone';
import { formatAge } from './runs';
import { AUTO_REVIEW_LABEL, prLabel, type AutoReviewRow } from './autoReviews';

const TONE: Record<string, string> = {
  lgtm: 'border-status-merged text-status-merged',
  clean: 'border-status-merged text-status-merged',
  blockers: 'border-status-conflict text-status-conflict',
  failed: 'border-status-conflict text-status-conflict',
};

export const AutoReviewBadge: React.FC<{ row: AutoReviewRow | undefined; className?: string }> = ({ row, className }) => {
  if (row?.status !== 'lgtm') return null;
  return <span className={cn('inline-flex flex-none items-center gap-1 rounded-xs border border-status-merged px-1.5 py-px font-mono text-[0.62rem] font-bold text-status-merged', className)} title={`DOCK sent the LGTM after its review of ${prLabel(row.prUrl)}`}><Bot size={11} aria-hidden="true" />Auto LGTM</span>;
};

/** The reviews DOCK started on its own after the owner said on it, newest first, with what came of each. */
export const AutoReviewList: React.FC<{ rows: AutoReviewRow[]; now: number; onTicket: (key: string) => void; onNavigate: (path: string) => void; className?: string }> = ({ rows, now, onTicket, onNavigate, className }) => {
  const [open, setOpen] = useState(() => !isPhone());
  if (rows.length === 0) return null;
  const running = rows.filter((row) => row.status === 'running' || row.status === 'deciding').length;
  const needYou = rows.filter((row) => row.status === 'blockers').length;
  return (
    <section className={cn('mb-4 rounded-md border border-border bg-surface-0', className)} aria-label="Auto reviews">
      <button type="button" className="flex w-full items-center gap-2 px-4 py-2.5 text-left max-[760px]:min-h-11" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Bot size={15} aria-hidden="true" className="text-accent" />
        <b className="font-display text-sm font-semibold">Auto reviews</b>
        <span className="font-mono text-[0.68rem] text-muted-foreground">{rows.length}{running ? ` · ${running} running` : ''}<span className="hidden max-[760px]:inline">{needYou ? ` · ${needYou} need you` : ''}</span></span>
        <ChevronDown size={14} aria-hidden="true" className={cn('ml-auto text-muted-foreground transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <ul className="m-0 list-none border-t border-border p-0">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-xs last:border-b-0">
              <button type="button" className="font-mono font-extrabold text-accent hover:underline max-[760px]:min-h-11" onClick={() => onTicket(row.ticketKey)}>{row.ticketKey}</button>
              <a href={row.prUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-mono text-secondary-foreground hover:text-foreground max-[760px]:min-h-11"><span className="truncate">{prLabel(row.prUrl)}</span><ExternalLink size={11} aria-hidden="true" /></a>
              <span className="font-mono text-[0.62rem] text-muted-foreground max-[760px]:text-xs">{row.headSha.slice(0, 7)}</span>
              <span className={cn('rounded-xs border px-1.5 py-px font-mono text-[0.62rem] font-bold max-[760px]:text-xs', TONE[row.status] ?? 'border-border text-secondary-foreground')}>{AUTO_REVIEW_LABEL[row.status] ?? row.status}</span>
              {row.detail && <span className="min-w-0 truncate text-secondary-foreground">{row.detail}</span>}
              <span className="ml-auto flex items-center gap-3 text-muted-foreground">
                {row.sessionId && <button type="button" className="text-accent hover:underline max-[760px]:min-h-11" onClick={() => onNavigate(`/sessions?session=${encodeURIComponent(row.sessionId as string)}`)}>Session</button>}
                <a href={row.threadUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline max-[760px]:inline-flex max-[760px]:min-h-11 max-[760px]:items-center">Thread</a>
                <span className="tabular-nums">{formatAge(Math.max(0, (now - Date.parse(row.startedAt)) / 1000))} ago</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
