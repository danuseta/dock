import React, { useEffect, useId, useState } from 'react';
import { useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { ArrowRightLeft, Check, Clock, Download, EyeOff, FileSearch, Minus, Plus, RefreshCw, Scissors, Send, ShieldAlert, ShieldCheck, Undo2, X } from 'lucide-react';
import { Button, Card, Dialog, Input, Select, Textarea } from '../components/ui';
import { PlanningChat } from './PlanningChat';
import {
  ANSWER_SPRINT_DRAFT_QUESTION, CHECK_SPRINT_STORYBOARDS, DECIDE_SPRINT_DRAFT, SET_SPRINT_DRAFT_TCS, GET_PLANNING_SPRINTS, GET_SPRINT_DRAFT, LOAD_SPRINT_DRAFT, PREVIEW_SPRINT_DRAFT_PUBLISH, PUBLISH_SPRINT_DRAFT,
  REFRESH_SPRINT_DRAFT_QA, UPDATE_SPRINT_DRAFT_TICKET,
} from '../graphql/queries';
import { cn } from '../lib/cn';
import {
  UNASSIGNED, barPlace, changeCount, dayOf, decisionLabel, findingKindLabel, forecastOf, handOffs, lateDays, lateText, shortDate, underWay, landingDay, lanes, openQuestionsOf, parseWave, ranks, softColor, teamStats, waitersOf, predictionTone, publishHint, scopeSummary, sortFindings,
  questionsLine, spanOf, storyboardDecisionId, storyboardLine, tcsToText, textToTcs, uncheckedStoryboard, waveRows, workingDayLabels,
  type DraftChange, type DraftFinding, type DraftTc, type DraftTicket, type PlanningPanel, type PlanningSprint, type PublishResult, type SprintDraft,
} from './planning';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const chip = 'rounded-xs border px-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em]';
const NO_DEV = '__none';
const TONE: Record<string, string> = {
  ok: 'border-status-merged text-status-merged', conflict: 'border-status-conflict text-status-conflict', warn: 'border-status-warn text-status-warn', none: 'border-border text-muted-foreground',
};
const PANELS: Array<[PlanningPanel, string]> = [['team', 'Team map'], ['scope', 'Scope'], ['ac', 'AC check'], ['qa', 'QA check'], ['tc', 'Test cases'], ['storyboard', 'Storyboard']];

const errorText = (failure: unknown, fallback: string) => (failure instanceof Error ? failure.message : fallback);

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

const StoryboardPanel: React.FC<{ draft: SprintDraft; busy: boolean; onCheck: () => void; onDecide: (id: string, action: string, note?: string) => void }> = ({ draft, busy, onCheck, onDecide }) => {
  const flagged = draft.tickets.filter((ticket) => ticket.storyboard);
  const epics = [...new Set(draft.tickets.map((ticket) => ticket.epic).filter(Boolean))];
  return (
    <section aria-label="Storyboard" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-pretty text-[0.8rem] text-muted-foreground">Each epic's Confluence page "Storyboard" holds one HTML attachment per version. DOCK saves every version under the blackboard and compares the newest two frame by frame; a ticket whose AC or description names a changed frame needs its AC checked.</p>
        <Button size="sm" onClick={onCheck} disabled={busy}><FileSearch size={13} aria-hidden="true" />Check storyboard</Button>
      </div>
      {draft.storyboards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{epics.length ? 'No storyboard read yet. Check storyboard reads it from Confluence.' : 'No ticket of this sprint has an epic, so there is no storyboard to read.'}</p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-border bg-surface-0">
          {draft.storyboards.map((board) => (
            <li key={board.epic} className="border-b border-border px-3 py-2.5 last:border-b-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem]">
                <span className="font-mono font-semibold">{board.epic}</span>
                <span className={cn(chip, board.error ? TONE.warn : board.changed.length ? TONE.conflict : TONE.ok)}>{board.error ? 'No storyboard' : `v${board.version}`}</span>
              </p>
              <p className={cn('mt-1 text-pretty text-[0.76rem]', board.error ? 'text-status-warn' : 'text-muted-foreground')}>{storyboardLine(board)}</p>
              {board.path && <p className="mt-0.5 break-all font-mono text-[0.64rem] text-muted-foreground">{board.path}</p>}
            </li>
          ))}
        </ul>
      )}
      {flagged.length > 0 && (
        <ul className="overflow-hidden rounded-md border border-border bg-surface-0">
          {flagged.map((ticket) => (
            <li key={ticket.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem]"><span className="font-mono font-semibold">{ticket.key}</span><StoryboardChip ticket={ticket} /><span className="text-muted-foreground">{ticket.status}</span></p>
                <p className="mt-0.5 truncate text-[0.78rem] text-secondary-foreground">{ticket.summary}</p>
              </div>
              <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
                {ticket.storyboard!.checked
                  ? <Button size="sm" variant="ghost" onClick={() => onDecide(storyboardDecisionId(ticket.key, ticket.storyboard!.version), 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
                  : <Button size="sm" variant="primary" onClick={() => onDecide(storyboardDecisionId(ticket.key, ticket.storyboard!.version), 'checked')} disabled={busy}><Check size={13} aria-hidden="true" />AC checked</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/** What the planning chat could not settle; the planner marks each answered once it is. */
const Questions: React.FC<{ draft: SprintDraft; busy: boolean; onAnswer: (id: string, answered: boolean) => void }> = ({ draft, busy, onAnswer }) => {
  const line = questionsLine(draft.questions);
  if (!line) return null;
  const ordered = [...draft.questions].sort((a, b) => Number(a.answered) - Number(b.answered));
  return (
    <section aria-label="Open questions" className="min-w-0">
      <h3 className={head}>Open questions · {line}</h3>
      <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
        {ordered.map((question) => (
          <li key={question.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border px-3 py-2 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]', question.answered && 'opacity-70')}>
            <p className="min-w-0 text-pretty text-[0.8rem] text-secondary-foreground">
              {question.key && <span className="mr-2 font-mono font-semibold text-foreground">{question.key}</span>}
              {question.text}
              {question.answered && question.answeredBy && <span className="ml-2 font-mono text-[0.64rem] text-muted-foreground">answered · {question.answeredBy}</span>}
            </p>
            <div className="flex justify-end max-[760px]:justify-start">
              {question.answered
                ? <Button size="sm" variant="ghost" onClick={() => onAnswer(question.id, false)} disabled={busy}><Undo2 size={13} aria-hidden="true" />Reopen</Button>
                : <Button size="sm" onClick={() => onAnswer(question.id, true)} disabled={busy}><Check size={13} aria-hidden="true" />Answered</Button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

const TcTicket: React.FC<{ ticket: DraftTicket; busy: boolean; onSave: (key: string, tcs: DraftTc[]) => Promise<boolean> }> = ({ ticket, busy, onSave }) => {
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
        {!editing && <Button size="sm" variant="ghost" onClick={start} disabled={busy}>Edit</Button>}
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

const TcPanel: React.FC<{ draft: SprintDraft; busy: boolean; onSave: (key: string, tcs: DraftTc[]) => Promise<boolean> }> = ({ draft, busy, onSave }) => (
  <section aria-label="Test cases" className="grid grid-cols-[minmax(0,1fr)] gap-3">
    <p className="text-pretty text-[0.8rem] text-muted-foreground">Draft test cases per ticket, written by the planning agent or here. Publish posts a ticket's set as a QONFLO-TC v1 comment when it changed; local QA and the QA bot read the newest one.</p>
    <ul className="overflow-hidden rounded-md border border-border bg-surface-0">
      {[...draft.tickets].sort((a, b) => Number(b.tcStale) - Number(a.tcStale) || a.key.localeCompare(b.key, undefined, { numeric: true })).map((ticket) => <TcTicket key={ticket.key} ticket={ticket} busy={busy} onSave={onSave} />)}
    </ul>
  </section>
);

const fmt = (value: number) => String(Math.round(value * 10) / 10);
const plainSummary = (summary: string) => summary.replace(/^(\[[^\]]+\]\s*)+/, '');
const HATCH = 'repeating-linear-gradient(135deg, transparent 0 5px, var(--color-border) 5px 6px)';

/** The team map: load per developer, wave progress, the day-by-day board, each person's order of work and the hand-offs. */
const TeamPanel: React.FC<{ draft: SprintDraft }> = ({ draft }) => {
  const [picked, setPicked] = useState<string | null>(null);
  const span = spanOf(draft);
  const labels = workingDayLabels(draft.startDate, span);
  const rows = lanes(draft);
  const colorOf = new Map(rows.map((lane) => [lane.dev, lane.color]));
  const color = (dev: string | null) => colorOf.get(dev ?? UNASSIGNED) ?? 'var(--color-muted-foreground)';
  const waves = waveRows(draft);
  const rank = ranks(draft.tickets);
  const waiters = waitersOf(draft.tickets);
  const questions = openQuestionsOf(draft.questions);
  const stats = teamStats(draft);
  const hand = handOffs(draft.tickets);
  const byKey = new Map(draft.tickets.map((ticket) => [ticket.key, ticket]));
  const pct = (days: number) => `${(days / span) * 100}%`;
  const dateOf = (day: number) => labels[day - 1] ?? null;
  const lands = (end: number) => { const day = landingDay(end); return `day ${day}${dateOf(day) ? ` · ${dateOf(day)}` : ''}`; };
  const starts = (start: number) => { const day = Math.floor(start + 1e-9) + 1; return `day ${day}${dateOf(day) ? ` · ${dateOf(day)}` : ''}`; };
  const after = (ticket: DraftTicket) => ticket.end > draft.sprintDays + 1e-9;
  const today = draft.today && draft.today <= span ? draft.today : null;
  const forecast = forecastOf(draft);
  const live = underWay(draft);
  const dayDate = (day: number) => dateOf(day) ?? `day ${day}`;
  const shortDay = (day: number) => { const label = dateOf(day); return label ? shortDate(label) : `day ${day}`; };
  const forecastColor = forecast.late > 0 ? 'var(--color-status-conflict)' : 'var(--color-status-merged)';
  const lateTone = forecast.late > 0 ? 'text-status-conflict' : 'text-status-merged';
  // A line at the very end of the span stays inside its clipped row.
  const lineAt = (days: number) => `min(${pct(days)}, calc(100% - 2px))`;
  const dueLabel = `Sprint ends · ${dayDate(forecast.due)}`;
  const forecastLabel = `Forecast · ${dayDate(forecast.day)}`;
  const selected = picked ? byKey.get(picked) ?? null : null;
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
          {rows.map((lane) => {
            const laneDay = landingDay(lane.end);
            const laneLate = lateDays(draft.sprintDays, laneDay);
            return (
            <div key={lane.dev} className="min-w-0 rounded-md border border-border border-t-[3px] bg-surface-0 px-3 py-2.5" style={{ borderTopColor: lane.color }}>
              <b className="block truncate font-display text-[0.9rem]" style={{ color: lane.color }}>{lane.dev}</b>
              <p className="mt-1.5 font-mono text-[1.2rem] font-semibold tabular-nums">{lane.sp}<span className="text-[0.7rem] font-normal text-muted-foreground"> SP · {lane.tickets.length} {lane.tickets.length === 1 ? 'card' : 'cards'}</span></p>
              {live && <p className="font-mono text-[0.68rem] text-muted-foreground">left <b className="text-secondary-foreground">{fmt(lane.left)}</b> of {fmt(lane.sp)} SP</p>}
              <span className="relative mt-2 block h-1.5 overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
                <span className="absolute inset-y-0 left-0" style={{ width: pct(lane.end), background: lane.color }} />
                <span className="absolute -inset-y-0.5 w-0.5 bg-foreground" style={{ left: pct(draft.sprintDays) }} />
              </span>
              <p className="mt-2 text-[0.72rem] text-muted-foreground">Ends <b className="text-secondary-foreground">{lands(lane.end)}</b>. In sprint: <b className="text-secondary-foreground">{lane.inSprintSp} SP</b>.</p>
              <p className="mt-1 font-mono text-[0.66rem] text-muted-foreground">
                Due {shortDay(draft.sprintDays)} · forecast {shortDay(laneDay)}{laneLate > 0 && <b className="text-status-conflict"> · {lateText(laneLate)}</b>}
              </p>
            </div>
            );
          })}
        </div>
      </section>

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
        <p className="mt-2 max-w-[76ch] text-pretty text-[0.8rem] text-muted-foreground">One row per developer from day 1. The tag is the owner's rank and the card's wave: <b className="text-foreground">#3·W2</b> is that person's third card, from wave 2. The hatched days are after the sprint. Click a card to see what it waits on and what waits on it.</p>
        <div className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
          <div className="overflow-x-auto">
            <div style={{ minWidth: `${112 + span * 58}px` }}>
              <div className="flex border-b border-border bg-surface-1 pl-[112px]">
                {Array.from({ length: span }, (_, index) => (
                  <div key={index} className={cn('min-w-0 flex-1 overflow-hidden whitespace-nowrap border-l border-border px-1.5 py-1.5 font-mono text-[0.58rem] text-muted-foreground', today === index + 1 && 'text-accent')} style={index >= draft.sprintDays ? { backgroundImage: HATCH } : undefined}>
                    <b className={cn('block', today === index + 1 ? 'text-accent' : 'text-secondary-foreground')}>D{index + 1}{today === index + 1 ? ' · today' : ''}</b>{labels[index] ?? ''}
                  </div>
                ))}
              </div>
              <div className="flex border-b border-border">
                <div className="w-[112px] flex-none border-r border-border bg-surface-1" />
                <div className="relative h-9 flex-1">
                  <span className="absolute inset-y-0 z-[2] w-0.5 bg-foreground/75" style={{ left: lineAt(draft.sprintDays) }} aria-hidden="true" />
                  <span className="absolute inset-y-0 z-[2] border-l-2 border-dashed" style={{ left: lineAt(forecast.end), borderColor: forecastColor }} aria-hidden="true" />
                  {([[draft.sprintDays, dueLabel, 'var(--color-foreground)', 3], [forecast.end, forecastLabel, forecastColor, 19]] as const).map(([at, text, tone, top]) => (
                    <span key={text} className="absolute whitespace-nowrap font-mono text-[0.6rem] font-semibold" style={{ top, left: pct(at), color: tone, transform: at / span > 0.5 ? 'translateX(calc(-100% - 5px))' : 'translateX(5px)' }}>{text}</span>
                  ))}
                </div>
              </div>
              {rows.map((lane) => (
                <div key={lane.dev} className="flex min-h-[58px] border-b border-border last:border-b-0">
                  <div className="w-[112px] flex-none border-r border-border bg-surface-1 px-3 py-2.5">
                    <b className="block truncate font-display text-[0.84rem]" style={{ color: lane.color }}>{lane.dev}</b>
                    <span className="font-mono text-[0.6rem] text-muted-foreground">{lane.sp} SP</span>
                  </div>
                  <div className="relative flex-1">
                    {Array.from({ length: span }, (_, index) => <span key={index} className="absolute inset-y-0 w-px bg-border/60" style={{ left: pct(index) }} aria-hidden="true" />)}
                    <span className="absolute inset-y-0 z-[2] w-0.5 bg-foreground/75" style={{ left: lineAt(draft.sprintDays) }} aria-hidden="true" />
                    <span className="absolute inset-y-0 z-[2] border-l-2 border-dashed" style={{ left: lineAt(forecast.end), borderColor: forecastColor }} aria-hidden="true" />
                    {today && <span className="absolute inset-y-0 z-[2] w-0.5 bg-accent" style={{ left: pct(today - 1) }} aria-hidden="true" />}
                    {lane.tickets.map((ticket) => {
                      const place = barPlace(ticket, span);
                      const asks = questions.get(ticket.key)?.length ?? 0;
                      const isPicked = picked === ticket.key;
                      const related = !selected || isPicked || waitsOn.includes(ticket.key) || waiting.includes(ticket.key);
                      return (
                        <button
                          key={ticket.key}
                          type="button"
                          aria-pressed={isPicked}
                          onClick={() => setPicked(isPicked ? null : ticket.key)}
                          className={cn(
                            'absolute top-[9px] z-[3] h-10 overflow-hidden rounded-[7px] border px-1.5 py-1 text-left transition-[opacity,transform] hover:-translate-y-px',
                            !related && 'opacity-25',
                            isPicked && 'outline outline-2 outline-offset-1 outline-foreground',
                          )}
                          style={{
                            left: `calc(${place.left} + 2px)`, width: `calc(${place.width} - 4px)`, borderColor: lane.color, background: softColor(lane.color),
                            boxShadow: [asks ? 'inset 3px 0 0 var(--color-status-conflict)' : '', selected && waitsOn.includes(ticket.key) ? 'inset 0 0 0 2px var(--color-status-conflict)' : ''].filter(Boolean).join(', ') || undefined,
                          }}
                          title={`${ticket.key} · ${ticket.summary}`}
                        >
                          <span className="flex justify-between gap-1 whitespace-nowrap font-mono text-[10px] font-semibold" style={{ color: lane.color }}>
                            <span>{ticket.key.replace(/^[A-Z]+-/, '')}</span><span className="opacity-75">#{rank.get(ticket.key)}·W{ticket.wave}</span>
                          </span>
                          <span className="line-clamp-2 block text-[10px] leading-tight text-secondary-foreground">{plainSummary(ticket.summary)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="min-h-[72px] border-t border-border bg-surface-1 px-4 py-3" aria-live="polite">
            {!selected ? (
              <p className="font-mono text-[0.68rem] text-muted-foreground">Click a card to see its blockers, the cards waiting on it and its open questions.</p>
            ) : (
              <div className="grid gap-2">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 font-mono text-[0.68rem] text-muted-foreground">
                    <b className="text-[0.74rem]" style={{ color: color(selected.dev) }}>{selected.key}</b> · {selected.dev ?? UNASSIGNED} · {selected.sp ?? '?'} SP · wave {selected.wave} · #{rank.get(selected.key)}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(null)} aria-label="Close the card details"><X size={13} aria-hidden="true" /></Button>
                </div>
                <h4 className="text-balance font-display text-[0.95rem] font-semibold">{selected.summary}</h4>
                <p className="text-pretty text-[0.8rem] text-secondary-foreground">Starts {starts(selected.start)}, lands {lands(selected.end)}.{after(selected) && <b className="text-foreground"> Runs past the sprint.</b>}</p>
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
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.7rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-status-conflict bg-status-conflict-bg shadow-[inset_3px_0_0_var(--color-status-conflict)]" aria-hidden="true" />red left edge = open question</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-foreground" aria-hidden="true" />{dueLabel}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 border-l-2 border-dashed" style={{ borderColor: forecastColor }} aria-hidden="true" />{forecastLabel}</span>
          {today && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-accent" aria-hidden="true" />today</span>}
          <span className="inline-flex items-center gap-1.5"><span className="rounded-xs border border-secondary-foreground px-1 font-mono text-[0.6rem] font-semibold text-secondary-foreground">#1·W1</span>owner's first card, wave 1</span>
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

const ScopePanel: React.FC<{ draft: SprintDraft; busy: boolean; onChange: (key: string, change: { dev?: string | null; wave?: number; sp?: number }) => void }> = ({ draft, busy, onChange }) => {
  const summary = scopeSummary(draft);
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
    </div>
  );
};

const FindingRow: React.FC<{ draft: SprintDraft; finding: DraftFinding; busy: boolean; onDecide: (id: string, action: string, note?: string) => void }> = ({ draft, finding, busy, onDecide }) => {
  const late = finding.kind === 'after-it';
  const owner = draft.tickets.find((ticket) => ticket.key === finding.refKey)?.dev;
  const inPlan = draft.tickets.some((ticket) => ticket.key === finding.refKey);
  const when = finding.refEnd !== null && finding.ownEnd !== null ? `lands ${dayOf(finding.refEnd)}, ${finding.key} lands ${dayOf(finding.ownEnd)}` : null;
  const decided = decisionLabel(finding.decision, finding.refKey);
  return (
    <li className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]', late && !finding.decision ? 'border-l-2 border-l-status-warn' : !late && 'opacity-70')}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-secondary-foreground">
          <span className="font-mono font-semibold text-foreground">{finding.key}</span>
          <span className={cn(chip, late ? TONE.warn : TONE.none)}>AC {finding.line}</span>
          <span>needs <span className="font-mono font-semibold text-foreground">{finding.refKey}</span>{owner ? ` · ${owner}` : ''}</span>
          {when && <span className="text-muted-foreground">· {when}</span>}
          <span className={cn(chip, late ? TONE.conflict : finding.kind === 'lands-first' ? TONE.ok : TONE.none)}>{findingKindLabel(finding.kind)}</span>
        </p>
        <p className="mt-1 text-pretty text-[0.76rem] text-muted-foreground">{finding.text}</p>
      </div>
      <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
        {decided ? (
          <>
            <span className="self-center font-mono text-[0.64rem] text-muted-foreground">{decided}{finding.decision?.by ? ` · ${finding.decision.by}` : ''}</span>
            <Button size="sm" variant="ghost" onClick={() => onDecide(finding.id, 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
          </>
        ) : late ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => onDecide(finding.id, 'wait')} disabled={busy}><Clock size={13} aria-hidden="true" />Keep and wait</Button>
            <Button size="sm" onClick={() => onDecide(finding.id, 'drop')} disabled={busy}><EyeOff size={13} aria-hidden="true" />Drop</Button>
            {inPlan && <Button size="sm" variant="primary" onClick={() => onDecide(finding.id, 'move')} disabled={busy}><ArrowRightLeft size={13} aria-hidden="true" />Move to {finding.refKey}</Button>}
          </>
        ) : <span className="font-mono text-[0.64rem] text-muted-foreground">kept</span>}
      </div>
    </li>
  );
};

const AcPanel: React.FC<{ draft: SprintDraft; busy: boolean; onDecide: (id: string, action: string, note?: string) => void }> = ({ draft, busy, onDecide }) => {
  const findings = sortFindings(draft.findings);
  const late = findings.filter((finding) => finding.kind === 'after-it');
  if (!findings.length) return <p className="text-sm text-muted-foreground">No AC line names another ticket.</p>;
  return (
    <section aria-label="AC check">
      <p className="text-[0.84rem] text-secondary-foreground">
        <b className="text-foreground">{late.length}</b> AC {late.length === 1 ? 'line needs' : 'lines need'} a ticket that lands after it; {late.filter((finding) => !finding.decision).length} still to decide.
      </p>
      <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
        {findings.map((finding) => <FindingRow key={finding.id} draft={draft} finding={finding} busy={busy} onDecide={onDecide} />)}
      </ul>
    </section>
  );
};

const QaPanel: React.FC<{ draft: SprintDraft; busy: boolean; onDecide: (id: string, action: string, note?: string) => void; onRefresh: () => void }> = ({ draft, busy, onDecide, onRefresh }) => {
  const [fixing, setFixing] = useState<string | null>(null);
  const [note, setNote] = useState('');
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

const PublishDialog: React.FC<{
  open: boolean; sprint: string; changes: DraftChange[] | null; results: PublishResult[] | null; loading: boolean; publishing: boolean; error: string | null; onConfirm: () => void; onClose: () => void;
}> = ({ open, sprint, changes, results, loading, publishing, error, onConfirm, onClose }) => {
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
            <p className="mt-2 text-pretty text-sm text-muted-foreground">Only what differs from Jira now is written: AC lines and assignees. A ticket whose AC changed in Jira since it was loaded is skipped. The Confluence page "Sprint contract {sprint}" is written too, under the parent page set in Settings › Jira, and every changed set of test cases is posted as a QONFLO-TC v1 comment.</p>
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
          <Button onClick={onClose} disabled={publishing}>{results ? 'Close' : 'Cancel'}</Button>
          {!results && <Button variant="primary" onClick={onConfirm} disabled={publishing || loading || !changes}><Send size={14} aria-hidden="true" />{publishing ? 'Publishing...' : count ? `Publish ${count} ${count === 1 ? 'ticket' : 'tickets'}` : 'Publish'}</Button>}
        </div>
      </Card>
    </Dialog>
  );
};

/** Plans a sprint from Jira: the team's lanes, the scope cut, the AC lines that need a later ticket, the QA bot's call, then Publish. */
export const PlanningTab: React.FC = () => {
  const [sprintId, setSprintId] = useState<number | null>(null);
  const [panel, setPanel] = useState<PlanningPanel>('team');
  const [notice, setNotice] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [results, setResults] = useState<PublishResult[] | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const sprints = useQuery<{ planningSprints: PlanningSprint[] }>(GET_PLANNING_SPRINTS, { fetchPolicy: 'cache-and-network' });
  const options = sprints.data?.planningSprints ?? [];
  const chosen = options.find((sprint) => sprint.id === sprintId) ?? options.find((sprint) => sprint.state === 'future') ?? options[0] ?? null;
  // The planning chat changes the draft through DOCK's ingest routes, so the panel polls it like Plan does.
  const draftQuery = useQuery<{ sprintDraft: SprintDraft | null }>(GET_SPRINT_DRAFT, { variables: { sprint: chosen?.name ?? '' }, skip: !chosen, fetchPolicy: 'cache-and-network', pollInterval: 10000 });
  const [loadDraft, loading] = useMutation(LOAD_SPRINT_DRAFT);
  const [updateTicket, updating] = useMutation(UPDATE_SPRINT_DRAFT_TICKET);
  const [decide, deciding] = useMutation(DECIDE_SPRINT_DRAFT);
  const [refreshQa, refreshing] = useMutation(REFRESH_SPRINT_DRAFT_QA);
  const [checkStoryboards, checking] = useMutation(CHECK_SPRINT_STORYBOARDS);
  const [answerQuestion, answering] = useMutation(ANSWER_SPRINT_DRAFT_QUESTION);
  const [saveTcs, savingTcs] = useMutation(SET_SPRINT_DRAFT_TCS);
  const [publish, publishing] = useMutation(PUBLISH_SPRINT_DRAFT);
  const [preview, previewing] = useLazyQuery<{ previewSprintDraftPublish: DraftChange[] }>(PREVIEW_SPRINT_DRAFT_PUBLISH, { fetchPolicy: 'network-only' });
  const draft = draftQuery.data?.sprintDraft ?? null;
  const busy = loading.loading || updating.loading || deciding.loading || refreshing.loading || publishing.loading || checking.loading || answering.loading || savingTcs.loading;

  const run = (work: Promise<unknown>, fallback: string) => {
    setNotice(null);
    work.then(() => draftQuery.refetch()).catch((failure: unknown) => setNotice(errorText(failure, fallback)));
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
  const onAnswer = (id: string, answered: boolean) => draft && run(answerQuestion({ variables: { sprint: draft.sprint, id, answered } }), 'The question could not be saved');
  const onPublish = async () => {
    if (!draft) return;
    setResults(null);
    setPublishError(null);
    setPublishOpen(true);
    const answer = await preview({ variables: { sprint: draft.sprint } });
    if (answer.error) setPublishError(answer.error.message);
  };
  const onConfirm = async () => {
    if (!draft) return;
    try {
      const answer = await publish({ variables: { sprint: draft.sprint } });
      setResults(answer.data?.publishSprintDraft ?? []);
      await draftQuery.refetch();
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

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
    <PlanningChat sprint={chosen.name} />
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Sprint to plan" className="w-[260px] max-[760px]:w-full" value={String(chosen.id)} onValueChange={(value) => setSprintId(Number(value))} options={options.map((sprint) => ({ value: String(sprint.id), label: `${sprint.name}${sprint.state === 'active' ? ' (active)' : ''}` }))} />
        <Button onClick={onLoad} disabled={busy}><Download size={14} aria-hidden="true" />{loading.loading ? 'Loading...' : draft ? 'Load again from Jira' : 'Load from Jira'}</Button>
        {draft && <span className={cn(chip, draft.status === 'published' ? TONE.ok : 'border-accent text-accent')}>{draft.status === 'published' ? 'Published' : 'Draft'}</span>}
        {draft && (
          <Button className="ml-auto max-[760px]:ml-0 max-[760px]:w-full" variant="primary" onClick={() => void onPublish()} disabled={busy || !draft.canPublish} title={publishHint(draft)}>
            <Send size={14} aria-hidden="true" />Publish
          </Button>
        )}
      </div>
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
          <Questions draft={draft} busy={busy} onAnswer={onAnswer} />
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Planning panel">
            {PANELS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={panel === id}
                onClick={() => setPanel(id)}
                className={cn('h-7 rounded-xs border border-border bg-surface-1 px-3 font-display text-xs font-semibold text-secondary-foreground max-[760px]:h-11', panel === id && 'border-accent bg-accent text-black')}
              >
                {label}
              </button>
            ))}
          </div>
          {panel === 'team' && <TeamPanel draft={draft} />}
          {panel === 'scope' && <ScopePanel draft={draft} busy={busy} onChange={onChange} />}
          {panel === 'ac' && <AcPanel draft={draft} busy={busy} onDecide={onDecide} />}
          {panel === 'qa' && <QaPanel draft={draft} busy={busy} onDecide={onDecide} onRefresh={onRefreshQa} />}
          {panel === 'tc' && <TcPanel draft={draft} busy={busy} onSave={onSaveTcs} />}
          {panel === 'storyboard' && <StoryboardPanel draft={draft} busy={busy} onCheck={onCheckStoryboards} onDecide={onDecide} />}
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
        onConfirm={() => void onConfirm()}
        onClose={() => setPublishOpen(false)}
      />
    </div>
    </div>
  );
};
