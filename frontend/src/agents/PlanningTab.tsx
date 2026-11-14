import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { AlertCircle, AlertTriangle, ArrowRight, ArrowRightLeft, Ban, CalendarCheck, Check, CheckCircle2, ChevronDown, ChevronUp, Download, FileInput, Link2, ListChecks, Minus, Plus, RefreshCw, Scissors, Send, ShieldAlert, ShieldCheck, Undo2, X } from 'lucide-react';
import { Button, Card, Dialog, Input, Select, Textarea } from '../components/ui';
import { PlanningChat } from './PlanningChat';
import { useOpenPlanningChat } from './usePlanningChat';
import { DeveloperOrder, PlanningStatus } from './PlanningStatus';
import { StoryboardBoard } from './StoryboardBoard';
import { MyTicketsPanel } from './MyTicketsPanel';
import {
  CHECK_SPRINT_STORYBOARDS, DECIDE_SPRINT_DRAFT, MOVE_SPRINT_DRAFT_CARDS, SET_SPRINT_DRAFT_TCS, GET_OWNER_NAME, GET_PLANNING_FLOW, GET_PLANNING_SPRINTS, GET_SPRINT_DRAFT, GET_SPRINT_PLAN_SIGNAL, GET_TICKET_READINESS, LOAD_SPRINT_DRAFT, PREVIEW_SPRINT_DRAFT_PUBLISH, PUBLISH_SPRINT_DRAFT,
  REFRESH_SPRINT_DRAFT_QA, UPDATE_SPRINT_DRAFT_TICKET,
} from '../graphql/queries';
import { cn } from '../lib/cn';
import {
  UNASSIGNED, devColors, changeCount, dayOf, decisionLabel, findingKindLabel, forecastOf, handOffs, lateDays, lateText, shortDate, underWay, landingDay, lanes, openQuestionsOf, parseWave, ranks, teamStats, waitersOf, predictionTone, publishHint, publishReadiness, scopeSummary, sortFindings,
  developerLine, freeFrom, githubLine, laneCount, laneOf, moveForecast, moveLine, planRange, scheduleWindow, scheduled, spanOf, tcsToText, textToTcs, uncheckedStoryboard, waveRows, workingDayLabels,
  checklistTcs, qaChecklist, undecidedFinding,
  type DraftChange, type DraftFinding, type DraftTc, type DraftTicket, type LaneBar, type PlanSignal, type PlanningPanel, type PlanningSprint, type PublishResult, type Readiness, type ReadyItem, type SprintDraft, type TicketSummaryLite,
} from './planning';
import { parseFlow, skippedStages } from './planningFlow';
import { panelOf } from './plan';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const chip = 'rounded-xs border px-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em]';
const NO_DEV = '__none';
const TONE: Record<string, string> = {
  ok: 'border-status-merged text-status-merged', conflict: 'border-status-conflict text-status-conflict', warn: 'border-status-warn text-status-warn', none: 'border-border text-muted-foreground',
};
const PANELS: Array<[PlanningPanel, string]> = [['mine', 'Tiket saya'], ['team', 'Team map'], ['scope', 'Scope'], ['ac', 'AC check'], ['qa', 'QA check'], ['tc', 'Test cases'], ['storyboard', 'Storyboard']];

const errorText = (failure: unknown, fallback: string) => (failure instanceof Error ? failure.message : fallback);
/** Opens the ticket page the way a link inside DOCK does: the app reads the new path on popstate. */
const openTicket = (key: string) => {
  window.history.pushState({}, '', `/ticket/${encodeURIComponent(key)}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const QaChip: React.FC<{ ticket: DraftTicket; qaReason: string | null }> = ({ ticket, qaReason }) => {
  if (!ticket.prediction) return <span className={cn(chip, TONE.none)} title={qaReason ?? undefined}>{qaReason ? 'No QA' : 'QA pending'}</span>;
  return <span className={cn(chip, TONE[predictionTone(ticket.prediction.prediction)])} title={ticket.prediction.reasons.join('\n') || undefined}>{ticket.prediction.prediction}</span>;
};

/** "AC needs a check" on a ticket naming a storyboard frame that changed. */
const StoryboardChip: React.FC<{ ticket: DraftTicket }> = ({ ticket }) => {
  const flag = ticket.storyboard;
  if (!flag) return null;
  const tone = flag.checked ? TONE.none : flag.held ? TONE.conflict : TONE.warn;
  return <span className={cn(chip, tone)} title={`Storyboard v${flag.version} changed ${flag.frames.join(', ')}`}>{flag.checked ? 'AC checked' : flag.held ? 'Held · AC needs a check' : 'AC needs a check'} · {flag.frames.join(' ')}</span>;
};

const TcTicket: React.FC<{ ticket: DraftTicket; checklist: DraftTc[]; busy: boolean; onSave: (key: string, tcs: DraftTc[]) => Promise<boolean>; onDecide: (id: string, action: string) => void }> = ({ ticket, checklist, busy, onSave, onDecide }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const start = () => { setText(tcsToText(ticket.tcs)); setError(null); setEditing(true); };
  const save = async () => {
    const parsed = textToTcs(text);
    if (parsed.error) { setError(parsed.error); return; }
    if (await onSave(ticket.key, parsed.tcs)) setEditing(false);
  };
  return (
    <li className="border-b border-border px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem]">
        <span className="font-mono font-semibold">{ticket.key}</span>
        <span className={cn(chip, ticket.tcs.length ? TONE.ok : TONE.none)}>{ticket.tcs.length} TC</span>
        {ticket.tcStale && <span className={cn(chip, TONE.warn)} title="A frame of this ticket changed in the storyboard after these were written">Stale</span>}
        {ticket.tcPending && <span className={cn(chip, 'border-accent text-accent')} title="Publish posts them as a QONFLO-TC v1 comment">Not posted</span>}
        <span className="min-w-0 flex-1 truncate text-secondary-foreground">{ticket.summary}</span>
        {ticket.tcApproved && <span className={cn(chip, TONE.ok)}>Disetujui QA</span>}
        {!editing && !ticket.tcs.length && checklist.length > 0 && <Button size="sm" variant="ghost" onClick={() => void onSave(ticket.key, checklist)} disabled={busy}><ListChecks size={13} aria-hidden="true" />Isi dari checklist QA</Button>}
        {!editing && <Button size="sm" variant="ghost" onClick={start} disabled={busy}>Edit</Button>}
        {!editing && ticket.tcs.length > 0 && (ticket.tcApproved
          ? <Button size="sm" variant="ghost" onClick={() => onDecide(`tc|${ticket.key}`, 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Batal setuju</Button>
          : <Button size="sm" variant="primary" onClick={() => onDecide(`tc|${ticket.key}`, 'approve')} disabled={busy}><Check size={13} aria-hidden="true" />Setujui</Button>)}
      </div>
      {editing ? (
        <div className="mt-2 grid gap-2">
          <Textarea aria-label={`Test cases of ${ticket.key}`} className="min-h-[160px] font-mono text-[0.76rem]" value={text} onChange={(event) => setText(event.target.value)} placeholder={'TC-1 · AC 1 · Title\n- Step\nExpected: What the tester sees'} />
          {error && <p className="text-sm text-status-conflict" role="alert">{error}</p>}
          <div className="flex justify-end gap-2"><Button size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}><Check size={13} aria-hidden="true" />Save</Button></div>
        </div>
      ) : ticket.tcs.length > 0 && (
        <ol className="mt-1.5 grid gap-1.5">
          {ticket.tcs.map((tc) => (
            <li key={tc.id} className="min-w-0 text-[0.76rem] text-secondary-foreground">
              <span className="font-mono font-semibold text-foreground">{tc.id}</span> <span className="font-mono text-muted-foreground">AC {tc.ac}</span> {tc.title}
              {tc.steps.length > 0 && <span className="block text-pretty text-muted-foreground">{tc.steps.join(' → ')}</span>}
              <span className="block text-pretty text-muted-foreground">Expected: {tc.expected}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
};

const TcPanel: React.FC<{ draft: SprintDraft; busy: boolean; onSave: (key: string, tcs: DraftTc[]) => Promise<boolean>; onDecide: (id: string, action: string) => void }> = ({ draft, busy, onSave, onDecide }) => (
  <section aria-label="Test cases" className="grid grid-cols-[minmax(0,1fr)] gap-3">
    <p className="text-pretty text-[0.8rem] text-muted-foreground">Draft test cases per ticket, written by the planning agent, filled from the QA checklist, or here. QA approves each set: that approval is one of the Siap dikerjain items, and a changed set needs a new one. Publish posts a ticket's set as a QONFLO-TC v1 comment when it changed; local QA and the QA bot read the newest one.</p>
    <ul className="overflow-hidden rounded-md border border-border bg-surface-0">
      {[...draft.tickets].sort((a, b) => Number(b.tcStale) - Number(a.tcStale) || a.key.localeCompare(b.key, undefined, { numeric: true })).map((ticket) => <TcTicket key={ticket.key} ticket={ticket} checklist={checklistTcs(qaChecklist(ticket, draft.findings))} busy={busy} onSave={onSave} onDecide={onDecide} />)}
    </ul>
  </section>
);

const fmt = (value: number) => String(Math.round(value * 10) / 10);
const plainSummary = (summary: string) => summary.replace(/^(\[[^\]]+\]\s*)+/, '');
const HATCH = 'repeating-linear-gradient(135deg, transparent 0 5px, var(--color-border) 5px 6px)';

/** The floating card a schedule bar shows on hover, focus or tap: fixed to the viewport, above the bar when there is no room below. */
const PlanHover: React.FC<{ id: string; anchor: HTMLElement; bar: LaneBar; color: string; labels: string[]; spPerDay: number; mergeSource: string }> = ({ id, anchor, bar, color, labels, spPerDay, mergeSource }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const rect = anchor.getBoundingClientRect();
    const below = rect.bottom + 8 + card.offsetHeight < window.innerHeight;
    card.style.left = `${Math.max(8, Math.min(window.innerWidth - card.offsetWidth - 8, rect.left))}px`;
    card.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - card.offsetHeight - 6)}px`;
    card.style.visibility = 'visible';
  });
  const { ticket } = bar;
  const github = githubLine(ticket, mergeSource);
  const row = 'font-mono text-[0.66rem] text-muted-foreground';
  return createPortal(
    <div ref={ref} id={id} role="tooltip" className="pointer-events-none fixed z-50 w-[300px] max-w-[calc(100vw-16px)] rounded-md border border-border bg-surface-0 px-3 py-2.5 text-[0.75rem] shadow-card" style={{ left: 0, top: 0, visibility: 'hidden' }}>
      <p className="flex items-center gap-1.5 font-mono text-[0.8rem] font-bold">
        <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} aria-hidden="true" />{ticket.key}
        {ticket.rank !== null && <span className="font-medium text-muted-foreground">#{ticket.rank}</span>}
      </p>
      <p className="mb-2 mt-0.5 text-pretty leading-snug text-foreground">{ticket.summary}</p>
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <dt className={row}>owner</dt><dd className="text-secondary-foreground">{ticket.dev ?? UNASSIGNED}</dd>
        <dt className={row}>SP</dt><dd className="text-secondary-foreground">{ticket.sp ?? '?'} SP · {fmt(ticket.planDur)} {ticket.planDur === 1 ? 'day' : 'days'}{ticket.sp === null ? ` (1 SP = ${fmt(1 / spPerDay)} day)` : ''}</dd>
        <dt className={row}>plan</dt><dd className="text-secondary-foreground">{planRange(ticket, labels)}</dd>
        <dt className={row}>Jira</dt><dd className="text-secondary-foreground">{ticket.status}</dd>
        <dt className={row}>GitHub</dt>
        <dd className={github.tone === 'ok' ? 'text-status-merged' : github.tone === 'warn' ? 'text-[var(--color-status-warn-ink)]' : 'text-secondary-foreground'}>{github.text}</dd>
        <dt className={row}>PR</dt><dd className="break-words text-secondary-foreground">{ticket.pulls.length ? ticket.pulls.map((pull) => <span key={pull} className="block">{pull}</span>) : 'none found'}</dd>
        {bar.late && <><dt className={row}>late</dt><dd className="text-status-conflict">plan ended before today, not merged</dd></>}
      </dl>
    </div>,
    document.body,
  );
};

