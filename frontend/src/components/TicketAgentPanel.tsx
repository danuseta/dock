import React from 'react';
import { useQuery } from '@apollo/client';
import { Bot } from 'lucide-react';
import { GET_ORCHESTRATION } from '../graphql/queries';
import { stageColor, stageLabel, type AgentRun } from '../agents/runs';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { Badge, Card } from './ui';

const acTone = (state: string) => state === 'PASS'
  ? 'border-status-merged bg-status-merged-bg text-status-merged'
  : state === 'FAIL'
    ? 'border-status-conflict bg-status-conflict-bg text-status-conflict'
    : 'border-border-glow text-secondary-foreground';

/** Shown on a ticket only while the orchestrator has a run for it. */
export const TicketAgentPanel: React.FC<{ ticketKey: string }> = ({ ticketKey }) => {
  const { data } = useQuery(GET_ORCHESTRATION, { ...CACHED_QUERY_OPTIONS, variables: { key: ticketKey }, pollInterval: 30000 });
  const run: AgentRun | null | undefined = data?.orchestration;
  if (!run || run.key?.toUpperCase() !== ticketKey.toUpperCase()) return null;

  return (
    <Card className={cn(run.waiting && 'border-amber-300/45')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><Bot size={19} className="text-accent" aria-hidden="true" />Agent run</h2>
        <span className="inline-flex items-center gap-1.5 rounded-xs border border-border-glow px-2 py-0.5 font-mono text-[0.66rem] font-bold text-secondary-foreground">
          <i className="size-1.5 rounded-full" style={{ background: stageColor(run.stage) }} aria-hidden="true" />{stageLabel(run.stage).toUpperCase()}
        </span>
      </div>

      {run.waiting && (
        <div className="mb-3 rounded-sm border border-amber-300/50 bg-amber-300/10 px-3 py-2.5 text-sm">
          <b className="mb-0.5 block font-mono text-[0.66rem] font-bold uppercase tracking-[0.08em] text-amber-200">Waiting on you</b>
          <span className="text-pretty">{run.waiting}</span>
        </div>
      )}

      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[0.68rem] font-extrabold text-muted-foreground uppercase">Acceptance criteria</span>
        <Badge variant={run.acFailed > 0 ? 'danger' : run.acTotal > 0 && run.acPassed === run.acTotal ? 'success' : 'neutral'}>{run.acPassed}/{run.acTotal}</Badge>
      </div>
      {(run.ac || []).length === 0 && <p className="text-sm text-muted-foreground">No acceptance criteria recorded yet.</p>}
      {(run.ac || []).map((item) => (
        <div className="grid grid-cols-[46px_1fr] gap-[9px] border-b border-border py-1.5 text-[0.82rem] last:border-b-0" key={item.n}>
          <span className={cn('h-fit rounded-xs border py-0.5 text-center font-mono text-[0.62rem] font-extrabold', acTone(item.state))}>{item.state}</span>
          <span className="min-w-0 text-pretty">{item.text || `AC ${item.n}`}</span>
        </div>
      ))}

      {(run.testsBe || run.testsFe) && (
        <dl className="mt-3 grid grid-cols-[72px_1fr] gap-x-2.5 gap-y-1 border-t border-border pt-3 text-[0.82rem]">
          {run.testsBe && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Tests BE</dt><dd className="break-words">{run.testsBe}</dd></>}
          {run.testsFe && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Tests FE</dt><dd className="break-words">{run.testsFe}</dd></>}
        </dl>
      )}
    </Card>
  );
};
