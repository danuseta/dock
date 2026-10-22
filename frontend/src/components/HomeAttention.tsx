import React, { useState } from 'react';
import { useMutation } from '@apollo/client';
import { CHECK_CONFLICTS } from '../graphql/mutations';
import { ConflictModal } from './ConflictModal';
import { Toast } from './Toast';
import { Button } from './ui';
import { questionsOf } from '../decisions/questions';
import type { AgentRun } from '../agents/runs';

export interface HomeAttentionItem {
  id: string;
  type: string;
  message: string;
  ticketKey?: string | null;
  owner?: string | null;
  repo?: string | null;
  pullNumber?: number | null;
}

interface HomeAttentionProps {
  items: HomeAttentionItem[];
  runs: Array<Pick<AgentRun, 'key' | 'kind' | 'title' | 'issues' | 'decisions' | 'confirmedDecisions'>>;
  panelClass: string;
  headerClass: string;
  titleClass: string;
  actionClass: string;
  onTicketClick: (key: string) => void;
  onNavigate: (path: string) => void;
}

/** Home's two short lists: pull request and agent problems, and the tickets whose questions wait on the owner. */
export const HomeAttention: React.FC<HomeAttentionProps> = ({ items, runs, panelClass, headerClass, titleClass, actionClass, onTicketClick, onNavigate }) => {
  const [checkConflicts] = useMutation(CHECK_CONFLICTS);
  const [conflict, setConflict] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const asking = runs.map((run) => ({ run, questions: questionsOf(run) })).filter((item) => item.questions.length > 0);

  const inspect = async (item: HomeAttentionItem) => {
    if (item.type !== 'CONFLICT' || !item.owner || !item.repo || !item.pullNumber) {
      if (item.ticketKey) onTicketClick(item.ticketKey);
      return;
    }
    try {
      const res = await checkConflicts({ variables: { owner: item.owner, repo: item.repo, pullNumber: item.pullNumber } });
      if (res.data?.checkConflicts?.hasConflict) setConflict(res.data.checkConflicts.message || 'Merge conflict detected in target branch.');
      else setToast({ message: 'No conflicts detected. Clean merge status.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to inspect conflict details', type: 'error' });
    }
  };

  return (
    <section className="mb-6 grid grid-cols-2 gap-3.5 max-[900px]:grid-cols-1" aria-label="Needs attention and decisions">
      <article className={panelClass}>
        <header className={headerClass}><h2 className={titleClass}>Needs attention</h2><span className="font-mono text-[0.68rem] text-muted-foreground tabular-nums">{items.length}</span></header>
        {items.length === 0 && <p className="px-[17px] py-4 text-[0.78rem] text-muted-foreground">All clear: no merge conflicts, failing checks or stuck agents.</p>}
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 border-b border-border px-[17px] py-2.5 last:border-b-0">
            <span className="w-[82px] flex-none font-mono text-[0.69rem] font-bold text-accent">{item.ticketKey || 'PR'}</span>
            <span className="min-w-0 flex-1 truncate text-[0.8rem]" title={item.message}>{item.message}</span>
            {(item.ticketKey || item.type === 'CONFLICT') && <Button variant="ghost" size="sm" className={actionClass} onClick={() => void inspect(item)}>Inspect</Button>}
          </div>
        ))}
      </article>
      <article className={panelClass}>
        <header className={headerClass}><h2 className={titleClass}>Decisions</h2><Button variant="ghost" size="sm" className={actionClass} onClick={() => onNavigate('/decisions')}>Open →</Button></header>
        {asking.length === 0 && <p className="px-[17px] py-4 text-[0.78rem] text-muted-foreground">Sous has nothing to ask.</p>}
        {asking.map(({ run, questions }) => (
          <button key={run.key} type="button" className="flex w-full items-center gap-2.5 border-0 border-b border-border bg-transparent px-[17px] py-2.5 text-left text-foreground transition-colors duration-150 ease-out last:border-b-0 hover:bg-surface-1" onClick={() => onNavigate(`/decisions?ticket=${encodeURIComponent(run.key)}`)}>
            <span className="w-[82px] flex-none font-mono text-[0.69rem] font-bold text-accent">{run.key}</span>
            <span className="min-w-0 flex-1 truncate text-[0.8rem]">{run.title || 'Untitled'}</span>
            <span className="flex-none text-[0.68rem] text-muted-foreground">{questions.length} open</span>
            {questions.some((question) => question.blocking) && <span className="size-1.5 flex-none rounded-full bg-amber-300" title="Sous waits on an answer" aria-label="Sous waits on an answer" />}
          </button>
        ))}
      </article>
      {conflict && <ConflictModal isOpen message={conflict} onClose={() => setConflict(null)} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </section>
  );
};
