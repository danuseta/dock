import React, { useState } from 'react';
import type { AgentRun } from './runs';
import { DECISION_LABEL, DECISION_TONE, canCancel, reportAge, reportDecisions } from '../lib/sousReport';
import { Badge, Button, Input } from '../components/ui';

/** Decisions past this many start folded. */
const SHOWN = 3;

interface RunDecisionsProps {
  run: AgentRun;
  /** Each cancel starts a new sous session on the ticket's machine; rejects with the reason when it cannot. */
  onCancel: (decision: number, note: string) => Promise<void>;
  busy: boolean;
  /** Why this DOCK cannot cancel; hides the cancel controls. */
  readOnly?: string | null;
}

const CancelForm: React.FC<{ n: number; busy: boolean; onCancel: RunDecisionsProps['onCancel']; onClose: () => void }> = ({ n, busy, onCancel, onClose }) => {
  const [note, setNote] = useState('');
  return (
    <form className="flex basis-full flex-wrap items-center gap-2 pt-1" onSubmit={(event) => { event.preventDefault(); if (note.trim()) void onCancel(n, note.trim()).then(onClose, () => undefined); }}>
      <Input autoFocus className="h-8 min-w-0 flex-1 text-sm max-[760px]:h-11" value={note} placeholder="Why, for the agent..." aria-label={`Reason to cancel D-${n}`} disabled={busy} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} />
      <Button size="sm" variant="danger" type="submit" disabled={busy || !note.trim()}>Cancel D-{n}</Button>
      <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Keep</Button>
    </form>
  );
};

/** Every decision on the run, newest first: who took it, which question it answers, and Cancel for what the agent decided alone. */
export const RunDecisions: React.FC<RunDecisionsProps> = ({ run, onCancel, busy, readOnly }) => {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const decisions = reportDecisions(run);
  const superseded = decisions.filter((decision) => decision.status === 'SUPERSEDED').length;
  const cancelled = decisions.filter((decision) => decision.status === 'CANCELLED').length;
  const folded = [superseded && `${superseded} superseded`, cancelled && `${cancelled} cancelled`].filter(Boolean).join(', ');
  return (
    <div>
      <p className="mb-1 font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Decisions{decisions.length > 0 && ` · ${decisions.length}`}</p>
      {decisions.length === 0 && <p className="text-sm text-muted-foreground">None recorded yet.</p>}
      <ol className="flex flex-col">
        {(open ? decisions : decisions.slice(0, SHOWN)).map((decision) => {
          const status = decision.status ?? 'DECIDED';
          // An entry that does not say who decided is not claimed for the owner.
          const recorded = status === 'DECIDED' && !decision.by;
          return (
            <li key={decision.n} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border py-1.5 text-[0.82rem] last:border-b-0">
              <span className="font-mono text-[0.68rem] font-bold text-muted-foreground">D-{decision.n}</span>
              <Badge variant={recorded ? 'neutral' : DECISION_TONE[status] ?? 'neutral'} className="text-[0.62rem]" title={`Ledger status ${status}`}>{recorded ? 'Recorded' : DECISION_LABEL[status] ?? status}</Badge>
              <span className="font-mono text-[0.68rem] text-muted-foreground">{[decision.by && `by ${decision.by}`, decision.issue && `answers I-${decision.issue}`, decision.at && reportAge(decision.at)].filter(Boolean).join(' · ')}</span>
              <span className="basis-full text-pretty text-foreground">{decision.text}</span>
              {decision.status === 'CANCELLED' && decision.cancelNote && <span className="basis-full text-pretty text-xs text-status-conflict">Cancelled: {decision.cancelNote}</span>}
              {!readOnly && canCancel(decision) && cancelling !== decision.n && (
                <button type="button" className="text-sm font-semibold text-status-conflict hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 max-[760px]:min-h-11" disabled={busy} onClick={() => setCancelling(decision.n)}>Cancel</button>
              )}
              {cancelling === decision.n && <CancelForm n={decision.n} busy={busy} onCancel={onCancel} onClose={() => setCancelling(null)} />}
            </li>
          );
        })}
      </ol>
      {decisions.length > SHOWN && (
        <button type="button" className="mt-1 text-xs font-semibold text-accent hover:underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? 'Show less' : `Show all ${decisions.length}${folded ? ` · ${folded}` : ''}`}
        </button>
      )}
    </div>
  );
};
