import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/cn';
import type { Anchor, ChangesFinding } from './findings';

const SEVERITY: Record<string, string> = {
  blocker: 'border-status-conflict/50 bg-status-conflict-bg',
  'non-blocking': 'border-status-warn/45 bg-status-warn-bg',
  nit: 'border-border bg-surface-1',
};
const CHIP: Record<string, string> = {
  blocker: 'bg-status-conflict/20 text-status-conflict',
  'non-blocking': 'bg-status-warn/20 text-status-warn',
  nit: 'bg-surface-2 text-secondary-foreground',
};

interface FindingCardProps {
  finding: ChangesFinding;
  anchor: Anchor;
  /** Its place among every anchor of the pull request, 1-based, and how many there are. */
  place: number;
  total: number;
  onStep: (delta: number) => void;
}

/** One review finding under its line: blocker red, non-blocking amber, nit grey, resolved green with why. */
export const FindingCard: React.FC<FindingCardProps> = ({ finding, anchor, place, total, onStep }) => {
  const resolved = Boolean(finding.resolvedAt);
  const where = anchor.line !== null ? `line ${anchor.line}` : anchor.named !== null ? `line ${anchor.named}, outside this diff` : null;
  return (
    <div id={`finding-${anchor.finding}-${anchor.part}`} className={cn('scroll-mt-28 rounded-sm border px-3 py-2.5 text-[0.8rem] leading-relaxed', resolved ? 'border-status-merged/45 bg-status-merged-bg' : SEVERITY[finding.severity] ?? SEVERITY.nit)}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-muted-foreground">
        {resolved && <span className="rounded-[3px] bg-status-merged/20 px-1.5 py-px font-mono text-[0.62rem] font-bold uppercase text-status-merged">resolved</span>}
        <span className={cn('rounded-[3px] px-1.5 py-px font-mono text-[0.62rem] font-bold uppercase', resolved ? 'bg-transparent px-0 text-foreground normal-case font-display text-[0.74rem]' : CHIP[finding.severity] ?? CHIP.nit)}>{finding.severity}</span>
        {where && <span>{where}</span>}
        {anchor.parts > 1 && anchor.part > 1 && <span>same finding, {anchor.part} of {anchor.parts}</span>}
        <span className="ml-auto flex items-center gap-1 tabular-nums">
          {place} of {total}
          <button type="button" aria-label="Previous finding" onClick={() => onStep(-1)} className="grid size-6 place-items-center rounded-xs border-0 bg-transparent text-secondary-foreground hover:bg-surface-2 max-[760px]:size-9"><ChevronUp size={13} aria-hidden="true" /></button>
          <button type="button" aria-label="Next finding" onClick={() => onStep(1)} className="grid size-6 place-items-center rounded-xs border-0 bg-transparent text-secondary-foreground hover:bg-surface-2 max-[760px]:size-9"><ChevronDown size={13} aria-hidden="true" /></button>
        </span>
      </p>
      {anchor.part === 1 && <p className="mt-1.5 whitespace-pre-wrap break-words text-secondary-foreground">{finding.text}</p>}
      {anchor.part === 1 && resolved && finding.resolvedWhy && <p className="mt-1.5 text-[0.74rem] text-status-merged">{finding.resolvedWhy}</p>}
    </div>
  );
};
