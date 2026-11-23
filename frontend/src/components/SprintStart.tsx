import React, { useState } from 'react';
import { useMutation } from '@apollo/client';
import { Lock, Play, X } from 'lucide-react';
import { START_SPRINT_WORK } from '../graphql/queries';
import { Button, Card, Dialog, IconButton } from './ui';
import { cn } from '../lib/cn';
import { useSprintStart } from '../lib/useSprintStart';
import { HOLD_TEXT, orderText, previewSummary, waitsText, type SprintStart, type SprintStartTicket } from '../lib/sprintStart';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

const TicketLine: React.FC<{ ticket: SprintStartTicket; note?: string; tone?: 'first' | 'blocked' | 'next' }> = ({ ticket, note, tone = 'next' }) => (
  <li className="grid grid-cols-[44px_88px_minmax(0,1fr)_auto] items-baseline gap-x-2 border-b border-border py-2 text-[0.8rem] last:border-b-0 max-[600px]:grid-cols-[40px_minmax(0,1fr)]">
    <span className="font-mono text-[0.72rem] tabular-nums text-muted-foreground">{orderText(ticket)}</span>
    <span className="font-mono font-semibold text-foreground max-[600px]:col-start-2">{ticket.key}</span>
    <span className="min-w-0 truncate text-secondary-foreground max-[600px]:col-span-2">{ticket.title}</span>
    {note && <span className={cn('justify-self-end font-mono text-[0.62rem] max-[600px]:col-span-2 max-[600px]:justify-self-start', tone === 'blocked' ? 'text-status-conflict' : tone === 'first' ? 'text-status-merged' : 'text-muted-foreground')}>{note}</span>}
  </li>
);

/** The confirm with the preview: the slots, the tickets the cron takes first, the blocked ones and the next after the slots. */
export const StartSprintDialog: React.FC<{ open: boolean; view: SprintStart; busy: boolean; error: string | null; onClose: () => void; onConfirm: () => void }> = ({ open, view, busy, error, onClose, onConfirm }) => {
  const { preview } = view;
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} dismissible={!busy} labelledBy="start-sprint-title" describedBy="start-sprint-description">
      <Card className="w-[min(620px,calc(100vw-2rem))] p-0 shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 id="start-sprint-title" className="text-balance font-display text-xl font-bold">Start sprint work</h2>
            <p id="start-sprint-description" className="mt-1 text-pretty text-sm text-muted-foreground">{view.sprint}: from now on the cron takes its To Do tickets. {previewSummary(preview)}.</p>
          </div>
          <IconButton variant="ghost" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} aria-hidden="true" /></IconButton>
        </div>
        <div className="grid max-h-[60dvh] gap-4 overflow-y-auto p-5">
          <section aria-label="Taken first">
            <h3 className={head}>Taken first · {preview.slots} of {preview.parallel} slots free</h3>
            {preview.first.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No slot is free right now: the cron starts the first ticket when one frees up.</p> : <ul className="mt-1">{preview.first.map((ticket) => <TicketLine key={ticket.key} ticket={ticket} note="first" tone="first" />)}</ul>}
          </section>
          {preview.blocked.length > 0 && (
            <section aria-label="Blocked">
              <h3 className={head}>Blocked by another ticket · {preview.blocked.length}</h3>
              <ul className="mt-1">{preview.blocked.map((ticket) => <TicketLine key={ticket.key} ticket={ticket} note={waitsText(ticket)} tone="blocked" />)}</ul>
            </section>
          )}
          {preview.next.length > 0 && (
            <section aria-label="Next">
              <h3 className={head}>Next when a slot frees</h3>
              <ul className="mt-1">{preview.next.map((ticket) => <TicketLine key={ticket.key} ticket={ticket} note="next" />)}</ul>
            </section>
          )}
          {preview.parked.length > 0 && <p className="text-pretty text-[0.8rem] text-muted-foreground">No acceptance criteria, parked for your confirm: {preview.parked.join(', ')}</p>}
          {error && <p className="text-sm text-status-conflict" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}><Play size={14} aria-hidden="true" />{busy ? 'Starting...' : 'Start sprint work'}</Button>
        </div>
      </Card>
    </Dialog>
  );
};

/** The Start sprint work button with its confirm; refetches the start state once started. */
export const StartSprintButton: React.FC<{ view: SprintStart; onStarted: () => void; className?: string }> = ({ view, onStarted, className }) => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [start, starting] = useMutation(START_SPRINT_WORK);
  const confirm = () => {
    setError(null);
    start({ variables: { sprint: view.sprint } })
      .then(() => { setOpen(false); onStarted(); })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'The sprint could not be started'));
  };
  return (
    <>
      <Button variant="primary" className={className} onClick={() => { setError(null); setOpen(true); }}><Play size={14} aria-hidden="true" />Start sprint work</Button>
      <StartSprintDialog open={open} view={view} busy={starting.loading} error={error} onClose={() => setOpen(false)} onConfirm={confirm} />
    </>
  );
};

/** Planning: the chip, the preview summary and the Start button while the cron holds the sprint. */
export const SprintHoldBar: React.FC<{ view: SprintStart | null; onStarted: () => void }> = ({ view, onStarted }) => {
  if (!view?.held) return null;
  return (
    <section aria-label="Sprint start" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-status-warn/50 bg-surface-0 px-4 py-3">
      <span className="inline-flex items-center gap-1.5 rounded-xs border border-status-warn px-2 py-1 font-mono text-[0.66rem] font-bold text-status-warn"><Lock size={12} aria-hidden="true" />{HOLD_TEXT}</span>
      <span className="text-[0.8rem] text-muted-foreground">{previewSummary(view.preview)}</span>
      <StartSprintButton view={view} onStarted={onStarted} className="ml-auto max-[760px]:ml-0" />
    </section>
  );
};

/** Home: "Sprint <name> is ready to start" with the first tickets and the Start button, while the active sprint is held. */
export const SprintStartCard: React.FC<{ className?: string; onNavigate: (path: string) => void }> = ({ className, onNavigate }) => {
  const { view, refetch } = useSprintStart(null);
  if (!view?.held) return null;
  return (
    <article className={cn('min-w-0 rounded-md border border-status-warn/50 bg-surface-0', className)} aria-label="Sprint start">
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-[17px] py-[15px]">
        <h2 className="text-balance font-display text-[0.82rem] font-bold">Sprint {view.sprint} is ready to start</h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-[0.64rem] text-status-warn"><Lock size={11} aria-hidden="true" />{HOLD_TEXT}</span>
      </header>
      <ul className="px-4">{view.preview.first.map((ticket) => <TicketLine key={ticket.key} ticket={ticket} note="first" tone="first" />)}</ul>
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5">
        <span className="text-[0.72rem] text-muted-foreground">{previewSummary(view.preview)}{view.preview.blocked.length ? ` · ${view.preview.blocked.length} blocked` : ''}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onNavigate('/planning?tab=draft&panel=order')}>Open Planning</Button>
        <StartSprintButton view={view} onStarted={() => void refetch()} />
      </div>
    </article>
  );
};
