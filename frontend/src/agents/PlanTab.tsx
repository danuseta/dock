import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowRightLeft, Check, Clock, EyeOff, Flag, ListOrdered, RotateCcw, Undo2, X } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { AC_IN_ACTION, GET_AC_INCOMING, GET_SPRINT_DRIFT, GET_SPRINT_PLAN, SPRINT_DRIFT_ACTION, SPRINT_PLAN_EDGE_ACTION, SPRINT_PLAN_MAP } from '../graphql/queries';
import { SET_TICKET_WORK_ORDER } from '../graphql/mutations';
import { cn } from '../lib/cn';
import { InfoTip } from './InfoTip';
import {
  driftReason, driftStateLabel, edgeStateText, groupsText, hasMap, isMapping, mappedText, orderSourceLabel, sortDrift, sourceLabel, suggestionDiffers,
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
            <Button size="sm" onClick={() => onAction(row.id, 'not-tested')} disabled={busy}><EyeOff size={13} aria-hidden="true" />Move to Reference</Button>
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
      <h3 className={head}>AC from teammates <InfoTip label="About AC from teammates">Accept also tells the sender's DOCK to remove the line from their ticket. Decline sends it back as Held with your reason.</InfoTip></h3>
      {notice && <p className="mt-2 text-sm text-status-conflict" role="alert">{notice}</p>}
      <p className="mt-1 text-pretty text-[0.8rem] text-muted-foreground">Accept = goes into your AC. Decline = goes back to them.</p>
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
      <h3 className={head}>
        Your AC waiting on other tickets {drift.today ? <span className="font-medium normal-case tracking-normal">· day {drift.today}</span> : null}
        <InfoTip label="About AC waiting on other tickets">Move and Move to Reference only write to your own ticket, after the AC is read again. Move to Reference = the line leaves the AC for the Reference field, with no Jira comment. A line for a teammate's ticket waits for them, with the ac-move-pending label.</InfoTip>
      </h3>
      {notice && <p className="mt-2 text-sm text-status-conflict" role="alert">{notice}</p>}
      {drift.rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Every AC line of your tickets has what it needs landed or planned before it.</p> : (
        <>
          <p className="mt-1 text-pretty text-[0.8rem] text-muted-foreground">Your AC lines whose supporting ticket is not ready. <b className="text-foreground">{held} held.</b></p>
          <ul className="mt-2 rounded-md border border-border bg-surface-0">{sortDrift(drift.rows).map((row) => <DriftLine key={row.id} row={row} busy={acting.loading} onAction={onAction} />)}</ul>
        </>
      )}
    </section>
  );
};

/** The Plan agent's suggested order next to the work order the cron follows; Use this order writes it as the owner's order. */
const SuggestedOrder: React.FC<{ plan: SprintPlan; busy: boolean; onUse: () => void }> = ({ plan, busy, onUse }) => {
  const titleOf = new Map(plan.tickets.map((ticket) => [ticket.key, ticket.title]));
  const differs = suggestionDiffers(plan);
  return (
    <section aria-label="Suggested order" className="min-w-0 rounded-md border border-dashed border-accent/60 bg-surface-0 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className={head}>Suggested by Map dependencies</h3>
        <span className="text-[0.78rem] text-muted-foreground">{differs ? 'Nothing changes until you use it.' : 'Same as the work order now.'}</span>
        <Button size="sm" variant="primary" className="ml-auto max-[760px]:ml-0" onClick={onUse} disabled={busy || !differs}><ListOrdered size={13} aria-hidden="true" />{busy ? 'Saving...' : 'Use this order'}</Button>
      </div>
      <ol className="mt-2 grid gap-0.5">
        {plan.suggestedOrder.map((key, index) => (
          <li key={key} className="flex items-baseline gap-3 text-[0.8rem]">
            <span className="w-6 font-mono text-[0.72rem] tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="font-mono font-semibold">{key}</span>
            <span className="min-w-0 flex-1 truncate text-secondary-foreground">{titleOf.get(key) ?? ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
};

/** The sprint's work order (yours, else Jira #N), what each ticket waits for, the lead's proposals awaiting Accept or Reject, and the order Map dependencies suggests. */
export const PlanTab: React.FC = () => {
  const [notice, setNotice] = useState<string | null>(null);
  const { data, loading, error, refetch } = useQuery<{ sprintPlan: SprintPlan | null }>(GET_SPRINT_PLAN, { fetchPolicy: 'cache-and-network', pollInterval: 15000 });
  const [map, mapping] = useMutation(SPRINT_PLAN_MAP);
  const [act, acting] = useMutation(SPRINT_PLAN_EDGE_ACTION);
  const [setOrder] = useMutation(SET_TICKET_WORK_ORDER);
  const [using, setUsing] = useState(false);
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
  const onUseSuggestion = async (keys: string[]) => {
    setNotice(null);
    setUsing(true);
    try {
      for (const [index, ticketKey] of keys.entries()) await setOrder({ variables: { ticketKey, position: index + 1 } });
      await refetch();
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'The order could not be saved');
    } finally {
      setUsing(false);
    }
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
        <Button className="ml-auto max-[760px]:ml-0" onClick={() => void onMap()} disabled={running}><RotateCcw size={14} aria-hidden="true" />Map dependencies</Button>
      </div>
      {notice && <p className="text-sm text-secondary-foreground" role="status">{notice}</p>}
      {!hasMap(plan) && <p className="text-pretty text-sm text-muted-foreground">No dependency map for {plan.sprint} yet. Map dependencies is optional: its order is only a suggestion.</p>}
      {plan.suggestedOrder.length > 0 && <SuggestedOrder plan={plan} busy={using} onUse={() => void onUseSuggestion(plan.suggestedOrder)} />}

      {plan.tickets.length > 0 && (
        <section aria-label="Work order">
          <h3 className={head}>Work order <span className="font-medium normal-case tracking-normal">· yours where you set it, else Jira #N, else the ticket number</span></h3>
          <ol className="mt-2">
            {plan.tickets.map((ticket) => (
              <li key={ticket.key} className="border-b border-border py-3 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="w-6 font-mono text-[0.72rem] tabular-nums text-muted-foreground">{ticket.position}</span>
                  <span className="font-mono text-[0.84rem] font-semibold text-foreground">{ticket.key}</span>
                  <span className="min-w-0 flex-1 text-pretty text-[0.84rem] text-secondary-foreground">{ticket.title}</span>
                  {orderSourceLabel(ticket) && <span className={cn(chip, ticket.orderSource === 'owner' ? 'border-accent text-accent' : 'border-border text-secondary-foreground')}>{orderSourceLabel(ticket)}</span>}
                  {ticket.suggestedPosition != null && <span className="font-mono text-[0.64rem] text-muted-foreground">suggested {ticket.suggestedPosition}</span>}
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
