import React, { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { X } from 'lucide-react';
import { GET_RUN_THINKING } from '../graphql/queries';
import { cn } from '../lib/cn';
import { ThinkingList } from './ThinkingList';
import { filterRows, isThinking, stopName, type RowFilter, type ThinkingRow } from './thinking';

const FILTERS: Array<[RowFilter, string]> = [['all', 'All'], ['thinking', 'Thinking'], ['events', 'Events']];

interface ThinkingColumnProps {
  runKey: string;
  review: boolean;
  /** The visit picked on the rail; null follows the run as it goes. */
  visit: { stageIndex: number; round: number } | null;
  agent: string | null;
  onClearVisit: () => void;
  onClearAgent: () => void;
  maxHeight: number;
}

/** The right side of Session flow: what each agent asked, decided and did, with the events around it. */
export const ThinkingColumn: React.FC<ThinkingColumnProps> = ({ runKey, review, visit, agent, onClearVisit, onClearAgent, maxHeight }) => {
  const [filter, setFilter] = useState<RowFilter>('all');
  const { data, loading, error } = useQuery<{ runThinking: ThinkingRow[] }>(GET_RUN_THINKING, { variables: { key: runKey }, fetchPolicy: 'cache-and-network', pollInterval: 15000 });
  const all = useMemo(() => data?.runThinking ?? [], [data]);
  const rows = filterRows(all, filter, { stageIndex: visit?.stageIndex, round: visit?.round, agent: agent ?? undefined });
  const thinking = all.filter(isThinking).length;
  const chips = [
    visit && { label: `${stopName(visit.stageIndex, review)} · R${visit.round}`, clear: onClearVisit },
    agent && { label: `only ${agent}`, clear: onClearAgent },
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;
  return (
    <aside style={{ maxHeight }} className="flex min-w-0 flex-col border-l border-border bg-surface-0 max-[1120px]:max-h-none max-[1120px]:border-t max-[1120px]:border-l-0" aria-label="Thinking">
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-4 pt-3 pb-2.5">
        <p className="flex items-baseline gap-2 font-display text-[0.9rem] font-bold">Thinking<span className="font-mono text-[0.66rem] font-medium text-muted-foreground max-[760px]:text-xs">{thinking} thinking · {all.length - thinking} events</span></p>
        <div className="inline-flex rounded-sm border border-border bg-surface-1 p-0.5" role="group" aria-label="Row type">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('h-6 rounded-xs px-2.5 font-display text-[0.68rem] font-semibold text-secondary-foreground max-[760px]:h-11 max-[760px]:text-xs', filter === id && 'bg-accent text-black')}>{label}</button>
          ))}
        </div>
      </header>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-3 px-4 pt-2 font-mono text-[0.68rem] max-[760px]:text-xs">
          {chips.map((chip) => (
            <span key={chip.label} className="inline-flex items-center gap-1 text-foreground">{chip.label}<button type="button" onClick={chip.clear} aria-label={`Clear ${chip.label}`} className="grid place-items-center border-0 bg-transparent p-0.5 text-muted-foreground hover:text-foreground"><X size={12} aria-hidden="true" /></button></span>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {error && !data ? <p className="py-5 text-sm text-status-conflict" role="alert">{error.message}</p>
          : loading && !data ? <p className="py-5 text-sm text-muted-foreground" role="status">Loading...</p>
          : <ThinkingList runKey={runKey} rows={rows} allRows={all} review={review} empty={all.length ? 'Nothing matches.' : 'Nothing recorded yet. Rows appear as the agents decide and act.'} />}
      </div>
    </aside>
  );
};
