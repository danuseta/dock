import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Check, ChevronDown, ChevronUp, Gavel, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button, Select, Textarea } from '../components/ui';
import { GET_JUDGE_DAYS, GET_RETRO, GET_SPRINT_LIST, JUDGE_NOW, JUDGE_SPRINT, RETRO_BUILD, RETRO_ITEM_ACTION } from '../graphql/queries';
import { cn } from '../lib/cn';
import { CAUSE_LABEL, SHOWN_PROBLEMS, beforeText, buildResult, causeShare, idNumber, keyList, problemLabel, retroLineState, reviewSummary, shownNumbers, type Retro, type RetroEscalations, type RetroItem } from './retro';
import { InfoTip } from './InfoTip';
import { JudgeDays } from './JudgeDays';
import { SourceChips, SprintSheet } from './SprintSheet';
import { JudgeDaySheet } from './JudgeDaySheet';
import { JUDGE_ONLY_OPTION, judgeHref, judgeOnlySprint, judgeRoute, mergeRetroItems, readRetroView, retroSprintOptions, writeRetroView, type JudgeDays as JudgeDaysData, type MergedRetroItem, type RetroView } from './judge';

const KIND_LABEL: Record<string, string> = { keep: 'Keep', problem: 'Problem', try: 'Try' };
const DEST_LABEL: Record<string, string> = { kit: 'PR kit', memory: 'memory', dock: 'issue DOCK', note: 'note only', 'qa-agent': 'QA bot triage rule (PR by a developer)' };
const CAUSE_COLOR: Record<string, string> = {
  dependency: 'var(--color-status-warn)', access: 'var(--color-status-discord)', data: 'var(--color-secondary-foreground)', environment: 'var(--color-status-conflict)', unspecified: 'var(--color-muted-foreground)',
};
const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const fold = 'mt-1 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-left text-[0.76rem] text-secondary-foreground hover:text-foreground max-[760px]:min-h-11';
const VIEWS: Array<[RetroView, string]> = [['ledger', 'Ledger'], ['judge', 'Judge'], ['both', 'Both']];
const SHOWN_EVIDENCE = 3;