/** The team map: load per developer, wave progress, the day-by-day board, each person's order of work and the hand-offs. */
const TeamPanel: React.FC<{ draft: SprintDraft; plan: DraftTicket[]; busy: boolean; onMove: (keys: string[], to: string) => void }> = ({ draft, plan, busy, onMove }) => {
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const hoverId = useId();
  useEffect(() => {
    if (!hover) return undefined;
    const hide = () => setHover(null);
    const outside = (event: MouseEvent) => { if (!(event.target instanceof Element && event.target.closest('[data-plan-bar]'))) hide(); };
    window.addEventListener('scroll', hide, true);
    document.addEventListener('click', outside);
    return () => { window.removeEventListener('scroll', hide, true); document.removeEventListener('click', outside); };
  }, [hover]);
  // Merged cards are done: only the cards still to build are scheduled; the schedule draws the whole plan.
  const board = { ...draft, tickets: scheduled(draft.tickets) };
  const planned = { ...draft, tickets: plan };
  const span = spanOf(board);
  const win = scheduleWindow(planned);
  const days = win.last;
  const labels = workingDayLabels(draft.startDate, Math.max(span, win.last));
  const rows = lanes(board);
  // Every developer of the sprint gets a tile and a schedule row, also one whose cards are all merged.
  const developers = draft.developers.length ? draft.developers : rows.filter((lane) => lane.dev !== UNASSIGNED).map((lane) => ({ name: lane.dev, merged: 0, open: lane.tickets.length, sp: lane.sp, leftSp: lane.left, end: lane.end }));
  const laneNames = [...new Set([...developers.map((developer) => developer.name), ...rows.map((lane) => lane.dev), ...(plan.some((ticket) => !ticket.dev) ? [UNASSIGNED] : [])])];
  const colorOf = devColors(laneNames);
  const color = (dev: string | null) => colorOf.get(dev ?? UNASSIGNED) ?? 'var(--color-muted-foreground)';
  const waves = waveRows(board);
  const rank = ranks(board.tickets);
  const waiters = waitersOf(board.tickets);
  const questions = openQuestionsOf(draft.questions);
  const stats = teamStats(board);
  const hand = handOffs(board.tickets);
  const byKey = new Map(board.tickets.map((ticket) => [ticket.key, ticket]));
  const pct = (days: number) => `${(days / span) * 100}%`;
  const winPct = (day: number) => `${(day / days) * 100}%`;
  const dateOf = (day: number) => labels[day - 1] ?? null;
  const lands = (end: number) => { const day = landingDay(end); return `day ${day}${dateOf(day) ? ` · ${dateOf(day)}` : ''}`; };
  const starts = (start: number) => { const day = Math.floor(start + 1e-9) + 1; return `day ${day}${dateOf(day) ? ` · ${dateOf(day)}` : ''}`; };
  const after = (ticket: DraftTicket) => ticket.end > draft.sprintDays + 1e-9;
  const today = draft.today && draft.today <= span ? draft.today : null;
  const forecast = forecastOf(board);
  const live = underWay(draft);
  const dayDate = (day: number) => dateOf(day) ?? `day ${day}`;
  const shortDay = (day: number) => { const label = dateOf(day); return label ? shortDate(label) : `day ${day}`; };
  const forecastColor = forecast.late > 0 ? 'var(--color-status-conflict)' : 'var(--color-status-merged)';
  const lateTone = forecast.late > 0 ? 'text-status-conflict' : 'text-status-merged';
  // A line at the very end of the span stays inside its clipped row.
  const lineAt = (days: number) => `min(${pct(days)}, calc(100% - 2px))`;
  const winLineAt = (day: number) => `clamp(0px, ${winPct(day)}, calc(100% - 2px))`;
  const dueLabel = `Sprint ends · ${dayDate(forecast.due)}`;
  const forecastLabel = `Forecast · ${dayDate(forecast.day)}`;
  const planByKey = new Map(plan.map((ticket) => [ticket.key, ticket]));
  const selected = picked ? planByKey.get(picked) ?? null : null;
  const planToday = draft.today && draft.today <= days ? draft.today : null;
  const hoverBar = hover ? laneOf(planned, planByKey.get(hover.key)?.dev ?? UNASSIGNED).find((bar) => bar.ticket.key === hover.key) ?? null : null;
  const waitsOn = selected ? selected.dependsOn.filter((key) => byKey.has(key)) : [];
  const waiting = selected ? (waiters.get(selected.key) ?? []).map((ticket) => ticket.key) : [];
  const zeroFloat = hand.filter((row) => row.float <= 0).length;
  const asked = [...questions.keys()].filter((key) => byKey.has(key)).length;
  const keyChip = (key: string, risk = false) => {
    const ticket = byKey.get(key);
    return <span key={key} className={cn('rounded-xs border bg-surface-0 px-1.5 py-px font-mono text-[0.64rem]', risk ? 'border-status-conflict text-status-conflict' : 'border-border text-secondary-foreground')}>{key}{ticket ? ` · ${ticket.dev ?? UNASSIGNED}` : ''}</span>;
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <section aria-label="Load per developer" className="min-w-0">
        <h3 className={head}>Team map · load per developer</h3>
        <p className="mt-2 text-pretty font-mono text-[0.78rem] text-secondary-foreground">
          Due <b className="text-foreground">{dayDate(forecast.due)}</b> · forecast <b className="text-foreground">{dayDate(forecast.day)}</b> · <b className={lateTone}>{lateText(forecast.late)}</b>
        </p>
        <p className="mt-2 max-w-[76ch] text-pretty text-[0.8rem] text-muted-foreground">
          <b className="text-foreground">{stats.cards} cards, {stats.sp} SP</b> across <b className="text-foreground">{stats.devs} {stats.devs === 1 ? 'developer' : 'developers'}</b>, a target of <b className="text-foreground">{fmt(stats.target)} SP</b> each.{' '}
          <b className="text-foreground">{stats.landCards} {stats.landCards === 1 ? 'card' : 'cards'} ({stats.landSp} SP)</b> land by day {draft.sprintDays}{dateOf(draft.sprintDays) ? ` (${dateOf(draft.sprintDays)})` : ''}. The heaviest and the lightest lane are <b className="text-foreground">{stats.spread} SP</b> apart.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.66rem] text-muted-foreground">
          <span>1 SP = {fmt(1 / draft.spPerDay)} day</span>
          {labels[0] && <span>day 1 = <b className="text-secondary-foreground">{labels[0]}</b></span>}
          <span>sprint ends <b className="text-secondary-foreground">day {draft.sprintDays}</b></span>
          {today && <span>today = <b className="text-accent">day {today}</b></span>}
          <span><b className="text-secondary-foreground">{hand.length}</b> hand-offs</span>
          <span><b className="text-secondary-foreground">{asked}</b> {asked === 1 ? 'card' : 'cards'} with open questions</span>
        </p>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-2.5">
          {developers.map((developer) => {
            const lane = rows.find((item) => item.dev === developer.name);
            const tint = color(developer.name);
            const laneDay = landingDay(lane?.end ?? 0);
            const laneLate = lateDays(draft.sprintDays, laneDay);
            return (
            <div key={developer.name} className="min-w-0 rounded-md border border-border border-t-[3px] bg-surface-0 px-3 py-2.5" style={{ borderTopColor: tint }}>
              <b className="block truncate font-display text-[0.9rem]" style={{ color: tint }}>{developer.name}</b>
              <p className="mt-1.5 font-mono text-[1.2rem] font-semibold tabular-nums">{lane?.sp ?? 0}<span className="text-[0.7rem] font-normal text-muted-foreground"> SP · {lane?.tickets.length ?? 0} {lane?.tickets.length === 1 ? 'card' : 'cards'}</span></p>
              <p className="font-mono text-[0.68rem] text-muted-foreground">{developerLine(developer, draft.mergeSource)}</p>
              {lane && live && <p className="font-mono text-[0.68rem] text-muted-foreground">left <b className="text-secondary-foreground">{fmt(lane.left)}</b> of {fmt(lane.sp)} SP</p>}
              {lane ? (
                <>
                  <span className="relative mt-2 block h-1.5 overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0" style={{ width: pct(lane.end), background: tint }} />
                    <span className="absolute -inset-y-0.5 w-0.5 bg-foreground" style={{ left: pct(draft.sprintDays) }} />
                  </span>
                  <p className="mt-2 text-[0.72rem] text-muted-foreground">Ends <b className="text-secondary-foreground">{lands(lane.end)}</b>. In sprint: <b className="text-secondary-foreground">{lane.inSprintSp} SP</b>.</p>
                  <p className="mt-1 font-mono text-[0.66rem] text-muted-foreground">
                    Due {shortDay(draft.sprintDays)} · forecast {shortDay(laneDay)}{laneLate > 0 && <b className="text-status-conflict"> · {lateText(laneLate)}</b>}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[0.72rem] text-muted-foreground"><b className="text-secondary-foreground">{freeFrom(draft.today)}</b>{dateOf(Math.max(1, draft.today ?? 1)) ? ` · ${dateOf(Math.max(1, draft.today ?? 1))}` : ''}</p>
              )}
            </div>
            );
          })}
        </div>
      </section>

      {draft.moves.length > 0 && (
        <section aria-label="Suggested moves" className="min-w-0">
          <h3 className={head}>Suggested moves</h3>
          <p className="mt-2 max-w-[76ch] text-pretty text-[0.8rem] text-muted-foreground">Only To Do cards, with the cards that wait on them. A move changes this draft; Jira gets the new assignee when you Publish.</p>
          <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
            {draft.moves.map((move) => (
              <li key={move.keys.join('|')} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]">
                <div className="min-w-0">
                  <p className="text-pretty font-mono text-[0.78rem] font-semibold">{moveLine(move)}</p>
                  <p className="mt-0.5 text-pretty text-[0.76rem] text-muted-foreground">{move.to} frees up first, so the sprint finishes earlier.</p>
                  <p className="mt-0.5 font-mono text-[0.7rem] text-status-merged">{moveForecast(move, labels)}</p>
                </div>
                <Button size="sm" variant="primary" onClick={() => onMove(move.keys, move.to)} disabled={busy}><ArrowRightLeft size={13} aria-hidden="true" />Move to {move.to}</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Wave progress" className="min-w-0">
        <h3 className={head}>Wave progress</h3>
        <p className="mt-2 max-w-[76ch] text-pretty text-[0.8rem] text-muted-foreground">A wave is a card's depth in the Blocks chain: wave 1 waits on nothing in the plan, wave 2 waits on a wave 1 card. Each segment is one card at its scheduled days, in its owner's colour.</p>
        <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
          {waves.map((row) => (
            <li key={row.wave} className="grid grid-cols-[90px_minmax(0,1fr)_150px] items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-[76px_minmax(0,1fr)]">
              <span className="font-mono text-[0.72rem] font-bold">Wave {row.wave}<span className="block text-[0.62rem] font-normal text-muted-foreground">{row.count} {row.count === 1 ? 'card' : 'cards'} · {row.sp} SP</span></span>
              <span className="relative h-[22px] overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
                {row.tickets.map((ticket) => (
                  <span key={ticket.key} title={`${ticket.key} · ${ticket.dev ?? UNASSIGNED}`} className="absolute inset-y-[3px] rounded-[3px] opacity-85" style={{ left: pct(ticket.start), width: `max(2px, calc(${pct(ticket.dur)} - 1px))`, background: color(ticket.dev) }} />
                ))}
                <span className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: lineAt(draft.sprintDays) }} title={dueLabel} />
                <span className="absolute inset-y-0 border-l-2 border-dashed" style={{ left: lineAt(forecast.end), borderColor: forecastColor }} title={forecastLabel} />
              </span>
              <span className="text-right font-mono text-[0.68rem] text-secondary-foreground max-[760px]:col-span-2 max-[760px]:text-left">
                closes day {landingDay(row.closes)}
                <span className={cn('block text-[0.62rem]', row.late ? 'text-status-conflict' : 'text-muted-foreground')}>{row.late ? 'after the sprint' : 'inside the sprint'}{dateOf(landingDay(row.closes)) ? ` · ${dateOf(landingDay(row.closes))}` : ''}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.7rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-foreground" aria-hidden="true" />{dueLabel}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 border-l-2 border-dashed" style={{ borderColor: forecastColor }} aria-hidden="true" />{forecastLabel}</span>
        </p>
      </section>

      <section aria-label="Schedule" className="min-w-0">
        <h3 className={head}>Schedule · every developer</h3>
        <p className="mt-2 max-w-[76ch] text-pretty text-[0.8rem] text-muted-foreground">One row per developer, from day 1 to the forecast. Every card of the sprint sits where the plan put it: in its owner's <b className="text-foreground">#N</b> label order, back to back, as long as its SP. Merged cards are drawn faded with a ✓; a card not merged whose place has passed is <b className="text-status-conflict">late</b>. The forecast counts only the work left on the open cards, from today. The hatched days are after the sprint. Hover or tap a card for its details; click it to see what it waits on and what waits on it.</p>
        {draft.mergeSource === 'jira' && <p className="mt-2 font-mono text-[0.7rem] text-muted-foreground" role="status">Merge state from Jira status: GitHub unavailable</p>}
        <div className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
          <div className="overflow-x-auto">
            <div style={{ minWidth: `${112 + days * 58}px` }}>
              <div className="flex border-b border-border bg-surface-1 pl-[112px]">
                {Array.from({ length: days }, (_, index) => {
                  const day = index + 1;
                  return (
                    <div key={day} className={cn('min-w-0 flex-1 overflow-hidden whitespace-nowrap border-l border-border px-1.5 py-1.5 font-mono text-[0.58rem] text-muted-foreground', planToday === day && 'text-status-discord')} style={day > draft.sprintDays ? { backgroundImage: HATCH } : undefined}>
                      <b className={cn('block', planToday === day ? 'text-status-discord' : 'text-secondary-foreground')}>D{day}{planToday === day ? ' · today' : ''}</b>{labels[day - 1] ?? ''}
                    </div>
                  );
                })}
              </div>
              <div className="flex border-b border-border">
                <div className="w-[112px] flex-none border-r border-border bg-surface-1" />
                <div className="relative h-9 flex-1">
                  <span className="absolute inset-y-0 z-[2] w-0.5 bg-foreground/75" style={{ left: winLineAt(draft.sprintDays) }} aria-hidden="true" />
                  <span className="absolute inset-y-0 z-[2] border-l-2 border-dashed" style={{ left: winLineAt(forecast.end), borderColor: forecastColor }} aria-hidden="true" />
                  {planToday && <span className="absolute inset-y-0 z-[2] w-0.5 bg-status-discord" style={{ left: winLineAt(planToday - 1) }} aria-hidden="true" />}
                  {([[draft.sprintDays, dueLabel, 'var(--color-foreground)', 3], [forecast.end, forecastLabel, forecastColor, 19]] as const).map(([at, text, tone, top]) => (
                    <span key={text} className="absolute whitespace-nowrap font-mono text-[0.6rem] font-semibold" style={{ top, left: winLineAt(at), color: tone, transform: at / days > 0.5 ? 'translateX(calc(-100% - 5px))' : 'translateX(5px)' }}>{text}</span>
                  ))}
                </div>
              </div>
              {laneNames.map((name) => {
                const bars = laneOf(planned, name);
                const tint = color(name);
                return (
                <div key={name} className="flex min-h-[74px] border-b border-border last:border-b-0">
                  <div className="w-[112px] flex-none border-r border-border bg-surface-1 px-3 py-2.5">
                    <b className="block truncate font-display text-[0.84rem]" style={{ color: tint }}>{name}</b>
                    <span className="font-mono text-[0.6rem] text-muted-foreground">{bars.length ? laneCount(bars) : 'no card'}</span>
                  </div>
                  <div className="relative flex-1">
                    {Array.from({ length: days }, (_, index) => <span key={index} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${(index / days) * 100}%` }} aria-hidden="true" />)}
                    <span className="absolute inset-y-0 z-[2] w-0.5 bg-foreground/75" style={{ left: winLineAt(draft.sprintDays) }} aria-hidden="true" />
                    <span className="absolute inset-y-0 z-[2] border-l-2 border-dashed" style={{ left: winLineAt(forecast.end), borderColor: forecastColor }} aria-hidden="true" />
                    {planToday && <span className="absolute inset-y-0 z-[2] w-0.5 bg-status-discord" style={{ left: winLineAt(planToday - 1) }} aria-hidden="true" />}
                    {bars.map((bar) => {
                      const ticket = bar.ticket;
                      const asks = questions.get(ticket.key)?.length ?? 0;
                      const isPicked = picked === ticket.key;
                      const related = !selected || isPicked || waitsOn.includes(ticket.key) || waiting.includes(ticket.key);
                      const done = bar.kind === 'done';
                      const show = (event: React.SyntheticEvent<HTMLButtonElement>) => setHover({ key: ticket.key, anchor: event.currentTarget });
                      const hide = () => setHover((current) => (current?.key === ticket.key ? null : current));
                      return (
                        <button
                          key={ticket.key}
                          type="button"
                          data-plan-bar=""
                          aria-pressed={isPicked}
                          aria-describedby={hover?.key === ticket.key ? hoverId : undefined}
                          onClick={(event) => { show(event); setPicked(isPicked ? null : ticket.key); }}
                          onMouseEnter={show}
                          onMouseLeave={hide}
                          onFocus={show}
                          onBlur={hide}
                          onKeyDown={(event) => { if (event.key === 'Escape') setHover(null); }}
                          className={cn(
                            'absolute top-[7px] z-[3] h-[60px] overflow-hidden rounded-[7px] border border-l-4 py-1 pl-1.5 pr-[7px] text-left transition-[opacity,transform] hover:-translate-y-px',
                            bar.kind === 'todo' && 'border-dashed',
                            bar.moved && 'outline outline-1 outline-dashed outline-offset-1 outline-status-discord',
                            !related && 'opacity-25',
                            isPicked && 'outline outline-2 outline-offset-1 outline-foreground',
                          )}
                          style={{
                            left: `calc(${bar.left} + 2px)`, width: `calc(${bar.width} - 4px)`,
                            borderColor: bar.late ? 'var(--color-status-conflict)' : `color-mix(in oklch, ${tint} ${done ? 35 : 70}%, transparent)`,
                            borderLeftColor: done ? `color-mix(in oklch, ${tint} 55%, transparent)` : tint,
                            borderLeftStyle: 'solid',
                            background: bar.kind === 'todo' ? 'var(--color-surface-0)' : `color-mix(in oklch, ${tint} ${done ? 5 : 10}%, var(--color-surface-0))`,
                            boxShadow: [
                              bar.late ? 'inset 0 0 0 1px color-mix(in oklch, var(--color-status-conflict) 40%, transparent)' : '',
                              asks ? 'inset 3px 0 0 var(--color-status-conflict)' : '',
                              selected && waitsOn.includes(ticket.key) ? 'inset 0 0 0 2px var(--color-status-conflict)' : '',
                            ].filter(Boolean).join(', ') || undefined,
                          }}
                        >
                          <span className={cn('flex justify-between gap-1 whitespace-nowrap font-mono text-[11px]', done ? 'font-semibold text-secondary-foreground' : 'font-bold text-foreground')}>
                            <span>{done && <span className="text-status-merged">✓ </span>}{ticket.key.replace(/^[A-Z]+-/, '')}</span>
                            {ticket.rank !== null && <span className="font-medium text-muted-foreground">#{ticket.rank}</span>}
                          </span>
                          <span className="block truncate text-[11px] leading-tight text-secondary-foreground">{plainSummary(ticket.summary)}</span>
                          {bar.ahead
                            ? <span className="mt-px inline-flex max-w-full items-center gap-[3px] rounded-xs bg-[var(--color-status-warn-pill)] px-[5px] font-mono text-[10px] font-semibold text-[var(--color-status-warn-ink)]"><AlertTriangle size={11} className="flex-none" aria-hidden="true" /><span className="truncate">{bar.ahead}</span></span>
                            : <span className={cn('mt-px block truncate font-mono text-[10px] font-semibold', bar.late ? 'text-status-conflict' : 'text-muted-foreground')}>{bar.third}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
          <div className="min-h-[72px] border-t border-border bg-surface-1 px-4 py-3" aria-live="polite">
            {!selected ? (
              <p className="font-mono text-[0.68rem] text-muted-foreground">Click a card to see its blockers, the cards waiting on it and its open questions.</p>
            ) : (
              <div className="grid gap-2">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 font-mono text-[0.68rem] text-muted-foreground">
                    <b className="text-[0.74rem]" style={{ color: color(selected.dev) }}>{selected.key}</b> · {selected.dev ?? UNASSIGNED} · {selected.sp ?? '?'} SP · wave {selected.wave}{selected.rank !== null && ` · #${selected.rank}`}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(null)} aria-label="Close the card details"><X size={13} aria-hidden="true" /></Button>
                </div>
                <h4 className="text-balance font-display text-[0.95rem] font-semibold">{selected.summary}</h4>
                {selected.merged
                  ? <p className="text-pretty text-[0.8rem] text-secondary-foreground">Merged. The plan had it at {planRange(selected, labels)}.</p>
                  : <p className="text-pretty text-[0.8rem] text-secondary-foreground">Starts {starts(selected.start)}, lands {lands(selected.end)}.{after(selected) && <b className="text-foreground"> Runs past the sprint.</b>}</p>}
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-[0.72rem] text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-1.5"><b className="font-mono text-[0.6rem] uppercase tracking-[0.07em]">Waits on</b>{waitsOn.length ? waitsOn.map((key) => keyChip(key, true)) : <span>nothing in the plan</span>}</div>
                  <div className="flex flex-wrap items-center gap-1.5"><b className="font-mono text-[0.6rem] uppercase tracking-[0.07em]">Waiting on it</b>{waiting.length ? waiting.map((key) => keyChip(key)) : <span>nothing in the plan</span>}</div>
                </div>
                {(questions.get(selected.key) ?? []).length > 0 && (
                  <div className="text-[0.76rem]">
                    <b className="font-mono text-[0.6rem] uppercase tracking-[0.07em] text-status-conflict">Open questions</b>
                    <ul className="mt-1 grid gap-1">{questions.get(selected.key)!.map((question) => <li key={question.id} className="text-pretty text-secondary-foreground">{question.text}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {hoverBar && hover && <PlanHover id={hoverId} anchor={hover.anchor} bar={hoverBar} color={color(hoverBar.ticket.dev)} labels={labels} spPerDay={draft.spPerDay} mergeSource={draft.mergeSource} />}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.7rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-status-conflict bg-status-conflict-bg shadow-[inset_3px_0_0_var(--color-status-conflict)]" aria-hidden="true" />red left edge = open question</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-l-4 border-dashed border-secondary-foreground" style={{ borderLeftStyle: 'solid' }} aria-hidden="true" />To Do, no PR yet</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-l-4 border-secondary-foreground bg-surface-2" aria-hidden="true" />in progress, PR open</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-flex items-center gap-[3px] rounded-xs bg-[var(--color-status-warn-pill)] px-1 font-mono text-[0.6rem] font-semibold text-[var(--color-status-warn-ink)]"><AlertTriangle size={10} aria-hidden="true" />Jira says</span>Jira past merge, PR still open</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-l-4 border-border" aria-hidden="true" />✓ merged</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-l-4 border-status-conflict" style={{ borderLeftColor: 'var(--color-secondary-foreground)' }} aria-hidden="true" />late: not merged, its plan days have passed</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] outline outline-1 outline-dashed outline-status-discord" aria-hidden="true" />moved in this draft</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-foreground" aria-hidden="true" />{dueLabel}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 border-l-2 border-dashed" style={{ borderColor: forecastColor }} aria-hidden="true" />{forecastLabel}</span>
          {planToday && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-status-discord" aria-hidden="true" />today</span>}
          <span className="inline-flex items-center gap-1.5"><span className="rounded-xs border border-secondary-foreground px-1 font-mono text-[0.6rem] font-semibold text-secondary-foreground">#1</span>the card's #N label in Jira: first in its owner's plan</span>
          <span>1 SP = {fmt(1 / draft.spPerDay)} day</span>
        </div>
      </section>

      <section aria-label="Order of work, per person" className="min-w-0">
        <h3 className={head}>Order of work, per person</h3>
        <p className="mt-2 max-w-[76ch] text-pretty text-[0.8rem] text-muted-foreground">Work top to bottom; start days already respect blockers and wave order. The grey line names who waits on each card. Cards tagged <b className="text-foreground">after sprint</b> finish past day {draft.sprintDays}.</p>
        <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
          {rows.map((lane) => (
            <div key={lane.dev} className="min-w-0 rounded-md border border-border bg-surface-0 px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
                <b className="truncate font-display text-[0.9rem]" style={{ color: lane.color }}>{lane.dev}</b>
                <span className="flex-none font-mono text-[0.66rem] text-muted-foreground">{lane.sp} SP · ends day {landingDay(lane.end)}</span>
              </div>
              <ol>
                {lane.tickets.map((ticket) => {
                  const next = waiters.get(ticket.key) ?? [];
                  const asks = questions.get(ticket.key)?.length ?? 0;
                  return (
                    <li key={ticket.key} className="flex gap-2.5 border-b border-dashed border-border py-2 last:border-b-0">
                      <span className="w-4 flex-none pt-0.5 font-mono text-[0.62rem] text-muted-foreground">{rank.get(ticket.key)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span className="font-mono text-[0.7rem] font-semibold" style={{ color: lane.color }}>{ticket.key}</span>
                          <span className="font-mono text-[0.62rem] text-muted-foreground">{ticket.sp ?? '?'} SP</span>
                          <span className="rounded-xs border px-1 font-mono text-[0.58rem] font-semibold" style={{ borderColor: lane.color, color: lane.color }}>W{ticket.wave}</span>
                          {asks > 0 && <span className="rounded-xs border border-status-conflict px-1 font-mono text-[0.58rem] font-semibold text-status-conflict">{asks} open Q</span>}
                          {after(ticket) && <span className="rounded-xs border border-dashed border-muted-foreground px-1 font-mono text-[0.58rem] font-semibold text-muted-foreground">after sprint</span>}
                        </p>
                        <p className={cn('mt-0.5 text-pretty text-[0.78rem] leading-snug', after(ticket) ? 'text-secondary-foreground' : 'text-foreground')}>{plainSummary(ticket.summary)}</p>
                        <p className="mt-1 text-pretty text-[0.68rem] text-muted-foreground">
                          {starts(ticket.start)} to {lands(ticket.end)}. {next.length ? <>Waiting on it: <b className="text-secondary-foreground">{next.map((item) => `${item.key.replace(/^[A-Z]+-/, '')} ${item.dev ?? UNASSIGNED}`).join(', ')}</b></> : 'Nothing in the plan waits on it.'}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Hand-offs" className="min-w-0">
        <h3 className={head}>Hand-offs</h3>
        <p className="mt-2 max-w-[76ch] text-pretty text-[0.8rem] text-muted-foreground">A hand-off is a blocker finished by one developer that unblocks a card of another. Float is how many days the finishing card can slip before the next one starts late. <b className="text-foreground">{hand.length} {hand.length === 1 ? 'hand-off' : 'hand-offs'}; {zeroFloat} with no float.</b></p>
        {hand.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No card waits on another developer's card.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[0.76rem]">
                <thead>
                  <tr className="border-b border-border bg-surface-1 text-left">
                    {['Lands', 'Finishes', 'Unblocks', 'For', 'Float'].map((label) => <th key={label} className={cn(head, 'px-3 py-2 font-semibold')}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {hand.map((row) => (
                    <tr key={`${row.from}|${row.to}`} className="border-b border-border align-top last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[0.7rem] text-foreground">{lands(row.lands)}</td>
                      <td className="px-3 py-2"><span className="font-mono font-semibold" style={{ color: color(row.fromDev) }}>{row.from}</span> <span className="font-semibold" style={{ color: color(row.fromDev) }}>{row.fromDev}</span></td>
                      <td className="px-3 py-2 font-mono font-semibold" style={{ color: color(row.toDev) }}>{row.to}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: color(row.toDev) }}>{row.toDev}</td>
                      <td className={cn('whitespace-nowrap px-3 py-2 font-mono', row.float <= 0 ? 'font-semibold text-status-conflict' : 'text-secondary-foreground')}>{fmt(row.float)} d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

const TicketRow: React.FC<{ draft: SprintDraft; ticket: DraftTicket; busy: boolean; onChange: (key: string, change: { dev?: string | null; wave?: number; sp?: number }) => void }> = ({ draft, ticket, busy, onChange }) => {
  const [wave, setWave] = useState(String(ticket.wave));
  const [sp, setSp] = useState(ticket.sp === null ? '' : String(ticket.sp));
  useEffect(() => setWave(String(ticket.wave)), [ticket.wave]);
  useEffect(() => setSp(ticket.sp === null ? '' : String(ticket.sp)), [ticket.sp]);
  const devOptions = [...new Set([...draft.devs, ...(ticket.dev ? [ticket.dev] : [])])].map((dev) => ({ value: dev, label: dev }));
  const commitWave = () => {
    const value = parseWave(wave);
    if (value === null) setWave(String(ticket.wave));
    else if (value !== ticket.wave || (value === 0 && ticket.waveSet)) onChange(ticket.key, { wave: value });
  };
  const commitSp = () => {
    const value = Number(sp);
    if (sp.trim() === '' || !Number.isFinite(value) || value < 0) setSp(ticket.sp === null ? '' : String(ticket.sp));
    else if (value !== ticket.sp) onChange(ticket.key, { sp: value });
  };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_160px_64px_64px_88px] items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 max-[760px]:col-span-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[0.8rem] font-semibold">{ticket.key}</span>
          <QaChip ticket={ticket} qaReason={draft.qaReason} />
          <StoryboardChip ticket={ticket} />
          {ticket.split && <span className={cn(chip, TONE.warn)} title="Suggested parts in SP"><Scissors size={10} className="mr-1 inline" aria-hidden="true" />Split {ticket.split.join(' + ')}</span>}
          {ticket.dev !== ticket.jiraDev && ticket.dev && <span className={cn(chip, 'border-accent text-accent')}>was {ticket.jiraDev ?? UNASSIGNED}</span>}
        </p>
        <p className="mt-0.5 truncate text-[0.78rem] text-secondary-foreground">{ticket.summary}</p>
      </div>
      <Select
        aria-label={`Developer of ${ticket.key}`}
        value={ticket.dev ?? NO_DEV}
        onValueChange={(value) => onChange(ticket.key, { dev: value === NO_DEV ? null : value })}
        options={[{ value: NO_DEV, label: UNASSIGNED }, ...devOptions]}
        disabled={busy}
        className="h-9 max-[760px]:col-span-2"
      />
      <Input aria-label={`Wave of ${ticket.key}`} inputMode="numeric" className="h-9 px-2 text-center" value={wave} onChange={(event) => setWave(event.target.value)} onBlur={commitWave} disabled={busy} title="0 goes back to the wave the dependencies give" />
      <Input aria-label={`SP of ${ticket.key}`} inputMode="decimal" className="h-9 px-2 text-center" value={sp} onChange={(event) => setSp(event.target.value)} onBlur={commitSp} disabled={busy} />
      <span className={cn('font-mono text-[0.68rem] max-[760px]:col-span-2', ticket.inSprint ? 'text-muted-foreground' : 'text-status-conflict')}>
        {ticket.inSprint ? `${dayOf(ticket.start + 0.001)} to ${dayOf(ticket.end)}` : `backlog · ${dayOf(ticket.end)}`}
      </span>
    </li>
  );
};

const ScopePanel: React.FC<{ draft: SprintDraft; busy: boolean; onChange: (key: string, change: { dev?: string | null; wave?: number; sp?: number }) => void; onDecide: (id: string, action: string, note?: string) => void }> = ({ draft, busy, onChange, onDecide }) => {
  const summary = scopeSummary(draft);
  const [cut, setCut] = useState('');
  const inSprint = draft.tickets.filter((ticket) => ticket.inSprint);
  const backlog = draft.tickets.filter((ticket) => !ticket.inSprint);
  const list = (tickets: DraftTicket[]) => (
    <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
      <li className="grid grid-cols-[minmax(0,1fr)_160px_64px_64px_88px] gap-3 border-b border-border bg-surface-1 px-3 py-1.5 max-[760px]:hidden">
        {['Ticket', 'Developer', 'Wave', 'SP', 'Lands'].map((label) => <span key={label} className={head}>{label}</span>)}
      </li>
      {tickets.map((ticket) => <TicketRow key={ticket.key} draft={draft} ticket={ticket} busy={busy} onChange={onChange} />)}
    </ul>
  );
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <p className="text-[0.84rem] text-secondary-foreground">
        <b className="text-foreground">{summary.inSprint}</b> tickets ({summary.inSprintSp} SP) fit {draft.sprintDays} days; <b className="text-foreground">{summary.backlog}</b> ({summary.backlogSp} SP) go to the backlog.
      </p>
      <section aria-label="In the sprint"><h3 className={head}>In the sprint</h3>{inSprint.length ? list(inSprint) : <p className="mt-2 text-sm text-muted-foreground">Nothing fits the sprint.</p>}</section>
      <section aria-label="Backlog"><h3 className={head}>Backlog · lands after the last day</h3>{backlog.length ? list(backlog) : <p className="mt-2 text-sm text-muted-foreground">Everything fits.</p>}</section>
      <section aria-label="Scope cut">
        <h3 className={head}>Potong scope</h3>
        {draft.scopeCut?.note ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[0.8rem] text-secondary-foreground">
            {draft.scopeCut.note}
            {draft.scopeCut.by && <span className="font-mono text-[0.64rem] text-muted-foreground">{draft.scopeCut.by}</span>}
            <Button size="sm" variant="ghost" onClick={() => onDecide('scope|cut', 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
          </p>
        ) : (
          <form className="mt-2 flex gap-2 max-[760px]:flex-col" onSubmit={(event) => { event.preventDefault(); onDecide('scope|cut', 'cut', cut); setCut(''); }}>
            <Input aria-label="Scope cut" className="h-9" value={cut} onChange={(event) => setCut(event.target.value)} placeholder="Apa yang keluar dari sprint, atau tanggal yang digeser" />
            <Button size="sm" type="submit" variant="primary" disabled={busy || !cut.trim()}><Scissors size={13} aria-hidden="true" />Tulis</Button>
          </form>
        )}
      </section>
    </div>
  );
};

/** An AC line longer than this many characters starts clamped to two lines in AC check. */
const AC_LINE_CLAMP = 160;

const FindingRow: React.FC<{ draft: SprintDraft; finding: DraftFinding; busy: boolean; onDecide: (id: string, action: string, note?: string) => void }> = ({ draft, finding, busy, onDecide }) => {
  const late = finding.kind === 'after-it';
  const owner = draft.tickets.find((ticket) => ticket.key === finding.refKey)?.dev;
  const inPlan = draft.tickets.some((ticket) => ticket.key === finding.refKey);
  const when = finding.refEnd !== null && finding.ownEnd !== null ? `lands ${dayOf(finding.refEnd)}, ${finding.key} lands ${dayOf(finding.ownEnd)}` : null;
  const decided = decisionLabel(finding.decision, finding.refKey);
  const open = undecidedFinding(finding);
  const [full, setFull] = useState(false);
  const long = finding.text.length > AC_LINE_CLAMP;
  return (
    <li className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-border px-3 py-1.5 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]', open ? 'border-l-2 border-l-status-warn' : 'opacity-70')}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-secondary-foreground">
          <span className="font-mono font-semibold text-foreground">{finding.key}</span>
          <span className={cn(chip, late ? TONE.warn : TONE.none)}>AC {finding.line}</span>
          <span className="font-mono font-semibold text-foreground" title={[owner, when].filter(Boolean).join(' · ') || undefined}>{finding.refKey}</span>
          <span className={cn(chip, late ? TONE.conflict : finding.kind === 'lands-first' ? TONE.ok : TONE.none)}>{findingKindLabel(finding.kind)}</span>
        </p>
        <p className={cn('mt-0.5 text-pretty text-[0.76rem] text-muted-foreground', long && !full && 'line-clamp-2')}>{finding.text}</p>
        {long && <button type="button" className="text-[0.7rem] font-semibold text-accent hover:underline max-[760px]:min-h-11" aria-expanded={full} onClick={() => setFull((value) => !value)}>{full ? 'Ringkas' : 'Lihat semua'}</button>}
      </div>
      <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
        {decided ? (
          <>
            <span className="self-center font-mono text-[0.64rem] text-muted-foreground">{decided}{finding.decision?.by ? ` · ${finding.decision.by}` : ''}</span>
            <Button size="sm" variant="ghost" onClick={() => onDecide(finding.id, 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
          </>
        ) : finding.linked ? (
          <span className="self-center font-mono text-[0.64rem] text-muted-foreground">Dependency · link Blocks udah ada</span>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => onDecide(finding.id, 'dependency')} disabled={busy}><Link2 size={13} aria-hidden="true" />Dependency</Button>
            <Button size="sm" onClick={() => onDecide(finding.id, 'reference')} disabled={busy}><FileInput size={13} aria-hidden="true" />Pindah ke Reference</Button>
            {inPlan && <Button size="sm" variant="primary" onClick={() => onDecide(finding.id, 'move')} disabled={busy}><ArrowRightLeft size={13} aria-hidden="true" />Move to {finding.refKey}</Button>}
          </>
        )}
      </div>
    </li>
  );
};

const AcPanel: React.FC<{ draft: SprintDraft; busy: boolean; onDecide: (id: string, action: string, note?: string) => void }> = ({ draft, busy, onDecide }) => {
  const findings = sortFindings(draft.findings);
  const unlinked = findings.filter((finding) => !finding.linked);
  if (!findings.length) return <p className="text-sm text-muted-foreground">No AC line names another ticket.</p>;
  return (
    <section aria-label="AC check">
      <p className="text-[0.84rem] text-secondary-foreground">
        <b className="text-foreground">{unlinked.length}</b> baris AC nyebut tiket lain tanpa link Blocks; {findings.filter(undecidedFinding).length} belum diputusin.
      </p>
      <p className="mt-1 max-w-[76ch] text-pretty text-[0.76rem] text-sky-200">AC cuma isi yang dites di tiket ini. Nunggu tiket yang disebut? Pilih Dependency: link Blocks dipasang waktu Publish, bot QA nahan tiketnya sampai tiket itu di UAT CHECK. Cuma info? Pindah ke Reference. Nggak ada yang diubah di Jira sebelum Publish, dan DOCK nggak nulis komentar.</p>
      <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
        {findings.map((finding) => <FindingRow key={finding.id} draft={draft} finding={finding} busy={busy} onDecide={onDecide} />)}
      </ul>
    </section>
  );
};

/** The QA checklist of one ticket from its AC: what is tested here, with the ticket a line waits for, and what is not. */
const QaChecklistBox: React.FC<{ ticket: DraftTicket; findings: DraftFinding[]; summary: TicketSummaryLite | undefined; onTestCases: () => void }> = ({ ticket, findings, summary, onTestCases }) => {
  const list = qaChecklist(ticket, findings, summary?.acId);
  const line = (row: (typeof list.here)[number]) => (
    <>
      <span className="font-mono text-[0.66rem] text-muted-foreground">AC {row.n}</span> {row.textId ?? row.text}
    </>
  );
  return (
    <div className="mt-2 rounded-md border border-border bg-surface-1 px-3 py-2.5">
      <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
        <div>
          <p className={cn(head, 'mb-1 flex items-center gap-1.5')}><Check size={12} aria-hidden="true" />Dites di tiket ini</p>
          {list.here.length === 0 && <p className="py-1 text-[0.8rem] text-muted-foreground">Nggak ada baris AC yang dites di sini.</p>}
          {list.here.map((row) => (
            <p key={row.n} className="py-1 text-pretty text-[0.8rem] text-foreground">
              {line(row)}
              {row.waitsOn.map((key) => <span key={key} className={cn(chip, TONE.warn, 'ml-1.5')}>nunggu {key}</span>)}
            </p>
          ))}
        </div>
        <div>
          <p className={cn(head, 'mb-1 flex items-center gap-1.5')}><Ban size={12} aria-hidden="true" />Jangan dites di sini</p>
          {list.notHere.length === 0 && <p className="py-1 text-[0.8rem] text-muted-foreground">Semua baris AC dites di tiket ini.</p>}
          {list.notHere.map((row) => <p key={row.n} className="py-1 text-pretty text-[0.8rem] text-muted-foreground">{line(row)} <span className="font-mono text-[0.66rem]">→ {row.testedIn}</span></p>)}
          {summary?.testData && <p className="mt-2 text-xs text-muted-foreground">Data uji: {summary.testData}</p>}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Dibikin dari AC dan keputusan AC check. Field Reference nggak jadi test case. Edit di Test cases, terus setujui.
        <Button size="sm" variant="ghost" onClick={onTestCases}>Test cases<ArrowRight size={13} aria-hidden="true" /></Button>
      </p>
    </div>
  );
};

const QaPanel: React.FC<{ draft: SprintDraft; busy: boolean; summaries: Map<string, TicketSummaryLite>; onDecide: (id: string, action: string, note?: string) => void; onRefresh: () => void; onTestCases: () => void }> = ({ draft, busy, summaries, onDecide, onRefresh, onTestCases }) => {
  const [fixing, setFixing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [listOpen, setListOpen] = useState<string | null>(null);
  const rows = [...draft.tickets].sort((a, b) => Number(b.prediction?.prediction === 'ESCALATED') - Number(a.prediction?.prediction === 'ESCALATED') || a.key.localeCompare(b.key, undefined, { numeric: true }));
  return (
    <section aria-label="QA check" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-pretty text-[0.8rem] text-muted-foreground">The QA bot's triage rules run on the draft AC before publish, so a ticket that would escalate is fixed now instead of after QA in UAT.</p>
        <Button size="sm" onClick={onRefresh} disabled={busy}><RefreshCw size={13} aria-hidden="true" />Check again</Button>
      </div>
      {draft.qaReason && <p className="text-sm text-status-warn" role="status">{draft.qaReason}</p>}
      <ul className="overflow-hidden rounded-md border border-border bg-surface-0">
        {rows.map((ticket) => {
          const escalated = ticket.prediction?.prediction === 'ESCALATED';
          const id = `qa|${ticket.key}`;
          return (
            <li key={ticket.key} className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]', escalated && !ticket.qaDecision && 'border-l-2 border-l-status-conflict')}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem]">
                  <span className="font-mono font-semibold">{ticket.key}</span>
                  <QaChip ticket={ticket} qaReason={draft.qaReason} />
                  <span className="min-w-0 truncate text-secondary-foreground">{ticket.summary}</span>
                </p>
                {ticket.prediction?.reasons.length ? <ul className="mt-1 grid gap-0.5 text-[0.76rem] text-muted-foreground">{ticket.prediction.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
                {ticket.prediction?.fix && <p className="mt-1 text-[0.76rem] text-secondary-foreground">Fix: {ticket.prediction.fix}</p>}
                <button type="button" aria-expanded={listOpen === ticket.key} onClick={() => setListOpen(listOpen === ticket.key ? null : ticket.key)} className="mt-1.5 inline-flex items-center gap-1 text-[0.74rem] font-semibold text-sky-200 hover:underline max-[760px]:min-h-11">
                  {listOpen === ticket.key ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}Checklist QA{ticket.tcApproved ? ' · test case disetujui' : ''}
                </button>
                {listOpen === ticket.key && <QaChecklistBox ticket={ticket} findings={draft.findings} summary={summaries.get(ticket.key)} onTestCases={onTestCases} />}
                {fixing === ticket.key && (
                  <form className="mt-2 flex gap-2 max-[760px]:flex-col" onSubmit={(event) => { event.preventDefault(); onDecide(id, 'fix', note); setFixing(null); }}>
                    <Input aria-label={`What was fixed on ${ticket.key}`} className="h-9" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What was fixed" autoFocus />
                    <Button size="sm" type="submit" variant="primary" disabled={busy || !note.trim()}><Check size={13} aria-hidden="true" />Save</Button>
                  </form>
                )}
              </div>
              <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
                {ticket.qaDecision ? (
                  <>
                    <span className="self-center font-mono text-[0.64rem] text-muted-foreground">{decisionLabel(ticket.qaDecision)}</span>
                    <Button size="sm" variant="ghost" onClick={() => onDecide(id, 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
                  </>
                ) : escalated ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => onDecide(id, 'accept')} disabled={busy}><ShieldAlert size={13} aria-hidden="true" />Accept risk</Button>
                    <Button size="sm" onClick={() => { setFixing(ticket.key); setNote(''); }} disabled={busy}><ShieldCheck size={13} aria-hidden="true" />Fixed</Button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/** G1 above the panel tabs: what is ready for publish, each missing item with a link to the panel that fixes it. */
const ReadyBlock: React.FC<{ id: string; ready: Readiness; onFix: (panel: PlanningPanel) => void }> = ({ id, ready, onFix }) => {
  if (!ready.total) return null;
  return (
    <section id={id} aria-label="Siap publish" className="rounded-md border border-border bg-surface-1 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-sm font-bold"><CalendarCheck size={14} aria-hidden="true" />Siap publish</h3>
        <span className={cn(chip, ready.done === ready.total ? TONE.ok : TONE.warn)}>{ready.done} dari {ready.total}</span>
        <span className="text-xs text-muted-foreground">cuma info, Publish tetap aktif</span>
      </div>
      <ul className="mt-2">
        {ready.items.map((item) => (
          <li key={item.id} className="flex items-start gap-2.5 border-t border-border py-2 first:border-t-0">
            {item.ok ? <CheckCircle2 size={15} className="mt-0.5 flex-none text-status-merged" aria-hidden="true" /> : <AlertCircle size={15} className="mt-0.5 flex-none text-status-warn" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm', item.ok ? 'text-secondary-foreground' : 'text-foreground')}>{item.text}</p>
              {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
            </div>
            {!item.ok && <Button size="sm" variant="ghost" onClick={() => onFix(item.panel)}>{item.fix}<ArrowRight size={13} aria-hidden="true" /></Button>}
          </li>
        ))}
      </ul>
    </section>
  );
};

const PublishDialog: React.FC<{
  open: boolean; sprint: string; changes: DraftChange[] | null; results: PublishResult[] | null; loading: boolean; publishing: boolean; error: string | null; missing: ReadyItem[]; onConfirm: () => void; onClose: () => void; onFix: () => void;
}> = ({ open, sprint, changes, results, loading, publishing, error, missing, onConfirm, onClose, onFix }) => {
  const id = useId();
  const count = changes ? changeCount(changes) : 0;
  return (
    <Dialog open={open} onClose={() => !publishing && onClose()} dismissible={!publishing} labelledBy={`${id}-title`}>
      <Card className="w-[min(640px,calc(100vw-2rem))] shadow-card">
        <h2 id={`${id}-title`} className="text-balance font-display text-xl font-bold">{results ? 'Published' : 'Publish to Jira'}</h2>
        {error && <p className="mt-2 text-sm text-status-conflict" role="alert">{error}</p>}
        {loading && <p className="mt-2 text-sm text-muted-foreground" role="status">Reading each ticket from Jira again...</p>}
        {results ? (
          <ul className="mt-3 max-h-[50vh] overflow-y-auto">
            {results.map((result) => (
              <li key={`${result.kind}|${result.key}`} className="flex flex-wrap items-baseline gap-2 border-b border-border py-2 text-[0.8rem] last:border-b-0">
                <span className="font-mono font-semibold">{result.key}</span>
                <span className={cn(chip, result.status === 'updated' ? TONE.ok : result.status === 'skipped' ? TONE.none : TONE.conflict)}>{result.status}</span>
                {result.detail && <span className="text-muted-foreground">{result.detail}</span>}
              </li>
            ))}
            {!results.some((result) => result.kind === 'ticket') && <li className="py-2 text-sm text-muted-foreground">Jira already matched the plan; no ticket field was written.</li>}
          </ul>
        ) : changes && (
          <>
            {missing.length > 0 ? (
              <div className="mt-3 rounded-md border border-border bg-surface-1 px-3.5 py-3">
                <p className="mb-1 flex flex-wrap items-center gap-1.5 font-display text-sm font-bold"><AlertTriangle size={14} className="text-status-warn" aria-hidden="true" />Masih kurang {missing.length} hal<span className="ml-auto font-body text-xs font-normal text-muted-foreground">nggak nahan publish</span></p>
                {missing.map((item) => <p key={item.id} className="flex items-start gap-2 py-0.5 text-[0.8rem] text-secondary-foreground"><AlertCircle size={13} className="mt-0.5 flex-none text-status-warn" aria-hidden="true" />{item.text}</p>)}
              </div>
            ) : <p className="mt-3 flex items-center gap-2 text-sm text-status-merged"><CheckCircle2 size={14} aria-hidden="true" />Siap publish, semua udah beres</p>}
            <p className="mt-2 text-pretty text-sm text-muted-foreground">Only what differs from Jira now is written: AC lines and assignees. A ticket whose AC changed in Jira since it was loaded is skipped. The Confluence page "Sprint contract {sprint}" is written too, under the parent page set in Settings › Jira, and every changed set of test cases is posted as a QONFLO-TC v1 comment. Every ticket of the plan gets the Jira label plan-published-rN, the signal every developer's DOCK and the cron wait for.</p>
            <ul className="mt-3 max-h-[50vh] overflow-y-auto">
              {changes.map((change) => (
                <li key={change.key} className="border-b border-border py-2 text-[0.8rem] last:border-b-0">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono font-semibold">{change.key}</span>
                    {change.assigneeTo && <span className="text-secondary-foreground">assignee {change.assigneeFrom ?? UNASSIGNED} to {change.assigneeTo}</span>}
                    {change.refused && <span className={cn(chip, TONE.conflict)}>skipped</span>}
                  </p>
                  {change.refused && <p className="mt-1 text-status-conflict">{change.refused}</p>}
                  {change.acRemoved.map((line) => <p key={`-${line}`} className="mt-1 flex gap-1.5 text-pretty text-muted-foreground line-through"><Minus size={13} className="mt-0.5 flex-none" aria-hidden="true" />{line}</p>)}
                  {change.acAdded.map((line) => <p key={`+${line}`} className="mt-1 flex gap-1.5 text-pretty text-status-merged"><Plus size={13} className="mt-0.5 flex-none" aria-hidden="true" />{line}</p>)}
                </li>
              ))}
              {changes.length === 0 && <li className="py-2 text-sm text-muted-foreground">Jira tickets already match the plan.</li>}
            </ul>
          </>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {!results && missing.length > 0 ? <Button onClick={onFix} disabled={publishing}>Beresin dulu</Button> : <Button onClick={onClose} disabled={publishing}>{results ? 'Close' : 'Cancel'}</Button>}
          {!results && <Button variant="primary" onClick={onConfirm} disabled={publishing || loading || !changes}><Send size={14} aria-hidden="true" />{publishing ? 'Publishing...' : missing.length ? 'Tetap publish' : count ? `Publish ${count} ${count === 1 ? 'ticket' : 'tickets'}` : 'Publish'}</Button>}
        </div>
      </Card>
    </Dialog>
  );
};

/** Plans a sprint from Jira: the team's lanes, the scope cut, the AC lines that need a later ticket, the QA bot's call, then Publish. */
export const PlanningTab: React.FC<{ initialPanel?: PlanningPanel }> = ({ initialPanel = 'team' }) => {
  const [sprintId, setSprintId] = useState<number | null>(null);
  const [panel, setPanel] = useState<PlanningPanel>(() => panelOf(window.location.search, initialPanel));
  // The panel follows the URL: Back / Forward, or a link that pushes a new ?panel= while Planning is open.
  useEffect(() => {
    const follow = () => setPanel(panelOf(window.location.search, initialPanel));
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, [initialPanel]);
  const readyId = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [results, setResults] = useState<PublishResult[] | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const sprints = useQuery<{ planningSprints: PlanningSprint[] }>(GET_PLANNING_SPRINTS, { fetchPolicy: 'cache-and-network' });
  const options = sprints.data?.planningSprints ?? [];
  const chosen = options.find((sprint) => sprint.id === sprintId) ?? options.find((sprint) => sprint.state === 'future') ?? options[0] ?? null;
  // The planning chat changes the draft through DOCK's ingest routes, so the panel polls it like Plan does.
  const draftQuery = useQuery<{ sprintDraft: SprintDraft | null }>(GET_SPRINT_DRAFT, { variables: { sprint: chosen?.name ?? '' }, skip: !chosen, fetchPolicy: 'cache-and-network', pollInterval: 10000 });
  // The publish signal comes from Jira's plan labels, so a developer's DOCK sees the planner's publish too.
  const signalQuery = useQuery<{ sprintPlanSignal: PlanSignal | null }>(GET_SPRINT_PLAN_SIGNAL, { variables: { sprint: chosen?.name ?? '' }, skip: !chosen, fetchPolicy: 'cache-and-network', pollInterval: 15000 });
  const signal = signalQuery.data?.sprintPlanSignal ?? null;
  const planner = signal ? signal.isPlanner : true;
  const chat = useOpenPlanningChat(chosen?.name ?? '');
  const flowQuery = useQuery<{ planningFlow: string | null }>(GET_PLANNING_FLOW, { fetchPolicy: 'cache-and-network' });
  const flow = parseFlow(flowQuery.data?.planningFlow);
  const skipped = skippedStages(flow);
  // Tiket saya is not a stage of the flow: it is always shown.
  const panels = PANELS.filter(([id]) => id === 'team' || id === 'mine' || !skipped.has(id));
  const shown = panels.some(([id]) => id === panel) ? panel : 'team';
  const [loadDraft, loading] = useMutation(LOAD_SPRINT_DRAFT);
  const [updateTicket, updating] = useMutation(UPDATE_SPRINT_DRAFT_TICKET);
  const [decide, deciding] = useMutation(DECIDE_SPRINT_DRAFT);
  const [refreshQa, refreshing] = useMutation(REFRESH_SPRINT_DRAFT_QA);
  const [checkStoryboards, checking] = useMutation(CHECK_SPRINT_STORYBOARDS);
  const [saveTcs, savingTcs] = useMutation(SET_SPRINT_DRAFT_TCS);
  const [moveCards, moving] = useMutation(MOVE_SPRINT_DRAFT_CARDS);
  const [publish, publishing] = useMutation(PUBLISH_SPRINT_DRAFT);
  const [preview, previewing] = useLazyQuery<{ previewSprintDraftPublish: DraftChange[] }>(PREVIEW_SPRINT_DRAFT_PUBLISH, { fetchPolicy: 'network-only' });
  const full = draftQuery.data?.sprintDraft ?? null;
  // Merged cards are on the plan only: every panel works on the cards still to build, the schedule draws them all.
  const draft = full && { ...full, tickets: scheduled(full.tickets) };
  const busy = loading.loading || updating.loading || deciding.loading || refreshing.loading || publishing.loading || checking.loading || savingTcs.loading || moving.loading;
  // The planning agent's Indonesian title and AC lines, for Tiket saya and the QA checklist.
  const ownerQuery = useQuery<{ ownerName: string }>(GET_OWNER_NAME, { fetchPolicy: 'cache-first' });
  const me = signal?.me ?? ownerQuery.data?.ownerName ?? null;
  const summaryQuery = useQuery<{ ticketReadiness: { tickets: Array<{ key: string; summary: TicketSummaryLite | null }> } }>(GET_TICKET_READINESS, {
    variables: { keys: draft?.tickets.map((ticket) => ticket.key) ?? [], refs: [] },
    skip: !draft || !['mine', 'qa'].includes(shown),
    fetchPolicy: 'cache-and-network',
  });
  const summaries = new Map((summaryQuery.data?.ticketReadiness.tickets ?? []).flatMap((item) => (item.summary ? [[item.key, item.summary] as const] : [])));

  const run = (work: Promise<unknown>, fallback: string) => {
    setNotice(null);
    work.then(() => Promise.all([draftQuery.refetch(), signalQuery.refetch()])).catch((failure: unknown) => setNotice(errorText(failure, fallback)));
  };
  const onLoad = () => chosen && run(loadDraft({ variables: { sprintId: chosen.id } }), 'The sprint could not be loaded from Jira');
  const onChange = (key: string, change: { dev?: string | null; wave?: number; sp?: number }) => draft && run(updateTicket({ variables: { sprint: draft.sprint, key, ...change } }), 'The ticket could not be changed');
  const onDecide = (id: string, action: string, note?: string) => draft && run(decide({ variables: { sprint: draft.sprint, id, action, note: note ?? null } }), 'The decision could not be saved');
  const onRefreshQa = () => draft && run(refreshQa({ variables: { sprint: draft.sprint } }), 'The QA check failed');
  const onCheckStoryboards = () => draft && run(checkStoryboards({ variables: { sprint: draft.sprint } }), 'The storyboard could not be read');
  const onSaveTcs = async (key: string, tcs: DraftTc[]) => {
    if (!draft) return false;
    setNotice(null);
    try {
      await saveTcs({ variables: { sprint: draft.sprint, key, tcs } });
      await draftQuery.refetch();
      return true;
    } catch (failure) {
      setNotice(errorText(failure, 'The test cases could not be saved'));
      return false;
    }
  };
  const onMove = (keys: string[], to: string) => draft && run(moveCards({ variables: { sprint: draft.sprint, keys, to } }), 'The cards could not be moved');
  const onPublish = async () => {
    if (!draft) return;
    setResults(null);
    setPublishError(null);
    setPublishOpen(true);
    const answer = await preview({ variables: { sprint: draft.sprint } });
    if (answer.error) setPublishError(answer.error.message);
  };
  // A republish reads the sprint from Jira again first: the joined ticket and the changed AC come into the draft.
  const onRepublish = async () => {
    if (!chosen) return;
    setNotice(null);
    try {
      await loadDraft({ variables: { sprintId: chosen.id } });
      await draftQuery.refetch();
      await onPublish();
    } catch (failure) {
      setNotice(errorText(failure, 'The sprint could not be loaded from Jira'));
    }
  };
  const onConfirm = async () => {
    if (!draft) return;
    try {
      const answer = await publish({ variables: { sprint: draft.sprint } });
      setResults(answer.data?.publishSprintDraft ?? []);
      await Promise.all([draftQuery.refetch(), signalQuery.refetch()]);
    } catch (failure) {
      setPublishError(errorText(failure, 'Publish failed'));
    }
  };

  if (sprints.error && !sprints.data) return <p className="text-sm text-status-conflict" role="alert">{sprints.error.message}</p>;
  if (!sprints.data && sprints.loading) return <p className="text-sm text-muted-foreground" role="status">Loading the board's sprints...</p>;
  if (!chosen) return <p className="text-sm text-muted-foreground">No active or future sprint on the board. Create the sprint in Jira, then come back.</p>;
  const escalated = draft?.tickets.filter((ticket) => ticket.prediction?.prediction === 'ESCALATED').length ?? 0;
  const late = draft?.findings.filter((finding) => finding.kind === 'after-it').length ?? 0;
  const storyboardChecks = draft ? uncheckedStoryboard(draft).length : 0;
  const ready = draft ? publishReadiness(draft, flow) : null;
  const showPanel = (next: PlanningPanel) => {
    setPanel(next);
    const params = new URLSearchParams(window.location.search);
    params.set('panel', next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Sprint to plan" className="w-[260px] max-[760px]:w-full" value={String(chosen.id)} onValueChange={(value) => setSprintId(Number(value))} options={options.map((sprint) => ({ value: String(sprint.id), label: `${sprint.name}${sprint.state === 'active' ? ' (active)' : ''}` }))} />
        <Button onClick={onLoad} disabled={busy}><Download size={14} aria-hidden="true" />{loading.loading ? 'Loading...' : draft ? 'Load again from Jira' : 'Load from Jira'}</Button>
        <PlanningChat sprint={chosen.name} />
      </div>
      <PlanningStatus
        sprint={chosen.name}
        signal={signal}
        draft={draft}
        ready={ready}
        busy={busy}
        onPublish={() => void onPublish()}
        onRepublish={() => void onRepublish()}
        onOpenChat={() => void chat.open()}
        onShowReady={() => document.getElementById(readyId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />
      {chat.error && <p className="text-sm text-status-conflict" role="alert">{chat.error}</p>}
      {signal && !planner && <DeveloperOrder signal={signal} />}
      {notice && <p className="text-sm text-status-conflict" role="alert">{notice}</p>}
      {draftQuery.error && !draft && <p className="text-sm text-status-conflict" role="alert">{draftQuery.error.message}</p>}

      {!draft ? (
        <section className="grid gap-3 border-y border-border py-6" aria-label="No draft yet">
          <p className="text-sm text-muted-foreground">{chosen.name} has no draft yet. Load it from Jira to see the team's lanes, the scope cut, the AC check and the QA check.</p>
        </section>
      ) : (
        <>
          <p className="text-[0.8rem] text-muted-foreground">
            {draft.tickets.length} open tickets{draft.landed > 0 && ` (${draft.landed} already past merge)`} · {draft.sprintDays} working days · {draft.devs.length} developers · {late} AC {late === 1 ? 'line' : 'lines'} after it · {escalated} ESCALATED{storyboardChecks > 0 && ` · ${storyboardChecks} AC to check after a storyboard change`} · {publishHint(draft)}
          </p>
          {ready && <ReadyBlock id={readyId} ready={ready} onFix={showPanel} />}
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Planning panel">
            {panels.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={shown === id}
                onClick={() => showPanel(id)}
                className={cn('h-7 rounded-xs border border-border bg-surface-1 px-3 font-display text-xs font-semibold text-secondary-foreground max-[760px]:h-11', shown === id && 'border-accent bg-accent text-black')}
              >
                {label}
              </button>
            ))}
          </div>
          {/* A developer's DOCK reads the planner's draft: every control in the panels is disabled. */}
          {shown === 'mine' && <MyTicketsPanel draft={draft} me={me} summaries={summaries} onOpenTicket={openTicket} />}
          <fieldset disabled={!planner} className="contents">
          {shown === 'team' && <TeamPanel draft={draft} plan={full?.tickets ?? []} busy={busy} onMove={onMove} />}
          {shown === 'scope' && <ScopePanel draft={draft} busy={busy} onChange={onChange} onDecide={onDecide} />}
          {shown === 'ac' && <AcPanel draft={draft} busy={busy} onDecide={onDecide} />}
          {shown === 'qa' && <QaPanel draft={draft} busy={busy} summaries={summaries} onDecide={onDecide} onRefresh={onRefreshQa} onTestCases={() => showPanel('tc')} />}
          {shown === 'tc' && <TcPanel draft={draft} busy={busy} onSave={onSaveTcs} onDecide={onDecide} />}
          {shown === 'storyboard' && <StoryboardBoard draft={draft} busy={busy} onCheck={onCheckStoryboards} onDecide={onDecide} />}
          </fieldset>
        </>
      )}
      <PublishDialog
        open={publishOpen}
        sprint={draft?.sprint ?? ''}
        changes={previewing.loading ? null : previewing.data?.previewSprintDraftPublish ?? null}
        results={results}
        loading={previewing.loading}
        publishing={publishing.loading}
        error={publishError}
        missing={ready?.missing ?? []}
        onConfirm={() => void onConfirm()}
        onClose={() => setPublishOpen(false)}
        onFix={() => {
          setPublishOpen(false);
          if (ready?.missing[0]) showPanel(ready.missing[0].panel);
        }}
      />
    </div>
  );
};
