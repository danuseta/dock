import React, { useState } from 'react';
import { Button } from '../../components/ui';
import { useNow } from '../activity/useNow';
import { MAX_NOTE, countdown, isAnswerable, planAnswer, type ChatInteraction, type PlanDecision, type SettledLine } from './interactions';
import { useAnswer } from './useAnswer';

export const PlanCard: React.FC<{ sessionId: string; interaction: ChatInteraction; planText: string | null; onSettled: (line: SettledLine) => void }> = ({ sessionId, interaction, planText, onSettled }) => {
  const now = useNow(true);
  const { busy, error, submit } = useAnswer(sessionId, interaction, onSettled);
  const [note, setNote] = useState('');
  const open = isAnswerable(interaction, now);
  const left = countdown(interaction.expiresAt, now);
  const send = (decision: PlanDecision) => void submit(planAnswer(decision, note));
  return (
    <section className="flex min-h-0 min-w-0 shrink flex-col rounded-sm border border-border-glow bg-surface-1 p-2.5" aria-label="Plan ready for approval">
      <div className="flex min-w-0 flex-none items-baseline justify-between gap-2">
        <p className="min-w-0 font-display text-xs font-bold" role="alert">Plan ready</p>
        <span className="flex-none font-mono text-[0.66rem] text-muted-foreground tabular-nums">{left.text}</span>
      </div>
      <div className="mt-1.5 min-h-0 overflow-y-auto overscroll-contain" tabIndex={0} role="region" aria-label="The plan">
      {planText
        ? <pre className="whitespace-pre-wrap rounded-xs border border-border bg-surface-0 p-2 font-body text-[0.78rem] [overflow-wrap:anywhere]">{planText}</pre>
        : <p className="text-pretty text-xs text-muted-foreground">The plan is in the message above.</p>}
      <label className="mt-2 block text-[0.7rem] text-muted-foreground">
        Note for Keep planning (optional)
        <input
          type="text"
          className="mt-1 block min-h-11 w-full min-w-0 rounded-sm border border-border bg-surface-0 px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          maxLength={MAX_NOTE}
          value={note}
          disabled={!open || busy}
          placeholder="What should change?"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      </div>
      {error && <p className="mt-1.5 flex-none text-pretty text-xs break-words text-status-conflict" role="alert">{error}</p>}
      <div className="mt-2 flex flex-none flex-wrap gap-2">
        <Button size="sm" variant="default" className="min-h-11 min-w-[6.5rem] flex-1" disabled={!open || busy} onClick={() => send('reject')}>Keep planning</Button>
        <Button size="sm" variant="default" className="min-h-11 min-w-[6.5rem] flex-1" disabled={!open || busy} onClick={() => send('approve_edits')}>Approve and allow edits</Button>
        <Button size="sm" variant="primary" className="min-h-11 min-w-[6.5rem] flex-1" disabled={!open || busy} onClick={() => send('approve')}>Approve</Button>
      </div>
    </section>
  );
};