const Line: React.FC<{ item: RetroItem; onAction: (id: string, action: string, text?: string) => Promise<void>; busy: boolean; sources?: string[] }> = ({ item, onAction, busy, sources }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [allEvidence, setAllEvidence] = useState(false);
  const done = item.status !== 'open';
  const evidence = allEvidence ? item.evidence : item.evidence.slice(0, SHOWN_EVIDENCE);
  const more = item.evidence.length - SHOWN_EVIDENCE;
  return (
    <li className={cn('grid grid-cols-[72px_minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]', done && 'opacity-70')}>
      <span className="flex flex-col gap-1 pt-0.5 font-mono text-[0.66rem] font-bold uppercase tracking-[0.08em] text-secondary-foreground">{KIND_LABEL[item.kind] ?? item.kind}{sources && <SourceChips sources={sources} />}</span>
      <div className="min-w-0">
        {editing
          ? <Textarea aria-label="Edit line" className="min-h-[72px] text-sm" value={text} onChange={(event) => setText(event.target.value)} />
          : <p className="text-pretty text-[0.84rem] text-foreground">{item.text}</p>}
        {evidence.length > 0 && <ul className="mt-1 grid gap-0.5 text-[0.72rem] text-muted-foreground">{evidence.map((line) => <li key={line}>{line}</li>)}</ul>}
        {more > 0 && <button type="button" className={fold} onClick={() => setAllEvidence(!allEvidence)}>{allEvidence ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}{allEvidence ? 'Hide evidence' : `${more} more evidence`}</button>}
        <p className="mt-1 font-mono text-[0.64rem] text-muted-foreground">
          goes to {DEST_LABEL[item.dest] ?? item.dest}
          {item.status === 'closed' ? <span> · closed</span> : <span className={cn(item.status === 'accepted' && 'text-status-merged')}> · {retroLineState(item)}</span>}
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

/** QA escalations of the whole team by cause, counted from the labels added during the sprint. */
const Escalations: React.FC<{ escalations: RetroEscalations }> = ({ escalations }) => (
  <section aria-label="QA escalations" className="min-w-0">
    <h3 className={head}>QA escalations <span className="font-medium normal-case tracking-normal">· {escalations.tickets} tickets</span></h3>
    {escalations.causes.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No QA escalation labels were added this sprint.</p> : (
      <ul className="mt-2">
        {escalations.causes.map((row) => (
          <li key={row.cause} className="grid grid-cols-[180px_minmax(0,1fr)_32px] items-center gap-3 border-b border-border py-2 text-[0.8rem] last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)_32px]">
            <span>{CAUSE_LABEL[row.cause] ?? row.label}</span>
            <span className="h-2 overflow-hidden rounded-pill bg-surface-2 max-[760px]:col-span-2 max-[760px]:row-start-2" aria-hidden="true"><span className="block h-full" style={{ width: `${causeShare(row.count, escalations.causes)}%`, background: CAUSE_COLOR[row.cause] }} /></span>
            <span className="text-right font-mono tabular-nums">{row.count}</span>
            <span className="col-span-3 break-words font-mono text-[0.64rem] text-muted-foreground max-[760px]:col-span-2" title={row.tickets.join(', ')}>{keyList(row.tickets)}</span>
          </li>
        ))}
      </ul>
    )}
    {!escalations.planned
      ? <p className="mt-2 text-pretty text-[0.76rem] text-muted-foreground">This sprint was not planned in DOCK Planning, so there is no QA prediction to compare.</p>
      : escalations.unpredicted.length > 0 && (
        <p className="mt-2 text-pretty text-[0.76rem] text-muted-foreground">Planning did not predict {escalations.unpredicted.length} of {escalations.tickets} tickets. The proposed triage rules are under Try.</p>
      )}
  </section>
);

/** The sprint's numbers as tiles, each with the sprint before; a number zero in both is left out. */
const Numbers: React.FC<{ retro: Retro }> = ({ retro }) => (
  <dl className="grid grid-cols-3 border-t border-l border-border max-[900px]:grid-cols-2">
    {shownNumbers(retro.numbers, retro.previousNumbers).map(([field, label, unit]) => {
      const value = retro.numbers[field];
      const before = beforeText(retro.previousNumbers, field, unit, retro.previous);
      return (
        <div key={field} className="border-b border-r border-border px-4 py-3">
          <dd className="font-display text-2xl font-bold tabular-nums">{value == null ? '—' : `${idNumber(value)}${unit}`}</dd>
          <dt className="flex items-center gap-1 text-[0.72rem] text-secondary-foreground">{label}{field === 'medianHours' && <InfoTip label="About ticket time">Median of the tickets finished this sprint, from start to finish, including waiting time.</InfoTip>}</dt>
          {before && <dd className="font-mono text-[0.64rem] text-muted-foreground">{before}</dd>}
        </div>
      );
    })}
  </dl>
);

const Recurring: React.FC<{ problems: Retro['problems'] }> = ({ problems }) => {
  const [all, setAll] = useState(false);
  const shown = all ? problems : problems.slice(0, SHOWN_PROBLEMS);
  const rest = problems.slice(SHOWN_PROBLEMS);
  return (
    <section aria-label="Recurring">
      <h3 className={head}>Recurring</h3>
      {problems.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing recurred this sprint.</p> : (
        <ol className="mt-2">
          {shown.map((problem) => (
            <li key={problem.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border py-2 text-[0.82rem] last:border-b-0">
              <span className="text-foreground">{problemLabel(problem.label)}</span>
              <span className="font-mono tabular-nums text-secondary-foreground">{problem.count}</span>
              <span className="col-span-2 font-mono text-[0.66rem] text-muted-foreground" title={problem.tickets.join(', ')}>{keyList(problem.tickets)}</span>
            </li>
          ))}
        </ol>
      )}
      {rest.length > 0 && <button type="button" className={fold} aria-expanded={all} onClick={() => setAll(!all)}>{all ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}{all ? 'Hide' : `${rest.length} more: ${rest.map((problem) => `${problemLabel(problem.label).toLowerCase()} ${problem.count}`).join(', ')}`}</button>}
    </section>
  );
};

const cell = 'py-1.5 pr-3';

const PerTicket: React.FC<{ tickets: Retro['tickets'] }> = ({ tickets }) => {
  const [open, setOpen] = useState(false);
  const builds = tickets.filter((ticket) => ticket.kind !== 'review');
  const reviews = tickets.filter((ticket) => ticket.kind === 'review');
  return (
    <section aria-label="Per ticket" className="min-w-0 overflow-x-auto">
      <h3 className={head}>Per ticket</h3>
      {tickets.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No agent runs this sprint.</p>}
      {builds.length > 0 && (
        <table className="mt-2 w-full border-collapse text-[0.78rem]">
          <thead><tr className="text-left font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">{['Ticket', 'Fix rounds', 'Issues', 'Findings', 'Waiting on you', 'Result'].map((h) => <th key={h} className="border-b border-border-glow py-1.5 pr-3 font-bold">{h}</th>)}</tr></thead>
          <tbody>
            {builds.map((ticket) => (
              <tr key={ticket.key} className="border-b border-border text-secondary-foreground">
                <td className={cn(cell, 'font-mono font-semibold text-foreground')} title={ticket.title}>{ticket.key}</td>
                <td className={cn(cell, 'tabular-nums')}>{ticket.rounds}</td>
                <td className={cn(cell, 'tabular-nums')}>{ticket.issues}</td>
                <td className={cn(cell, 'tabular-nums')}>{ticket.findings}</td>
                <td className={cn(cell, 'tabular-nums')}>{ticket.ownerWaitHours == null ? '—' : `${idNumber(ticket.ownerWaitHours)} h`}</td>
                <td className={cell}>{buildResult(ticket)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {reviews.length > 0 && <>
        <button type="button" className={fold} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}{reviewSummary(reviews)}</button>
        {open && (
          <table className="mt-1 w-full border-collapse text-[0.76rem]">
            <tbody>
              {reviews.map((ticket) => (
                <tr key={ticket.key} className="border-b border-border text-secondary-foreground">
                  <td className={cn(cell, 'font-mono font-semibold text-foreground')} title={ticket.title}>{ticket.key}</td>
                  <td className={cn(cell, 'tabular-nums')}>{ticket.findings} findings</td>
                  <td className={cell}>{ticket.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>}
    </section>
  );
};

/** A sprint's retro of the agents' work: the ledger numbers, what recurred, each ticket, sous's Keep / Problem / Try, and Judge's days. */
export const RetroTab: React.FC<{ onNavigate?: (path: string) => void }> = ({ onNavigate }) => {
  const [sprintId, setSprintId] = useState<number | null>(null);
  const [judgePick, setJudgePick] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sprints = useQuery<{ sprintList: Array<{ id: number; name: string; state: string; startDate: string }> }>(GET_SPRINT_LIST, { fetchPolicy: 'cache-and-network' });
  const { data, loading, error, refetch } = useQuery<{ retro: Retro | null }>(GET_RETRO, { variables: { sprintId }, fetchPolicy: 'cache-and-network' });
  const [build, building] = useMutation(RETRO_BUILD);
  const [act, acting] = useMutation(RETRO_ITEM_ACTION);
  const retro = data?.retro ?? null;
  const [view, setView] = useState<RetroView>(readRetroView);
  const [route, setRoute] = useState(() => judgeRoute(window.location.search));
  const judge = useQuery<{ judgeDays: JudgeDaysData | null }>(GET_JUDGE_DAYS, { variables: { sprint: judgePick ?? (sprintId === null ? null : retro?.sprint ?? null) }, skip: !retro, fetchPolicy: 'cache-and-network' });
  const [judgeNow, judging] = useMutation(JUDGE_NOW, { refetchQueries: ['GetJudgeDays'] });
  const [judgeSprint, summing] = useMutation(JUDGE_SPRINT, { refetchQueries: ['GetJudgeDays'] });
  useEffect(() => {
    const follow = () => setRoute(judgeRoute(window.location.search));
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);
  const go = (target: { day?: string | null; sprintSheet?: boolean }) => {
    window.history.pushState(window.history.state, '', judgeHref(window.location.search, target));
    setRoute(judgeRoute(window.location.search));
    window.scrollTo({ top: 0 });
  };
  const navigate = (path: string) => (onNavigate ? onNavigate(path) : window.location.assign(path));
  const chooseView = (next: RetroView) => {
    setView(next);
    writeRetroView(next);
  };
  const sprintList = sprints.data?.sprintList ?? [];
  const options = retroSprintOptions(sprintList, judge.data?.judgeDays?.activeSprint ?? null);
  const pickSprint = (value: string) => {
    if (value.startsWith(JUDGE_ONLY_OPTION)) {
      setJudgePick(value.slice(JUDGE_ONLY_OPTION.length));
      if (view === 'ledger') chooseView('judge');
      return;
    }
    setJudgePick(null);
    setSprintId(Number(value));
  };

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
  const onMerged = async (entry: MergedRetroItem, action: string, text?: string) => {
    await onAction(entry.item.id, action, text);
    // A line both sources found is applied once: its twin closes with it, or follows a close or a reopen.
    const twin = action === 'accept' ? 'close' : action === 'edit' ? null : action;
    for (const other of twin ? entry.others : []) await act({ variables: { id: other.id, action: twin } }).catch(() => undefined);
    if (twin && entry.others.length) await refetch();
  };
  const onJudgeNow = async () => {
    setNotice(null);
    try {
      const tick = (await judgeNow()).data?.judgeNow as { started: string | null; skipped: string | null } | undefined;
      setNotice(tick?.started ? 'Judge started a session. Its findings show on the day once it posts them.' : `Judge did not start: ${tick?.skipped ?? 'nothing waiting'}.`);
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Judge could not start');
    }
  };
  const onJudgeSprint = async () => {
    if (!retro) return;
    setNotice(null);
    try {
      await judgeSprint({ variables: { sprint: judge.data?.judgeDays?.sprint ?? retro.sprint } });
      setNotice('The sprint summary waits for the Judge queue to empty (until 23:30), then runs. Its Problem and Try lines show on the Sprint sheet.');
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'The sprint summary could not be asked for');
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
  if (!data && loading) return <p className="text-sm text-muted-foreground" role="status">Loading retro...</p>;
  if (!retro) return <p className="text-sm text-muted-foreground">No sprints yet. The sprint dashboard shows sprints once Jira is set up in Settings.</p>;
  const merged = mergeRetroItems(retro.items, view);
  const open = merged.filter((entry) => entry.item.status === 'open').length;
  const days = judge.data?.judgeDays ?? null;
  const showJudge = view !== 'ledger';
  const judgeOnly = judgeOnlySprint({ view, picked: judgePick, sprintChosen: sprintId !== null, daysSprint: days?.sprint ?? null, retroSprint: retro.sprint });
  const listed = judgeOnly ? sprintList.find((sprint) => sprint.name === judgeOnly) : undefined;
  const pickerValue = judgeOnly ? (listed ? String(listed.id) : `${JUDGE_ONLY_OPTION}${judgeOnly}`) : String(retro.sprintId);
  const backToDays = () => go({});
  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <Select aria-label="Sprint" className="w-[280px] max-[760px]:w-full" value={pickerValue} onValueChange={pickSprint} options={options.length ? options : [{ value: String(retro.sprintId), label: retro.sprint }]} />
      <span className="text-sm text-muted-foreground">{judgeOnly ? `no ledger retro for ${judgeOnly} yet` : retro.previous ? `compared with ${retro.previous}` : 'no previous sprint'}</span>
      <span className="inline-flex overflow-hidden whitespace-nowrap rounded-xs border border-border-glow font-mono text-[0.66rem]" role="group" aria-label="Retro source">
        {VIEWS.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => chooseView(id)} className={cn('px-2.5 py-1 max-[760px]:min-h-11 max-[760px]:px-3.5', view === id ? 'bg-surface-hover font-bold text-foreground' : 'text-secondary-foreground hover:bg-surface-1')}>{label}</button>)}
      </span>
      <span className="ml-auto flex flex-wrap gap-2 max-[760px]:ml-0">
        {showJudge && <Button onClick={() => void onJudgeSprint()} disabled={summing.loading}><Gavel size={14} aria-hidden="true" />Judge sprint</Button>}
        {!judgeOnly && <Button onClick={() => void onBuild()} disabled={building.loading}><Sparkles size={14} aria-hidden="true" />{retro.items.length ? 'Redraft' : 'Draft'}</Button>}
      </span>
    </div>
  );
  if (route.day) {
    return (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
        {header}
        <JudgeDaySheet key={route.day} day={route.day} onBack={backToDays} onDay={(day) => go({ day })} onConfirmed={() => { void judge.refetch(); backToDays(); }} onNavigate={navigate} />
      </div>
    );
  }
  if (route.sprintSheet && days) {
    return (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
        {header}
        {notice && <p className="text-sm text-secondary-foreground" role="status">{notice}</p>}
        <SprintSheet
          sprint={days.sprint}
          previous={days.previous}
          sheet={days.sheet}
          busy={acting.loading}
          onBack={backToDays}
          onOpenDay={(day) => go({ day })}
          patterns={judgeOnly ? [] : mergeRetroItems(retro.items, view === 'ledger' ? 'both' : view).filter((entry) => entry.item.status === 'open' && entry.item.kind !== 'keep')}
          onAction={(entry, action) => void onMerged(entry, action)}
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      {header}
      {notice && <p className="text-sm text-secondary-foreground" role="status">{notice}</p>}
      {showJudge && days && <JudgeDays data={days} busy={judging.loading} onOpenDay={(day) => go({ day })} onOpenSprint={() => go({ sprintSheet: true })} onJudgeNow={() => void onJudgeNow()} />}
      {showJudge && !days && judge.error && <p className="text-sm text-status-conflict" role="alert">{judge.error.message}</p>}
      {view !== 'judge' && !judgeOnly && <>

      <Numbers retro={retro} />

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6 max-[1000px]:grid-cols-1">
        <Recurring problems={retro.problems} />
        <PerTicket tickets={retro.tickets} />
      </div>

      <Escalations escalations={retro.escalations} />

      <section aria-label="Keep, Problem, Try">
        <h3 className={head}>Keep · Problem · Try {merged.length > 0 && <span className="font-medium normal-case tracking-normal">· {open} waiting on you</span>}</h3>
        {merged.length > 0 && <p className="mt-1 text-[0.76rem] text-muted-foreground">Ledger lines are applied automatically when sous posts the draft. Judge lines wait for you to accept them.</p>}
        {merged.length === 0
          ? <p className="mt-2 text-sm text-muted-foreground">No draft yet. Draft asks sous to write one from this sprint's runs, with evidence on every line.</p>
          : <ol className="mt-1">{merged.map((entry) => <Line key={entry.item.id} item={entry.item} sources={view === 'both' ? entry.sources : undefined} onAction={(_id, action, text) => onMerged(entry, action, text)} busy={acting.loading} />)}</ol>}
      </section>
      </>}
    </div>
  );
};
