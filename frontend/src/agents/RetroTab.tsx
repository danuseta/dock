import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Check, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button, Select, Textarea } from '../components/ui';
import { GET_RETRO, GET_SPRINT_LIST, RETRO_BUILD, RETRO_ITEM_ACTION } from '../graphql/queries';
import { cn } from '../lib/cn';
import { RETRO_NUMBERS, numberDelta, type Retro, type RetroItem } from './retro';

const KIND_LABEL: Record<string, string> = { keep: 'Keep', problem: 'Problem', try: 'Try' };
const DEST_LABEL: Record<string, string> = { kit: 'kit PR', memory: 'memory', dock: 'DOCK issue', note: 'note only' };
const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

const Line: React.FC<{ item: RetroItem; onAction: (id: string, action: string, text?: string) => Promise<void>; busy: boolean }> = ({ item, onAction, busy }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const done = item.status !== 'open';
  return (
    <li className={cn('grid grid-cols-[72px_minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]', done && 'opacity-70')}>
      <span className="pt-0.5 font-mono text-[0.66rem] font-bold uppercase tracking-[0.08em] text-secondary-foreground">{KIND_LABEL[item.kind] ?? item.kind}</span>
      <div className="min-w-0">
        {editing
          ? <Textarea aria-label="Edit the line" className="min-h-[72px] text-sm" value={text} onChange={(event) => setText(event.target.value)} />
          : <p className="text-pretty text-[0.84rem] text-foreground">{item.text}</p>}
        <p className="mt-1 text-[0.72rem] text-muted-foreground">{item.evidence.join(' · ')}</p>
        <p className="mt-1 font-mono text-[0.64rem] text-muted-foreground">
          goes to {DEST_LABEL[item.dest] ?? item.dest}
          {item.status === 'accepted' && <span className="text-status-merged"> · accepted{item.sessionId ? ', sous is applying it' : ''}</span>}
          {item.status === 'closed' && <span> · closed</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
        {editing ? (
          <>
            <Button size="sm" onClick={() => { setEditing(false); setText(item.text); }} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={busy || !text.trim() || text === item.text} onClick={() => void onAction(item.id, 'edit', text).then(() => setEditing(false))}>Save</Button>
          </>
        ) : done ? (
          <Button size="sm" variant="ghost" onClick={() => void onAction(item.id, 'reopen')} disabled={busy || item.status === 'accepted'}><RotateCcw size={13} aria-hidden="true" />Reopen</Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}><Pencil size={13} aria-hidden="true" />Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => void onAction(item.id, 'close')} disabled={busy}><X size={13} aria-hidden="true" />Close</Button>
            <Button size="sm" variant="primary" onClick={() => void onAction(item.id, 'accept')} disabled={busy}><Check size={13} aria-hidden="true" />Accept</Button>
          </>
        )}
      </div>
    </li>
  );
};

