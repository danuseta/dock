import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowRightLeft, Check, Clock, EyeOff, Flag, RotateCcw, Undo2, X } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { AC_IN_ACTION, GET_AC_INCOMING, GET_SPRINT_DRIFT, GET_SPRINT_PLAN, SPRINT_DRIFT_ACTION, SPRINT_PLAN_EDGE_ACTION, SPRINT_PLAN_MAP } from '../graphql/queries';
import { cn } from '../lib/cn';
import {
  driftReason, driftStateLabel, edgeStateText, groupsText, hasMap, isMapping, mappedText, sortDrift, sourceLabel,
  type AcIn, type DriftRow, type PlanEdge, type SprintDrift, type SprintPlan,
} from './plan';

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

const DriftLine: React.FC<{ row: DriftRow; busy: boolean; onAction: (id: string, action: string) => void }> = ({ row, busy, onAction }) => {
  const held = row.state === 'held';
  return (
    <li className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border py-2.5 pl-3 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]', held ? 'border-l-2 border-l-status-warn' : 'opacity-80')}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-secondary-foreground">
          <span className="font-mono font-semibold text-foreground">{row.key}</span>
          <span className={cn(chip, 'border-status-warn text-status-warn')}>AC {row.line}</span>
          <span>needs <span className="font-mono font-semibold text-foreground">{row.refKey}</span>{row.refDev ? ` · ${row.refDev}` : ''}</span>
          <span className={cn(chip, held ? 'border-status-conflict text-status-conflict' : 'border-border text-secondary-foreground')}>{driftStateLabel(row.state)}</span>
        </p>
        <p className="mt-1 text-pretty text-[0.78rem] text-foreground">{row.text}</p>
        <p className="mt-1 text-pretty text-[0.74rem] text-muted-foreground">{driftReason(row)}{row.decision?.by ? ` · ${driftStateLabel(row.decision.state)} by ${row.decision.by}` : ''}</p>
      </div>
      <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
        {held || row.state === 'wait' ? (
          <>
            {held && <Button size="sm" variant="ghost" onClick={() => onAction(row.id, 'wait')} disabled={busy}><Clock size={13} aria-hidden="true" />Wait</Button>}
            {row.state === 'wait' && <Button size="sm" variant="ghost" onClick={() => onAction(row.id, 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>}
            <Button size="sm" variant="ghost" onClick={() => onAction(row.id, 'needs-po')} disabled={busy}><Flag size={13} aria-hidden="true" />Needs PO</Button>
            <Button size="sm" onClick={() => onAction(row.id, 'not-tested')} disabled={busy}><EyeOff size={13} aria-hidden="true" />Pindah ke Reference</Button>
            <Button size="sm" variant="primary" onClick={() => onAction(row.id, 'move')} disabled={busy}><ArrowRightLeft size={13} aria-hidden="true" />Move to {row.refKey}{row.refDev ? ` (${row.refDev})` : ''}</Button>
          </>
        ) : <Button size="sm" variant="ghost" onClick={() => onAction(row.id, 'clear')} disabled={busy} title="Forget the call here; what was written to Jira stays"><Undo2 size={13} aria-hidden="true" />Undo</Button>}
      </div>
    </li>
  );
};

const AcInLine: React.FC<{ row: AcIn; busy: boolean; onAction: (row: AcIn, action: 'accept' | 'decline', reason?: string) => void }> = ({ row, busy, onAction }) => {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border border-l-2 border-l-accent py-2.5 pl-3 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-secondary-foreground">
          <span className="font-mono font-semibold text-foreground">{row.to}</span>
          <span className={cn(chip, 'border-accent text-accent')}>AC in</span>
          <span>moved from <span className="font-mono font-semibold text-foreground">{row.from}</span> AC {row.line}{row.by ? ` · ${row.by}` : ''}</span>
        </p>
        <p className="mt-1 text-pretty text-[0.78rem] text-foreground">{row.text}</p>
        {declining && (
          <form className="mt-2 flex gap-2 max-[760px]:flex-col" onSubmit={(event) => { event.preventDefault(); onAction(row, 'decline', reason); setDeclining(false); }}>
            <Input aria-label={`Why ${row.to} declines the line`} className="h-9" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why it does not belong here" autoFocus />
            <Button size="sm" type="submit" disabled={busy || !reason.trim()}>Send</Button>
          </form>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
        <Button size="sm" variant="ghost" onClick={() => setDeclining(!declining)} disabled={busy}><X size={13} aria-hidden="true" />Decline</Button>
        <Button size="sm" variant="primary" onClick={() => onAction(row, 'accept')} disabled={busy}><Check size={13} aria-hidden="true" />Accept into AC</Button>
      </div>
    </li>
  );
};

/** AC lines teammates move to the owner's tickets: accept writes the line into the AC, decline sends it back with a reason. */
const AcInSection: React.FC = () => {
  const [notice, setNotice] = useState<string | null>(null);
  const { data, refetch } = useQuery<{ acIncoming: AcIn[] }>(GET_AC_INCOMING, { fetchPolicy: 'cache-and-network', pollInterval: 60000 });
  const [act, acting] = useMutation(AC_IN_ACTION);
  const rows = data?.acIncoming ?? [];
  if (!rows.length && !notice) return null;
  const onAction = (row: AcIn, action: 'accept' | 'decline', reason?: string) => {
    setNotice(null);
    act({ variables: { to: row.to, id: row.id, action, reason: reason ?? null } }).then(() => refetch()).catch((failure: unknown) => setNotice(failure instanceof Error ? failure.message : 'The answer failed'));
  };
  return (
    <section aria-label="AC in" className="min-w-0">
      <h3 className={head}>AC in · from teammates</h3>
      {notice && <p className="mt-2 text-sm text-status-conflict" role="alert">{notice}</p>}
      <p className="mt-2 text-pretty text-[0.8rem] text-muted-foreground">Accept writes the line into your ticket's AC and tells the sender's DOCK, which removes it from theirs. Decline sends it back to them as Held, with your reason.</p>
      <ul className="mt-2 rounded-md border border-border bg-surface-0">{rows.map((row) => <AcInLine key={`${row.to}|${row.id}`} row={row} busy={acting.loading} onAction={onAction} />)}</ul>
    </section>
  );
};

/** The owner's AC lines of the published plan that need a ticket which has not landed. */
const DriftSection: React.FC = () => {
  const [notice, setNotice] = useState<string | null>(null);
  const { data, refetch } = useQuery<{ sprintDrift: SprintDrift | null }>(GET_SPRINT_DRIFT, { fetchPolicy: 'cache-and-network', pollInterval: 60000 });
  const [act, acting] = useMutation(SPRINT_DRIFT_ACTION);
  const drift = data?.sprintDrift ?? null;
  if (!drift) return null;
  const onAction = (id: string, action: string) => {
    setNotice(null);
    act({ variables: { id, action } }).then(() => refetch()).catch((failure: unknown) => setNotice(failure instanceof Error ? failure.message : 'The change failed'));
  };
  const held = drift.rows.filter((row) => row.state === 'held').length;
  const storyboard = drift.storyboard.filter((item) => !item.checked);
  return (
    <section aria-label="AC drift" className="min-w-0">
      {storyboard.length > 0 && (
        <ul className="mb-4 rounded-md border border-border bg-surface-0">
          {storyboard.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border border-l-2 border-l-status-warn px-3 py-2 text-[0.8rem] last:border-b-0">
              <span className="font-mono font-semibold">{item.key}</span>
              <span className={cn(chip, item.held ? 'border-status-conflict text-status-conflict' : 'border-status-warn text-status-warn')}>{item.held ? 'Held · AC needs a check' : 'AC needs a check'}</span>
              <span className="text-muted-foreground">storyboard v{item.version} changed {item.frames.join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className={head}>AC drift · your tickets {drift.today ? <span className="font-medium normal-case tracking-normal">· sprint day {drift.today}</span> : null}</h3>
      {notice && <p className="mt-2 text-sm text-status-conflict" role="alert">{notice}</p>}
      {drift.rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Every AC line of your tickets has what it needs landed or planned before it.</p> : (
        <>
          <p className="mt-2 text-pretty text-[0.8rem] text-muted-foreground">{held} held. Move and Pindah ke Reference (not tested here: the line leaves AC for the Reference field, no Jira comment) write to Jira only on your own tickets, after reading the AC again; a line for a teammate's ticket waits for them under the label ac-move-pending.</p>
          <ul className="mt-2 rounded-md border border-border bg-surface-0">{sortDrift(drift.rows).map((row) => <DriftLine key={row.id} row={row} busy={acting.loading} onAction={onAction} />)}</ul>
        </>
      )}
    </section>
  );
};

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
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
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
      <AcInSection />
      <DriftSection />
    </div>
  );
};
