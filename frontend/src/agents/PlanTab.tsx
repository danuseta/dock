import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Check, RotateCcw, X } from 'lucide-react';
import { Button } from '../components/ui';
import { GET_SPRINT_PLAN, SPRINT_PLAN_EDGE_ACTION, SPRINT_PLAN_MAP } from '../graphql/queries';
import { cn } from '../lib/cn';
import { edgeStateText, groupsText, hasMap, isMapping, mappedText, sourceLabel, type PlanEdge, type SprintPlan } from './plan';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const chip = 'rounded-xs border px-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em]';

const DONE_STATUSES = new Set(['uat merged', 'uat check', 'ready for production', 'rfp', 'done']);

const EdgeRow: React.FC<{ edge: PlanEdge; busy: boolean; onAction: (id: string, action: 'accept' | 'reject') => void }> = ({ edge, busy, onAction }) => (
  <li className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-border py-2 max-[760px]:grid-cols-[minmax(0,1fr)]', edge.state === 'rejected' && 'opacity-70')}>
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-secondary-foreground">
        <span>waits for <span className="font-mono font-semibold text-foreground">{edge.dependsOnKey}</span></span>
        {edge.dependsOnTitle && <span className="min-w-0 truncate text-muted-foreground">{edge.dependsOnTitle}</span>}
        {edge.dependsOnAssignee && <span className="text-muted-foreground">· {edge.dependsOnAssignee}</span>}
        {edge.dependsOnStatus && <span className={cn(chip, DONE_STATUSES.has(edge.dependsOnStatus.toLowerCase()) ? 'border-status-ok text-status-ok' : 'border-border text-secondary-foreground')}>{edge.dependsOnStatus}</span>}
        <span className={cn(chip, edge.source === 'jira' ? 'border-border text-secondary-foreground' : 'border-accent text-accent')}>{sourceLabel(edge.source)}</span>
      </p>
      {edge.reason && <p className="mt-1 text-pretty text-[0.76rem] text-muted-foreground">{edge.reason}</p>}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-1.5 max-[760px]:justify-start">
      {edge.state === 'pending' ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => onAction(edge.id, 'reject')} disabled={busy}><X size={13} aria-hidden="true" />Reject</Button>
          <Button size="sm" variant="primary" onClick={() => onAction(edge.id, 'accept')} disabled={busy}><Check size={13} aria-hidden="true" />Accept</Button>
        </>
      ) : <span className="font-mono text-[0.64rem] text-muted-foreground">{edgeStateText(edge.state)}</span>}
    </div>
  </li>
);

/** The sprint's dependency map: the owner's tickets in work order, what each waits for, and the lead's proposals awaiting Accept or Reject. */
export const PlanTab: React.FC = () => {
  const [notice, setNotice] = useState<string | null>(null);
  const { data, loading, error, refetch } = useQuery<{ sprintPlan: SprintPlan | null }>(GET_SPRINT_PLAN, { fetchPolicy: 'cache-and-network', pollInterval: 15000 });
  const [map, mapping] = useMutation(SPRINT_PLAN_MAP);
  const [act, acting] = useMutation(SPRINT_PLAN_EDGE_ACTION);
  const plan = data?.sprintPlan ?? null;
  const running = isMapping(plan) || mapping.loading;

  const onMap = async () => {
    setNotice(null);
    try {
      await map();
      await refetch();
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'The map could not be started');
    }
  };
  const onAction = (id: string, action: 'accept' | 'reject') => {
    setNotice(null);
    act({ variables: { id, action } }).then(() => refetch()).catch((failure: unknown) => setNotice(failure instanceof Error ? failure.message : 'The change failed'));
  };

  if (error && !data) return <p className="text-sm text-status-conflict" role="alert">{error.message}</p>;
  if (!data && loading) return <p className="text-sm text-muted-foreground" role="status">Loading the plan...</p>;
  if (!plan) return <p className="text-sm text-muted-foreground">No active sprint. The sprint dashboard lists the sprints once Jira is set in Settings.</p>;
  const parallel = groupsText(plan.groups);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-base font-bold">{plan.sprint}</span>
        <span className="text-sm text-muted-foreground">{mappedText(plan.mappedAt, new Date())}</span>
        {running && (
          <span className={cn(chip, 'border-accent text-accent')} role="status">
            Mapping...{plan.sessionId && <> <a className="underline" href={`/sessions?session=${encodeURIComponent(plan.sessionId)}`}>Open session</a></>}
          </span>
        )}
        {plan.status === 'failed' && <span className="text-sm text-status-conflict" role="alert">Failed: {plan.error ?? 'unknown error'}</span>}
        <Button className="ml-auto max-[760px]:ml-0" onClick={() => void onMap()} disabled={running}><RotateCcw size={14} aria-hidden="true" />Map again</Button>
      </div>
      {notice && <p className="text-sm text-secondary-foreground" role="status">{notice}</p>}

      {!hasMap(plan) ? (
        <section className="grid gap-3 border-y border-border py-6" aria-label="No map yet">
          <p className="text-sm text-muted-foreground">No map for {plan.sprint} yet.</p>
          <div><Button variant="primary" onClick={() => void onMap()} disabled={running}>Map now</Button></div>
        </section>
      ) : (
        <section aria-label="Work order">
          <h3 className={head}>Work order</h3>
          <ol className="mt-2">
            {plan.tickets.map((ticket) => (
              <li key={ticket.key} className="border-b border-border py-3 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="w-6 font-mono text-[0.72rem] tabular-nums text-muted-foreground">{ticket.position}</span>
                  <span className="font-mono text-[0.84rem] font-semibold text-foreground">{ticket.key}</span>
                  <span className="min-w-0 flex-1 text-pretty text-[0.84rem] text-secondary-foreground">{ticket.title}</span>
                  <span className="font-mono text-[0.64rem] uppercase tracking-[0.06em] text-muted-foreground">{ticket.status}</span>
                  {ticket.held && <span className={cn(chip, 'border-status-conflict text-status-conflict')}>Held</span>}
                </div>
                {ticket.edges.length > 0 && (
                  <ul className="ml-9 mt-2 max-[760px]:ml-0">
                    {ticket.edges.map((edge) => <EdgeRow key={edge.id} edge={edge} busy={acting.loading} onAction={onAction} />)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {parallel.length > 0 && (
            <p className="mt-3 text-[0.8rem] text-secondary-foreground"><span className={head}>Safe in parallel</span> {parallel.join('  |  ')}</p>
          )}
        </section>
      )}
    </div>
  );
};
