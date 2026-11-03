import React from 'react';
import { Check } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { canLgtm, type AgentRun } from './runs';

/** LGTM on a review whose verdict is approve; "Approved" once DOCK labelled the ticket and approved its PRs. */
export const LgtmButton: React.FC<{ run: AgentRun; busy: boolean; onLgtm: (run: AgentRun) => void; className?: string }> = ({ run, busy, onLgtm, className }) => {
  if (run.kind === 'review' && run.approved) return <span className="inline-flex items-center gap-1 font-mono text-[0.68rem] font-semibold text-status-merged"><Check size={12} aria-hidden="true" />Approved</span>;
  if (!canLgtm(run)) return null;
  return (
    <Button size="sm" variant="primary" className={cn('h-7 px-2.5 max-[760px]:h-11', className)} disabled={busy} title="Adds your Jira Pass label to the reviewed ticket and approves its pull requests on GitHub" onClick={(event) => { event.stopPropagation(); onLgtm(run); }}>
      <Check size={13} aria-hidden="true" />LGTM
    </Button>
  );
};