/** A sprint's retro of the agents' work: numbers against the sprint before, what recurred, each ticket, and sous's Keep / Problem / Try. */
export const RetroTab: React.FC = () => {
  const [sprintId, setSprintId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sprints = useQuery<{ sprintList: Array<{ id: number; name: string; state: string; startDate: string }> }>(GET_SPRINT_LIST, { fetchPolicy: 'cache-and-network' });
  const { data, loading, error, refetch } = useQuery<{ retro: Retro | null }>(GET_RETRO, { variables: { sprintId }, fetchPolicy: 'cache-and-network' });
  const [build, building] = useMutation(RETRO_BUILD);
  const [act, acting] = useMutation(RETRO_ITEM_ACTION);
  const retro = data?.retro ?? null;
  const options = [...(sprints.data?.sprintList ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((sprint) => ({ value: String(sprint.id), label: `${sprint.name}${sprint.state === 'active' ? ' · active' : ''}` }));

  const onAction = async (id: string, action: string, text?: string) => {
    setNotice(null);
    try {
      await act({ variables: { id, action, text } });
      await refetch();
      if (action === 'accept') setNotice('Accepted. A line with somewhere to go opens a sous session that applies it; nothing is merged without you.');
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'The change failed');
    }
  };
  const onBuild = async () => {
    if (!retro) return;
    setNotice(null);
    try {
      await build({ variables: { sprintId: retro.sprintId } });
      setNotice(`Sous is drafting the retro of ${retro.sprint} in a new session (Retro-${retro.sprint}). The lines appear here when it posts them.`);
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'The draft could not be started');
    }
  };

  if (error && !data) return <p className="text-sm text-status-conflict" role="alert">{error.message}</p>;
  if (!data && loading) return <p className="text-sm text-muted-foreground" role="status">Loading the retro...</p>;
  if (!retro) return <p className="text-sm text-muted-foreground">No sprint yet. The sprint dashboard lists the sprints once Jira is set in Settings.</p>;
  const open = retro.items.filter((item) => item.status === 'open').length;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Sprint" className="w-[280px] max-[760px]:w-full" value={String(retro.sprintId)} onValueChange={(value) => setSprintId(Number(value))} options={options.length ? options : [{ value: String(retro.sprintId), label: retro.sprint }]} />
        <span className="text-sm text-muted-foreground">{retro.previous ? `compared with ${retro.previous}` : 'no earlier sprint to compare with'}</span>
        <Button className="ml-auto max-[760px]:ml-0" onClick={() => void onBuild()} disabled={building.loading}><Sparkles size={14} aria-hidden="true" />{retro.items.length ? 'Draft again' : 'Build draft'}</Button>
      </div>
      {notice && <p className="text-sm text-secondary-foreground" role="status">{notice}</p>}

      <dl className="grid grid-cols-4 border-y border-border max-[900px]:grid-cols-2">
        {RETRO_NUMBERS.map(([field, label, unit, better]) => {
          const value = retro.numbers[field];
          const delta = numberDelta(retro.numbers, retro.previousNumbers, field, better);
          return (
            <div key={field} className="border-r border-border px-4 py-3 last:border-r-0 max-[900px]:[&:nth-child(2n)]:border-r-0">
              <dt className="text-[0.72rem] text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-display text-2xl font-bold tabular-nums">{value == null ? '—' : `${value}${unit}`}</dd>
              {delta && <dd className={cn('font-mono text-[0.66rem]', delta.good ? 'text-status-merged' : 'text-muted-foreground')}>{delta.text}</dd>}
            </div>
          );
        })}
      </dl>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6 max-[1000px]:grid-cols-1">
        <section aria-label="What recurred">
          <h3 className={head}>What recurred</h3>
          {retro.problems.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing recurred in this sprint.</p> : (
            <ol className="mt-2">
              {retro.problems.map((problem) => (
                <li key={problem.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border py-2 text-[0.82rem] last:border-b-0">
                  <span className="text-foreground">{problem.label}</span>
                  <span className="font-mono tabular-nums text-secondary-foreground">{problem.count}</span>
                  <span className="col-span-2 font-mono text-[0.66rem] text-muted-foreground">{problem.tickets.join(' · ')}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section aria-label="Per ticket" className="min-w-0 overflow-x-auto">
          <h3 className={head}>Per ticket</h3>
          {retro.tickets.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No agent run in this sprint.</p> : (
            <table className="mt-2 w-full border-collapse text-[0.78rem]">
              <thead><tr className="text-left font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">{['Ticket', 'Kind', 'Hours', 'Rounds', 'Issues', 'Owner wait', 'Result'].map((h) => <th key={h} className="border-b border-border-glow py-1.5 pr-3 font-bold">{h}</th>)}</tr></thead>
              <tbody>
                {retro.tickets.map((ticket) => (
                  <tr key={ticket.key} className="border-b border-border text-secondary-foreground">
                    <td className="py-1.5 pr-3 font-mono font-semibold text-foreground" title={ticket.title}>{ticket.key}</td>
                    <td className="py-1.5 pr-3">{ticket.kind}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{ticket.hours ?? '—'}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{ticket.rounds}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{ticket.issues}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{ticket.ownerWaitHours == null ? '—' : `${ticket.ownerWaitHours} h`}</td>
                    <td className="py-1.5 pr-3">{ticket.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section aria-label="Keep, Problem, Try">
        <h3 className={head}>Keep · Problem · Try {retro.items.length > 0 && <span className="font-medium normal-case tracking-normal">· {open} waiting on you</span>}</h3>
        {retro.items.length === 0
          ? <p className="mt-2 text-sm text-muted-foreground">No draft yet. Build draft asks sous to write one from this sprint's runs; every line comes with its evidence.</p>
          : <ol className="mt-1">{retro.items.map((item) => <Line key={item.id} item={item} onAction={onAction} busy={acting.loading} />)}</ol>}
      </section>
    </div>
  );
};
