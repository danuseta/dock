import React from 'react';
import { PenLine } from 'lucide-react';
import { cn } from '../../lib/cn';
import { lintMark, lintTip, type TicketLint } from '../../lib/writing';

/** A small mark on a card whose ticket has findings: red when one blocks, amber when only notes are left; the tooltip lists them. */
export const WritingMark: React.FC<{ lint: TicketLint | null | undefined }> = ({ lint }) => {
  const mark = lintMark(lint);
  if (!mark) return null;
  return (
    <span
      className={cn('inline-flex w-fit items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[0.68rem] font-bold', mark === 'block' ? 'bg-status-conflict-bg text-status-conflict' : 'bg-status-warn-bg text-status-warn')}
      title={lintTip(lint)} aria-label={mark === 'block' ? 'Below the writing standard' : 'Writing notes'}
    >
      <PenLine size={11} aria-hidden="true" />{mark === 'block' ? 'Writing: blocked' : 'Writing: notes'}
    </span>
  );
};
