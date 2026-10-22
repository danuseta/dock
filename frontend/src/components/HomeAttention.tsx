import React, { useState } from 'react';
import { useMutation } from '@apollo/client';
import { CHECK_CONFLICTS } from '../graphql/mutations';
import { ConflictModal } from './ConflictModal';
import { Toast } from './Toast';
import { Button } from './ui';
import { cn } from '../lib/cn';
import { QUESTIONS_RANK, signalOf, type SignalGroup, type TicketAttention } from '../lib/attention';

export interface HomeAttentionItem {
  id: string;
  type: string;
  message: string;
  ticketKey?: string | null;
  prUrl?: string | null;
  owner?: string | null;
  repo?: string | null;
  pullNumber?: number | null;
}

interface HomeAttentionProps {
  rows: Array<TicketAttention<HomeAttentionItem>>;
  titleOf: (key: string) => string | null | undefined;
  panelClass: string;
  headerClass: string;
  titleClass: string;
  onTicketClick: (key: string) => void;
  onNavigate: (path: string) => void;
}

const FOLDED = 5;
const FILTERS: Array<{ value: 'all' | SignalGroup; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'answer', label: 'Answer' },
  { value: 'quiet', label: 'Quiet' },
];
const CHIP: Record<SignalGroup, string> = {
  blocked: 'bg-status-conflict-bg text-status-conflict',
  answer: 'bg-status-warn-bg text-status-warn',
  quiet: 'bg-surface-2 text-secondary-foreground',
};
const BAR: Record<SignalGroup, string> = { blocked: 'bg-status-conflict', answer: 'bg-status-warn', quiet: 'bg-muted-foreground' };
const chipClass = 'whitespace-nowrap rounded-xs px-1.5 py-0.5 font-mono text-[0.6rem] font-bold';
const pullUrl = (item: HomeAttentionItem) => item.prUrl || (item.owner && item.repo && item.pullNumber ? `https://github.com/${item.owner}/${item.repo}/pull/${item.pullNumber}` : null);

