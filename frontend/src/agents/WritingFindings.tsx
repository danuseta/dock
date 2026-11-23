import React, { useState } from 'react';
import { Flag, Send, X } from 'lucide-react';
import { Button, Textarea } from '../components/ui';
import { cn } from '../lib/cn';
import { FLAG_REASON_MAX, FLAG_REASON_MIN, WRITING_FLAG_LABEL, blocksOf, findingsOf, flagReasonValid, type LintFinding, type TicketLint } from '../lib/writing';

const tone = (level: LintFinding['level']) => (level === 'block'
  ? 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict'
  : 'border-status-warn/50 bg-status-warn-bg text-[var(--color-status-warn-ink)]');

/** The findings of one field of a ticket: red for a block, amber for a note, each with what to do. */
export const Findings: React.FC<{ lint: TicketLint | null | undefined; field: string }> = ({ lint, field }) => {
  const items = findingsOf(lint, field);
  if (!items.length) return null;
  return (
    <ul aria-label={`Writing findings of ${field}`} className="grid min-w-0 gap-1">
      {items.map((item, index) => (
        <li key={`${item.rule}-${item.line ?? 0}-${index}`} className={cn('min-w-0 text-pretty rounded-xs border px-2 py-1 text-[0.74rem] [overflow-wrap:anywhere]', tone(item.level))} title={item.fix}>
          <b className="mr-1.5 font-mono text-[0.66rem]">{item.rule}</b>{item.text}<span className="ml-1.5 opacity-80">{item.fix}</span>
        </li>
      ))}
    </ul>
  );
};

/** A one-line count of the findings, for the card header. */
export const FindingsChip: React.FC<{ lint: TicketLint | null | undefined }> = ({ lint }) => {
  const count = lint?.findings.length ?? 0;
  if (!count) return null;
  const blocked = blocksOf(lint).length;
  return (
    <span className={cn('inline-flex items-center rounded-pill border px-2 font-mono text-[0.64rem]', blocked ? 'border-status-conflict/60 text-status-conflict' : 'border-status-warn/60 text-[var(--color-status-warn-ink)]')}>
      {blocked ? `${blocked} blocking` : `${count} ${count === 1 ? 'note' : 'notes'}`}
    </span>
  );
};

/** Asks for the reason a ticket below the writing standard is let in; the ticket gets the WRITING-FLAG label. */
export const FlagBox: React.FC<{
  title: string; lint: TicketLint[]; action: string; busy: boolean; onConfirm: (reason: string) => void; onCancel: () => void;
}> = ({ title, lint, action, busy, onConfirm, onCancel }) => {
  const [reason, setReason] = useState('');
  const valid = flagReasonValid(reason);
  const blocks = lint.flatMap((item) => blocksOf(item));
  return (
    <div role="alertdialog" aria-label={title} className="rounded-md border border-status-warn bg-background px-3 py-3 text-[0.8rem]">
      <p className="flex items-center gap-1.5 font-display text-sm font-semibold"><Flag size={14} aria-hidden="true" />{title}</p>
      <p className="mt-1.5 text-pretty text-secondary-foreground">Below the writing standard: {blocks.map((item) => item.text).join(' ')} It goes in with the <b className="font-mono text-foreground">{WRITING_FLAG_LABEL}</b> label and your reason.</p>
      <label className="mt-2 grid gap-1">
        <span className="block font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">Reason · {FLAG_REASON_MIN} to {FLAG_REASON_MAX} characters</span>
        <Textarea aria-label="Flag reason" className="min-h-16" maxLength={FLAG_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
      </label>
      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}><X size={13} aria-hidden="true" />Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => onConfirm(reason.trim())} disabled={busy || !valid}><Send size={13} aria-hidden="true" />{busy ? 'Working...' : action}</Button>
      </div>
    </div>
  );
};