/** Home's Needs you: one row per ticket with every signal that waits on the owner, worst first. */
export const HomeAttention: React.FC<HomeAttentionProps> = ({ rows, titleOf, panelClass, headerClass, titleClass, onTicketClick, onNavigate }) => {
  const [checkConflicts] = useMutation(CHECK_CONFLICTS);
  const [filter, setFilter] = useState<'all' | SignalGroup>('all');
  const [showAll, setShowAll] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  if (rows.length === 0) {
    return <p className="mb-6 flex items-center gap-2.5 rounded-md border border-status-merged/35 bg-status-merged-bg px-4 py-3 text-[0.8rem] text-status-merged"><span className="size-2 rounded-full bg-status-merged" aria-hidden="true" />All clear: nothing needs you.</p>;
  }

  const inspect = async (item: HomeAttentionItem) => {
    try {
      const res = await checkConflicts({ variables: { owner: item.owner, repo: item.repo, pullNumber: item.pullNumber } });
      if (res.data?.checkConflicts?.hasConflict) setConflict(res.data.checkConflicts.message || 'Merge conflict detected in target branch.');
      else setToast({ message: 'No conflicts detected. Clean merge status.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to inspect conflict details', type: 'error' });
    }
  };

  const shown = rows.filter((row) => filter === 'all' || row.groups.includes(filter));
  const visible = showAll ? shown : shown.slice(0, FOLDED);

  // The main button follows the worst signal; a second one offers the answer or the pull request.
  const actions = (row: TicketAttention<HomeAttentionItem>) => {
    const key = row.ticketKey;
    const top = row.items[0];
    const conflictItem = row.items.find((item) => item.type === 'CONFLICT' && item.owner && item.repo && item.pullNumber);
    const prUrl = row.items.map(pullUrl).find(Boolean);
    const main = conflictItem && top === conflictItem ? 'inspect'
      : row.rank === QUESTIONS_RANK ? 'answer'
      : key && (top?.type === 'AGENT_STALLED' || top?.type === 'AGENT_WAITING') ? 'run'
      : key ? 'ticket' : 'pr';
    const second = row.questions && main !== 'answer' ? 'answer' : prUrl && main !== 'pr' ? 'pr' : null;
    const button = (kind: string, primary: boolean) => {
      const variant = primary ? (kind === 'inspect' ? 'danger' : 'primary') : 'default';
      if (kind === 'inspect' && conflictItem) return <Button key={kind} size="sm" variant={variant} onClick={() => void inspect(conflictItem)}>Inspect file</Button>;
      if (kind === 'answer' && key) return <Button key={kind} size="sm" variant={variant} onClick={() => onNavigate(`/decisions?ticket=${encodeURIComponent(key)}`)}>Answer</Button>;
      if (kind === 'run' && key) return <Button key={kind} size="sm" variant={variant} onClick={() => onNavigate(`/agents?run=${encodeURIComponent(key)}`)}>Open run</Button>;
      if (kind === 'ticket' && key) return <Button key={kind} size="sm" variant={variant} onClick={() => onTicketClick(key)}>Open ticket</Button>;
      if (kind === 'pr' && prUrl) return <Button key={kind} size="sm" variant={variant} onClick={() => window.open(prUrl, '_blank', 'noopener')}>Open PR</Button>;
      return null;
    };
    return [second && button(second, false), button(main, true)];
  };

  return (
    <section className={cn(panelClass, 'mb-6')} aria-label="Needs you">
      <header className={cn(headerClass, 'flex-wrap')}>
        <h2 className={titleClass}>Needs you</h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
          {FILTERS.map((option) => {
            const count = option.value === 'all' ? rows.length : rows.filter((row) => row.groups.includes(option.value as SignalGroup)).length;
            if (option.value !== 'all' && count === 0) return null;
            return <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)} className={cn('min-h-7 rounded-full border px-2.5 text-[0.66rem] max-[760px]:min-h-11', filter === option.value ? 'border-border-glow bg-surface-2 text-foreground' : 'border-border bg-transparent text-secondary-foreground')}>{option.label} <span className="font-mono text-muted-foreground tabular-nums">{count}</span></button>;
          })}
        </div>
      </header>
      {visible.map((row) => {
        const worst = row.items[0] ? signalOf(row.items[0].type) : null;
        const group = row.rank === QUESTIONS_RANK || !worst ? 'answer' : worst.group;
        const title = (row.ticketKey && titleOf(row.ticketKey)) || row.questions?.title || null;
        return (
          <div key={row.id} className="grid grid-cols-[4px_82px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-border py-3 pr-4 last:border-b-0 max-[760px]:grid-cols-[4px_68px_minmax(0,1fr)]">
            <span className={cn('h-full min-h-9 rounded-r-[3px]', BAR[group])} aria-hidden="true" />
            {row.ticketKey ? <button type="button" className="border-0 bg-transparent p-0 text-left font-mono text-[0.69rem] font-bold text-accent hover:underline" onClick={() => onTicketClick(row.ticketKey as string)}>{row.ticketKey}</button> : <span className="font-mono text-[0.69rem] font-bold text-accent">PR</span>}
            <div className="grid min-w-0 gap-1.5">
              {title && <span className="truncate text-[0.84rem] font-medium">{title}</span>}
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {row.items.map((item) => <span key={item.id} className={cn(chipClass, CHIP[signalOf(item.type).group])}>{signalOf(item.type).label}</span>)}
                {row.questions && <span className={cn(chipClass, CHIP.answer)}>{row.questions.count} {row.questions.count === 1 ? 'QUESTION' : 'QUESTIONS'}{row.questions.blocking ? ' · BLOCKING' : ''}</span>}
                {row.items[0] && <span className="min-w-0 truncate text-[0.72rem] text-secondary-foreground" title={row.items.map((item) => item.message).join('\n')}>{row.items[0].message}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 max-[760px]:col-start-2 max-[760px]:col-end-[-1]">{actions(row)}</div>
          </div>
        );
      })}
      {shown.length > FOLDED && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[0.72rem] text-muted-foreground">
          <span>{showAll ? `${shown.length} tickets` : `${shown.length - FOLDED} more`}</span>
          <button type="button" className="min-h-7 border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground max-[760px]:min-h-11" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : 'Show all →'}</button>
        </div>
      )}
      {conflict && <ConflictModal isOpen message={conflict} onClose={() => setConflict(null)} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </section>
  );
};
