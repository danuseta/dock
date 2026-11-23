import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { AlertCircle, AlertTriangle, ArrowRightLeft, BarChart3, CalendarRange, CheckCircle2, Download, FileInput, FilePlus2, Languages, LayoutGrid, Link2, Minus, PenLine, Plus, Scissors, Send, Undo2, X } from 'lucide-react';
import { Button, Card, Dialog, Input, Select } from '../components/ui';
import { PlanningChat } from './PlanningChat';
import { usePlanningSession } from './usePlanningChat';
import { DeveloperOrder, PlanningStatus, PlanningStatusNote } from './PlanningStatus';
import { PlanningBoard } from './PlanningBoard';
import { PlanningBar } from './PlanningBar';
import { TicketsPanel } from './RevisionsPanel';
import { PlanTab } from './PlanTab';
import { StoryboardBoard } from './StoryboardBoard';
import { PlanningVisual } from './PlanningVisual';
import { MyTicketsPanel } from './MyTicketsPanel';
import {
  CHECK_SPRINT_STORYBOARDS, DECIDE_SPRINT_DRAFT, MOVE_SPRINT_DRAFT_CARDS, GET_OWNER_NAME, GET_PLANNING_FLOW, GET_PLANNING_SPRINTS, GET_SPRINT_DRAFT, GET_SPRINT_DRAFT_VISUALS, GET_SPRINT_PLAN_SIGNAL, GET_TICKET_READINESS, LOAD_SPRINT_DRAFT, PREVIEW_SPRINT_DRAFT_PUBLISH, PUBLISH_SPRINT_DRAFT,
  RUN_SCOUT, SAVE_SPRINT_DRAFT_VISUAL, DROP_SPRINT_DRAFT_VISUAL, UPDATE_SPRINT_DRAFT_TICKET, USE_SPRINT_DRAFT_SPLIT, KEEP_SPRINT_DRAFT_SPLIT, SAVE_SPRINT_DRAFT_NEW_TICKET, CREATE_SPRINT_DRAFT_NEW_TICKETS, REMOVE_SPRINT_DRAFT_NEW_TICKET,
  SAVE_SPRINT_DRAFT_REVISION, APPLY_SPRINT_DRAFT_REVISION, DISCARD_SPRINT_DRAFT_REVISION,
} from '../graphql/queries';
import { cn } from '../lib/cn';
import {
  UNASSIGNED, devColors, changeCount, dayOf, decisionLabel, findingKindLabel, forecastOf, handOffs, lateDays, lateText, shortDate, underWay, landingDay, lanes, openQuestionsOf, parseWave, ranks, teamStats, waitersOf, publishReadiness, scopeSummary, sortFindings,
  developerLine, freeFrom, githubLine, laneCount, laneOf, moveForecast, moveLine, planRange, scheduleWindow, scheduled, spanOf, waveRows, workingDayLabels,
  undecidedFinding, capacityOf,
  redoVisualPrompt, translatePrompt, acLineId, untranslatedKeys, draftSummaryText, type DraftChange, type DraftFinding, type DraftVisual, type DraftTicket, type LaneBar, type NewTicketInput, type PlanSignal, type PlanningPanel, type PlanningSprint, type PublishResult, type ReadyItem, type RevisionInput, type SprintDraft, type TicketSummaryLite,
} from './planning';
import { parseFlow, skippedStages } from './planningFlow';
import { panelOf } from './plan';
import { InfoTip } from './InfoTip';
import { ScoutCell } from './ScoutCell';
import { SplitRow } from './SplitBox';
import { CHAT_FOLDED_KEY, TEAM_VIEW_KEY, chatFoldedOf, chatFoldedValue, acGroups, belowStandardLines, keyParts, lineBadgeLabel, outsidePlanOpen, panelBadge, remember, remembered, teamViewOf, type BoardFilter, type TeamView } from './boardLogic';
import { humanizePrompt, type LintFinding } from '../lib/writing';
import { LineBadges } from './WritingFindings';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const chip = 'rounded-xs border px-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em]';
const NO_DEV = '__none';
const DRAFT_STALE_MS = 10 * 60 * 1000;
const TONE: Record<string, string> = {
  ok: 'border-status-merged text-status-merged', conflict: 'border-status-conflict text-status-conflict', warn: 'border-status-warn text-status-warn', none: 'border-border text-muted-foreground',
};
const PANELS: Array<[PlanningPanel, string]> = [['mine', 'My tickets'], ['team', 'Team map'], ['scope', 'Scope'], ['ac', 'AC check'], ['storyboard', 'Storyboard'], ['order', 'Order'], ['new', 'Tickets']];

const errorText = (failure: unknown, fallback: string) => (failure instanceof Error ? failure.message : fallback);
/** Opens the ticket page the way a link inside DOCK does: the app reads the new path on popstate. */
const openTicket = (key: string) => {
  window.history.pushState({}, '', `/ticket/${encodeURIComponent(key)}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
};



/** "AC needs a check" on a ticket naming a storyboard frame that changed. */
const StoryboardChip: React.FC<{ ticket: DraftTicket }> = ({ ticket }) => {
  const flag = ticket.storyboard;
  if (!flag) return null;
  const tone = flag.checked ? TONE.none : flag.held ? TONE.conflict : TONE.warn;
  return <span className={cn(chip, tone)} title={`Storyboard v${flag.version} changed ${flag.frames.join(', ')}`}>{flag.checked ? 'AC checked' : flag.held ? 'Held · AC needs a check' : 'AC needs a check'} · {flag.frames.join(' ')}</span>;
};

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
        {ticket.carried && <><dt className={row}>carried</dt><dd className="text-[var(--color-status-warn-ink)]">from an earlier sprint, not merged yet</dd></>}
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
        <p className="mt-2 text-pretty text-[0.8rem] text-muted-foreground">
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
          <h3 className={head}>Suggested card moves <InfoTip label="About suggested card moves">Cards waiting on that card move with it. A move only changes the draft; the Jira assignee changes on Publish.</InfoTip></h3>
          <p className="mt-1 text-pretty text-[0.8rem] text-muted-foreground">To Do cards that can move to someone who frees up sooner.</p>
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
        <h3 className={head}>Work waves <InfoTip label="About work waves">Each piece of a bar = one card on its scheduled days, in the card owner's colour.</InfoTip></h3>
        <p className="mt-1 text-pretty text-[0.8rem] text-muted-foreground">Wave 1 waits on no one, wave 2 waits on wave 1, and so on.</p>
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
        <h3 className={head}>Schedule per person <InfoTip label="About the schedule">Card length = SP, {fmt(draft.spPerDay)} SP = 1 day. Order follows the #N label in Jira. The forecast counts only the work left on unmerged cards, from today.</InfoTip></h3>
        <p className="mt-1 text-pretty text-[0.8rem] text-muted-foreground">Each person's order of work by day. Click a card to see what it waits on.</p>
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
                            <span>
                              {done && <span className="text-status-merged">✓ </span>}{ticket.key.replace(/^[A-Z]+-/, '')}
                              {ticket.carried && <span className="ml-1 rounded-xs bg-[var(--color-status-warn-pill)] px-1 text-[9px] font-semibold text-[var(--color-status-warn-ink)]">earlier sprint</span>}
                            </span>
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
          <span className="inline-flex items-center gap-1.5"><span className="inline-flex items-center gap-[3px] rounded-xs bg-[var(--color-status-warn-pill)] px-1 font-mono text-[0.6rem] font-semibold text-[var(--color-status-warn-ink)]"><AlertTriangle size={10} aria-hidden="true" />Jira says</span>Jira says merged, PR still open</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-l-4 border-border" aria-hidden="true" />faded ✓ = merged</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-l-4 border-status-conflict" style={{ borderLeftColor: 'var(--color-secondary-foreground)' }} aria-hidden="true" />red = late, its days passed but not merged</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] outline outline-1 outline-dashed outline-status-discord" aria-hidden="true" />moved in this draft</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-foreground" aria-hidden="true" />{dueLabel}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 border-l-2 border-dashed" style={{ borderColor: forecastColor }} aria-hidden="true" />{forecastLabel}</span>
          {planToday && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-status-discord" aria-hidden="true" />today</span>}
          <span className="inline-flex items-center gap-1.5"><span className="rounded-xs border border-secondary-foreground px-1 font-mono text-[0.6rem] font-semibold text-secondary-foreground">#1</span>order from the #N label in Jira</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-border" style={{ backgroundImage: HATCH }} aria-hidden="true" />hatched = past the sprint</span>
        </div>
      </section>

      <section aria-label="Order of work, per person" className="min-w-0">
        <h3 className={head}>Order of work <InfoTip label="About the order of work">Start days already follow blockers and wave order. The grey line on each card = who waits on that card. <b>after sprint</b> = finishes after day {draft.sprintDays}.</InfoTip></h3>
        <p className="mt-1 text-pretty text-[0.8rem] text-muted-foreground">Work from top to bottom.</p>
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
        <h3 className={head}>Hand-offs <InfoTip label="About hand-offs">Float = how many days a card can slip before the next person's card slips too. No float = one day late makes someone else late.</InfoTip></h3>
        <p className="mt-1 text-pretty text-[0.8rem] text-muted-foreground">Tickets someone else waits on. <b className="text-foreground">{hand.length} hand-offs · {zeroFloat} with no float.</b></p>
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

const TicketRow: React.FC<{ draft: SprintDraft; ticket: DraftTicket; busy: boolean; onChange: (key: string, change: { dev?: string | null; wave?: number; sp?: number }) => void; onScout: (key: string) => void }> = ({ draft, ticket, busy, onChange, onScout }) => {
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
    <li className="grid grid-cols-[minmax(0,1fr)_160px_64px_64px_88px_minmax(0,1.2fr)] items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 max-[760px]:col-span-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[0.8rem] font-semibold">{ticket.key}</span>
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
      <span className="max-[760px]:col-span-2"><ScoutCell ticket={ticket} busy={busy} onScout={onScout} /></span>
    </li>
  );
};

const ScopePanel: React.FC<{ draft: SprintDraft; busy: boolean; onChange: (key: string, change: { dev?: string | null; wave?: number; sp?: number }) => void; onDecide: (id: string, action: string, note?: string) => void; onScout: (key: string) => void }> = ({ draft, busy, onChange, onDecide, onScout }) => {
  const summary = scopeSummary(draft);
  const [cut, setCut] = useState('');
  const inSprint = draft.tickets.filter((ticket) => ticket.inSprint);
  const backlog = draft.tickets.filter((ticket) => !ticket.inSprint);
  const list = (tickets: DraftTicket[]) => (
    <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
      <li className="grid grid-cols-[minmax(0,1fr)_160px_64px_64px_88px_minmax(0,1.2fr)] gap-3 border-b border-border bg-surface-1 px-3 py-1.5 max-[760px]:hidden">
        {['Ticket', 'Developer', 'Wave', 'SP', 'Lands', 'Scout'].map((label) => <span key={label} className={head}>{label}</span>)}
      </li>
      {tickets.map((ticket) => <TicketRow key={ticket.key} draft={draft} ticket={ticket} busy={busy} onChange={onChange} onScout={onScout} />)}
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
        <h3 className={head}>Scope cut</h3>
        {draft.scopeCut?.note ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[0.8rem] text-secondary-foreground">
            {draft.scopeCut.note}
            {draft.scopeCut.by && <span className="font-mono text-[0.64rem] text-muted-foreground">{draft.scopeCut.by}</span>}
            <Button size="sm" variant="ghost" onClick={() => onDecide('scope|cut', 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
          </p>
        ) : (
          <form className="mt-2 flex gap-2 max-[760px]:flex-col" onSubmit={(event) => { event.preventDefault(); onDecide('scope|cut', 'cut', cut); setCut(''); }}>
            <Input aria-label="Scope cut" className="h-9" value={cut} onChange={(event) => setCut(event.target.value)} placeholder="What leaves the sprint, or the date that moves" />
            <Button size="sm" type="submit" variant="primary" disabled={busy || !cut.trim()}><Scissors size={13} aria-hidden="true" />Write</Button>
          </form>
        )}
      </section>
    </div>
  );
};

const FindingRow: React.FC<{ draft: SprintDraft; finding: DraftFinding; summaries: Map<string, TicketSummaryLite>; busy: boolean; onDecide: (id: string, action: string, note?: string) => void; badges?: LintFinding[] }> = ({ draft, finding, summaries, busy, onDecide, badges }) => {
  const late = finding.kind === 'after-it';
  const owner = draft.tickets.find((ticket) => ticket.key === finding.refKey)?.dev;
  const inPlan = draft.tickets.some((ticket) => ticket.key === finding.refKey);
  const when = finding.refEnd !== null && finding.ownEnd !== null ? `lands ${dayOf(finding.refEnd)}, ${finding.key} lands ${dayOf(finding.ownEnd)}` : null;
  const decided = decisionLabel(finding.decision, finding.refKey);
  const open = undecidedFinding(finding);
  const textId = acLineId(draft.tickets.find((ticket) => ticket.key === finding.key), summaries.get(finding.key), finding.line);
  return (
    <li className={cn('grid grid-cols-[minmax(0,1fr)] gap-1.5 border-b border-border px-3 py-2 last:border-b-0', open ? 'border-l-2 border-l-status-warn' : 'opacity-70')}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78rem] text-secondary-foreground">
          <span className={cn(chip, late ? TONE.warn : TONE.none)}>AC {finding.line}</span>
          <span className="font-mono font-semibold text-foreground" title={[owner, when].filter(Boolean).join(' · ') || undefined}>{finding.refKey}</span>
          <span className={cn(chip, late ? TONE.conflict : finding.kind === 'lands-first' ? TONE.ok : TONE.none)}>{findingKindLabel(finding.kind)}</span>
          {owner && <span className="font-mono text-[0.66rem] text-muted-foreground">{owner}{when ? ` · ${when}` : ''}</span>}
          {badges && <LineBadges findings={badges} label={lineBadgeLabel} />}
        </p>
        <p className="mt-1 text-pretty break-words text-[0.8rem] text-foreground">
          {keyParts(finding.text, finding.refKey).map((part, index) => (part.hit ? <mark key={index} className="rounded-xs bg-accent/20 px-0.5 font-mono font-semibold text-accent">{part.text}</mark> : <React.Fragment key={index}>{part.text}</React.Fragment>))}
        </p>
        {textId && <p className="mt-0.5 text-pretty break-words text-[0.76rem] text-muted-foreground">{textId}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {decided ? (
          <>
            <span className="self-center font-mono text-[0.64rem] text-muted-foreground">{decided}{finding.decision?.by ? ` · ${finding.decision.by}` : ''}</span>
            <Button size="sm" variant="ghost" onClick={() => onDecide(finding.id, 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
          </>
        ) : finding.linked ? (
          <span className="self-center font-mono text-[0.64rem] text-muted-foreground">Dependency · Blocks link exists</span>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => onDecide(finding.id, 'dependency')} disabled={busy}><Link2 size={13} aria-hidden="true" />Dependency</Button>
            <Button size="sm" onClick={() => onDecide(finding.id, 'reference')} disabled={busy}><FileInput size={13} aria-hidden="true" />Move to Reference</Button>
            {inPlan && <Button size="sm" variant="primary" onClick={() => onDecide(finding.id, 'move')} disabled={busy}><ArrowRightLeft size={13} aria-hidden="true" />Move to {finding.refKey}</Button>}
          </>
        )}
      </div>
    </li>
  );
};

const AcPanel: React.FC<{
  draft: SprintDraft; summaries: Map<string, TicketSummaryLite>; busy: boolean; onDecide: (id: string, action: string, note?: string) => void; onReferenceAll: (ids: string[]) => void; onTranslate: (keys: string[]) => void;
  onHumanize?: (key: string) => void;
}> = ({ draft, summaries, busy, onDecide, onReferenceAll, onTranslate, onHumanize }) => {
  const findings = sortFindings(draft.findings);
  const unlinked = findings.filter((finding) => !finding.linked);
  const groups = acGroups(draft);
  if (!groups.length) return <p className="text-sm text-muted-foreground">No AC line names another ticket or falls below the writing standard.</p>;
  const below = belowStandardLines(draft);
  const untranslated = untranslatedKeys(draft, groups.map((group) => group.key), summaries);
  return (
    <section aria-label="AC check">
      <p className="text-[0.84rem] text-secondary-foreground">
        <b className="text-foreground">{unlinked.length}</b> AC lines name another ticket without a Blocks link; {findings.filter(undecidedFinding).length} not decided.
        {below > 0 && <> <b className="text-status-conflict">{below}</b> AC {below === 1 ? 'line' : 'lines'} below the writing standard.</>}
      </p>
      <p className="mt-1 flex items-center gap-1 text-[0.76rem] text-sky-200">Waits on the named ticket? Dependency. Info only? Move to Reference. <InfoTip label="About the AC check">AC holds only what is tested on this ticket. Dependency adds the Blocks link on Publish, and the QA bot holds the ticket until that one is in UAT CHECK. Nothing changes in Jira before Publish, and DOCK writes no comments.</InfoTip></p>
      {untranslated.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.76rem] text-muted-foreground">
          {untranslated.length} {untranslated.length === 1 ? 'ticket has' : 'tickets have'} no Indonesian lines yet.
          <Button size="sm" variant="ghost" onClick={() => onTranslate(untranslated)}><Languages size={13} aria-hidden="true" />Translate with the agent</Button>
        </p>
      )}
      <div className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
        {groups.map((group) => {
          const outside = outsidePlanOpen(group.findings, group.key);
          const left = group.findings.filter(undecidedFinding).length;
          const rows = [...new Set([...group.findings.map((finding) => finding.line), ...group.lines.keys()])].sort((a, b) => a - b);
          const ticket = draft.tickets.find((item) => item.key === group.key);
          return (
            <section key={group.key} aria-label={group.key} className="border-b border-border last:border-b-0">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1 bg-surface-1 px-3 py-2 text-[0.8rem]">
                <b className="font-mono">{group.key}</b>
                <span className="min-w-0 flex-1 text-pretty text-foreground">{ticket?.summary ?? ''}</span>
                {group.findings.length > 0 && <span className="font-mono text-[0.66rem] text-muted-foreground">{left} left</span>}
                {group.lines.size > 0 && onHumanize && <Button size="sm" variant="ghost" onClick={() => onHumanize(group.key)} disabled={busy}><PenLine size={13} aria-hidden="true" />Humanize</Button>}
                {outside.length > 1 && <Button size="sm" onClick={() => onReferenceAll(outside.map((finding) => finding.id))} disabled={busy}><FileInput size={13} aria-hidden="true" />All {outside.length} outside plan → Reference</Button>}
              </div>
              <ul>
                {rows.map((line) => {
                  const mine = group.findings.filter((finding) => finding.line === line);
                  const badges = group.lines.get(line) ?? [];
                  if (mine.length) return mine.map((finding, index) => <FindingRow key={finding.id} draft={draft} finding={finding} summaries={summaries} busy={busy} onDecide={onDecide} badges={index === 0 ? badges : undefined} />);
                  return (
                    <li key={`line-${line}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 border-b border-border px-3 py-2 last:border-b-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78rem]"><span className={cn(chip, TONE.none)}>AC {line}</span><LineBadges findings={badges} label={lineBadgeLabel} /></p>
                      <p className="text-pretty break-words text-[0.8rem] text-foreground">{ticket?.ac[line - 1] ?? ''}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
};

const VIEW_TABS: Array<[TeamView, string, typeof LayoutGrid]> = [['board', 'Board', LayoutGrid], ['schedule', 'Schedule', CalendarRange]];

/** Team map: Board (lanes and cards with what to decide) or Schedule (load, waves, days, order of work and hand-offs), and the split page row. */
const TeamMap: React.FC<{
  draft: SprintDraft; plan: DraftTicket[]; summaries: Map<string, TicketSummaryLite>; view: TeamView; perDev: number; busy: boolean; readOnly: boolean; onView: (view: TeamView) => void;
  filter: BoardFilter; onFilter: (filter: BoardFilter) => void;
  onMove: (keys: string[], to: string) => void; onDecide: (id: string, action: string, note?: string) => void; onCheckStoryboards: () => void; onShowPanel: (panel: PlanningPanel) => void;
  onUseSplit: (keys: string[]) => void; onKeepSplit: (keys: string[]) => void;
}> = ({ draft, plan, summaries, view, perDev, busy, readOnly, onView, filter, onFilter, onMove, onDecide, onCheckStoryboards, onShowPanel, onUseSplit, onKeepSplit }) => (
  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
    <div role="group" aria-label="Team map view" className="inline-flex w-max overflow-hidden rounded-xs border border-border">
      {VIEW_TABS.map(([id, label, Icon]) => (
        <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)}
          className={cn('inline-flex h-7 items-center gap-1.5 border-r border-border px-3 font-display text-xs font-semibold text-secondary-foreground last:border-r-0 max-[760px]:h-11', view === id && 'bg-surface-2 text-foreground')}>
          <Icon size={12} aria-hidden="true" />{label}
        </button>
      ))}
    </div>
    {draft.split && <SplitRow split={draft.split} busy={busy || readOnly} onUse={onUseSplit} onKeep={onKeepSplit} />}
    {view === 'board'
      ? <PlanningBoard draft={draft} perDev={perDev} busy={busy} readOnly={readOnly} filter={filter} onFilter={onFilter} onDecide={onDecide} onCheckStoryboards={onCheckStoryboards} onShowPanel={onShowPanel} renderFinding={(finding) => <FindingRow key={finding.id} draft={draft} finding={finding} summaries={summaries} busy={busy} onDecide={onDecide} />} />
      : <fieldset disabled={readOnly} className="contents"><TeamPanel draft={draft} plan={plan} busy={busy} onMove={onMove} /></fieldset>}
  </div>
);

const PublishDialog: React.FC<{
  open: boolean; sprint: string; changes: DraftChange[] | null; results: PublishResult[] | null; loading: boolean; publishing: boolean; error: string | null; missing: ReadyItem[]; onConfirm: () => void; onClose: () => void; onFix: () => void;
}> = ({ open, sprint, changes, results, loading, publishing, error, missing, onConfirm, onClose, onFix }) => {
  const id = useId();
  const count = changes ? changeCount(changes) : 0;
  const creates = changes?.filter((change) => change.create) ?? [];
  const updates = changes?.filter((change) => !change.create) ?? [];
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
                <span className={cn(chip, result.status === 'updated' || result.status === 'created' ? TONE.ok : result.status === 'skipped' ? TONE.none : TONE.conflict)}>{result.status}</span>
                {result.kind === 'create' && result.status === 'created' && result.detail
                  ? <span className="inline-flex items-center gap-1 font-mono font-semibold text-status-merged">→ {result.detail}</span>
                  : result.detail && <span className="text-muted-foreground">{result.detail}</span>}
              </li>
            ))}
            {!results.some((result) => result.kind === 'ticket' || result.kind === 'create') && <li className="py-2 text-sm text-muted-foreground">Jira already matched the plan; no ticket field was written.</li>}
          </ul>
        ) : changes && (
          <>
            {missing.length > 0 ? (
              <div className="mt-3 rounded-md border border-border bg-surface-1 px-3.5 py-3">
                <p className="mb-1 flex flex-wrap items-center gap-1.5 font-display text-sm font-bold"><AlertTriangle size={14} className="text-status-warn" aria-hidden="true" />Still missing: {missing.length}<span className="ml-auto font-body text-xs font-normal text-muted-foreground">does not block publish</span></p>
                {missing.map((item) => <p key={item.id} className="flex items-start gap-2 py-0.5 text-[0.8rem] text-secondary-foreground"><AlertCircle size={13} className="mt-0.5 flex-none text-status-warn" aria-hidden="true" />{item.text}</p>)}
              </div>
            ) : <p className="mt-3 flex items-center gap-2 text-sm text-status-merged"><CheckCircle2 size={14} aria-hidden="true" />Ready to publish, everything is done</p>}
            <p className="mt-2 flex items-center gap-1 text-pretty text-sm text-muted-foreground">
              Jira gets only the AC and assignees that differ.
              <InfoTip label="What Publish writes">A ticket whose AC changed in Jira after the load is skipped. Also written: the Confluence page "Sprint contract {sprint}", comments for changed test cases, and the plan-published-rN label that every developer's DOCK and the cron wait for.</InfoTip>
            </p>
            {creates.length > 0 && (
              <section aria-label="Create in Jira" className="mt-3">
                <h3 className={head}>Create in Jira · {creates.length}</h3>
                <ul className="mt-1">
                  {creates.map((change) => (
                    <li key={change.key} className="border-b border-border py-2 text-[0.8rem] last:border-b-0">
                      <p className="flex flex-wrap items-baseline gap-2">
                        <FilePlus2 size={13} className="flex-none self-center text-sky-300" aria-hidden="true" />
                        <span className="font-mono font-semibold text-sky-300">{change.key}</span>
                        <span className="min-w-0 flex-1 text-pretty">{change.create!.summary}</span>
                        <span className="font-mono text-[0.68rem] text-muted-foreground">{change.create!.type} · {change.create!.dev ?? 'no developer'} · {change.create!.sp ?? '?'} SP</span>
                        {change.refused && <span className={cn(chip, TONE.conflict)}>skipped</span>}
                      </p>
                      {change.refused && <p className="mt-1 text-status-conflict">{change.refused}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ul className="mt-3 max-h-[50vh] overflow-y-auto">
              {updates.map((change) => (
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
              {updates.length === 0 && <li className="py-2 text-sm text-muted-foreground">Existing tickets already match the plan.</li>}
            </ul>
          </>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {!results && missing.length > 0 ? <Button onClick={onFix} disabled={publishing}>Fix first</Button> : <Button onClick={onClose} disabled={publishing}>{results ? 'Close' : 'Cancel'}</Button>}
          {!results && <Button variant="primary" onClick={onConfirm} disabled={publishing || loading || !changes}><Send size={14} aria-hidden="true" />{publishing ? 'Publishing...' : missing.length ? 'Publish anyway' : count ? `Publish ${count} ${count === 1 ? 'ticket' : 'tickets'}` : 'Publish'}</Button>}
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
  const [view, setView] = useState<TeamView>(() => teamViewOf(remembered(TEAM_VIEW_KEY)));
  const [folded, setFolded] = useState(() => chatFoldedOf(remembered(CHAT_FOLDED_KEY)));
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all');
  const chooseView = (next: TeamView) => { setView(next); remember(TEAM_VIEW_KEY, next); };
  const fold = (next: boolean) => { setFolded(next); remember(CHAT_FOLDED_KEY, chatFoldedValue(next)); };
  const [notice, setNotice] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [results, setResults] = useState<PublishResult[] | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const sprints = useQuery<{ planningSprints: PlanningSprint[] }>(GET_PLANNING_SPRINTS, { fetchPolicy: 'cache-and-network' });
  const options = sprints.data?.planningSprints ?? [];
  const chosen = options.find((sprint) => sprint.id === sprintId) ?? options.find((sprint) => sprint.state === 'future') ?? options[0] ?? null;
  // The planning chat changes the draft through DOCK's ingest routes, so the panel polls it like Plan does.
  const draftQuery = useQuery<{ sprintDraft: SprintDraft | null }>(GET_SPRINT_DRAFT, { variables: { sprint: chosen?.name ?? '' }, skip: !chosen, fetchPolicy: 'cache-and-network', pollInterval: 10000 });
  // The visuals the planning agent made are polled with the draft.
  const visualsQuery = useQuery<{ sprintDraftVisuals: DraftVisual[] }>(GET_SPRINT_DRAFT_VISUALS, { variables: { sprint: chosen?.name ?? '' }, skip: !chosen, fetchPolicy: 'cache-and-network', pollInterval: 10000 });
  const visuals = visualsQuery.data?.sprintDraftVisuals ?? [];
  const [visualId, setVisualId] = useState<string | null>(null);
  const openVisual = visuals.find((visual) => visual.id === visualId) ?? null;
  // The publish signal comes from Jira's plan labels, so a developer's DOCK sees the planner's publish too.
  const signalQuery = useQuery<{ sprintPlanSignal: PlanSignal | null }>(GET_SPRINT_PLAN_SIGNAL, { variables: { sprint: chosen?.name ?? '' }, skip: !chosen, fetchPolicy: 'cache-and-network', pollInterval: 15000 });
  const signal = signalQuery.data?.sprintPlanSignal ?? null;
  const planner = signal ? signal.isPlanner : true;
  const session = usePlanningSession(chosen?.name ?? '');
  const openChat = (prefill?: string) => { fold(false); void session.open(prefill); };
  const flowQuery = useQuery<{ planningFlow: string | null }>(GET_PLANNING_FLOW, { fetchPolicy: 'cache-and-network' });
  const flow = parseFlow(flowQuery.data?.planningFlow);
  const skipped = skippedStages(flow);
  // Tiket saya, Order and Tickets are not stages of the flow: they are always shown.
  const panels = PANELS.filter(([id]) => id === 'team' || id === 'mine' || id === 'order' || id === 'new' || !skipped.has(id));
  const shown = panels.some(([id]) => id === panel) ? panel : 'team';
  const [loadDraft, loading] = useMutation(LOAD_SPRINT_DRAFT);
  const [updateTicket, updating] = useMutation(UPDATE_SPRINT_DRAFT_TICKET);
  const [decide, deciding] = useMutation(DECIDE_SPRINT_DRAFT);
  const [checkStoryboards, checking] = useMutation(CHECK_SPRINT_STORYBOARDS);
  const [moveCards, moving] = useMutation(MOVE_SPRINT_DRAFT_CARDS);
  const [applySplit, usingSplit] = useMutation(USE_SPRINT_DRAFT_SPLIT);
  const [holdSplit, keepingSplit] = useMutation(KEEP_SPRINT_DRAFT_SPLIT);
  const [saveVisual, savingVisual] = useMutation(SAVE_SPRINT_DRAFT_VISUAL);
  const [dropVisual, droppingVisual] = useMutation(DROP_SPRINT_DRAFT_VISUAL);
  const [runScout] = useMutation(RUN_SCOUT);
  const [publish, publishing] = useMutation(PUBLISH_SPRINT_DRAFT);
  const [saveNewTicket, savingNew] = useMutation(SAVE_SPRINT_DRAFT_NEW_TICKET);
  const [removeNewTicket, removingNew] = useMutation(REMOVE_SPRINT_DRAFT_NEW_TICKET);
  const [createNewTickets, creatingNew] = useMutation<{ createSprintDraftNewTickets: PublishResult[] }>(CREATE_SPRINT_DRAFT_NEW_TICKETS);
  const [saveRevision, savingRevision] = useMutation(SAVE_SPRINT_DRAFT_REVISION);
  const [applyRevision, applyingRevision] = useMutation<{ applySprintDraftRevision: PublishResult }>(APPLY_SPRINT_DRAFT_REVISION);
  const [discardRevision, discardingRevision] = useMutation(DISCARD_SPRINT_DRAFT_REVISION);
  const [preview, previewing] = useLazyQuery<{ previewSprintDraftPublish: DraftChange[] }>(PREVIEW_SPRINT_DRAFT_PUBLISH, { fetchPolicy: 'network-only' });
  const full = draftQuery.data?.sprintDraft ?? null;
  // Merged cards are on the plan only: every panel works on the cards still to build, the schedule draws them all.
  const draft = full && { ...full, tickets: scheduled(full.tickets) };
  const busy = loading.loading || updating.loading || deciding.loading || publishing.loading || checking.loading || moving.loading || usingSplit.loading || keepingSplit.loading || savingVisual.loading || droppingVisual.loading || savingNew.loading || removingNew.loading || creatingNew.loading || savingRevision.loading || applyingRevision.loading || discardingRevision.loading;
  // The planning agent's Indonesian title and AC lines, for Tiket saya, AC check and the Board's card details.
  const ownerQuery = useQuery<{ ownerName: string }>(GET_OWNER_NAME, { fetchPolicy: 'cache-first' });
  const me = signal?.me ?? ownerQuery.data?.ownerName ?? null;
  const summaryQuery = useQuery<{ ticketReadiness: { tickets: Array<{ key: string; summary: TicketSummaryLite | null }> } }>(GET_TICKET_READINESS, {
    variables: { keys: draft?.tickets.map((ticket) => ticket.key) ?? [], refs: [] },
    skip: !draft || (shown !== 'mine' && shown !== 'ac' && shown !== 'team'),
    fetchPolicy: 'cache-and-network',
    pollInterval: shown === 'ac' ? 30000 : 0,
  });
  const summaries = new Map((summaryQuery.data?.ticketReadiness.tickets ?? []).flatMap((item) => (item.summary ? [[item.key, item.summary] as const] : [])));

  const run = (work: Promise<unknown>, fallback: string) => {
    setNotice(null);
    work.then(() => Promise.all([draftQuery.refetch(), signalQuery.refetch(), visualsQuery.refetch()])).catch((failure: unknown) => setNotice(errorText(failure, fallback)));
  };
  const onLoad = () => chosen && run(loadDraft({ variables: { sprintId: chosen.id } }), 'The sprint could not be loaded from Jira');
  // An unpublished draft is read from Jira again once per visit when it is stale: tickets moved in or out of the sprint
  // since the last load show up. A published draft is left alone, a load would reset it to draft.
  const refreshed = useRef<string | null>(null);
  useEffect(() => {
    if (!full || full.status !== 'draft' || refreshed.current === full.sprint || busy) return;
    refreshed.current = full.sprint;
    if (Date.now() - Date.parse(full.loadedAt) > DRAFT_STALE_MS) onLoad();
  }, [full?.sprint, full?.status, full?.loadedAt]);
  const onChange = (key: string, change: { dev?: string | null; wave?: number; sp?: number }) => draft && run(updateTicket({ variables: { sprint: draft.sprint, key, ...change } }), 'The ticket could not be changed');
  const onDecide = (id: string, action: string, note?: string) => draft && run(decide({ variables: { sprint: draft.sprint, id, action, note: note ?? null } }), 'The decision could not be saved');
  // One call after the other: each answer is the whole draft, so parallel calls could drop each other's change.
  const inTurn = (keys: string[], call: (key: string) => Promise<unknown>) => keys.reduce<Promise<unknown>>((chain, key) => chain.then(() => call(key)), Promise.resolve());
  const onUseSplit = (keys: string[]) => draft && run(inTurn(keys, (key) => applySplit({ variables: { sprint: draft.sprint, key } })), 'The ticket could not be moved to the split week');
  const onKeepSplit = (keys: string[]) => draft && run(inTurn(keys, (key) => holdSplit({ variables: { sprint: draft.sprint, key } })), 'The difference could not be kept');
  const onReferenceAll = (ids: string[]) => draft && run(inTurn(ids, (id) => decide({ variables: { sprint: draft.sprint, id, action: 'reference', note: null } })), 'The decisions could not be saved');
  const onSaveNewTicket = async (id: string | null, input: NewTicketInput) => {
    if (!draft) return false;
    setNotice(null);
    try {
      await saveNewTicket({ variables: { sprint: draft.sprint, id, input } });
      await draftQuery.refetch();
      return true;
    } catch (failure) {
      setNotice(errorText(failure, 'The new ticket could not be saved'));
      return false;
    }
  };
  const onRemoveNewTicket = (id: string) => draft && run(removeNewTicket({ variables: { sprint: draft.sprint, id } }), 'The new ticket could not be removed');
  const onCreateNewTickets = async (ids: string[], flag?: { reason: string }) => {
    if (!draft) return [];
    setNotice(null);
    try {
      const res = await createNewTickets({ variables: { sprint: draft.sprint, ids, flag } });
      await draftQuery.refetch();
      return res.data?.createSprintDraftNewTickets ?? [];
    } catch (failure) {
      setNotice(errorText(failure, 'The new tickets could not be created'));
      return [];
    }
  };
  const onSaveRevision = async (key: string, input: RevisionInput) => {
    if (!draft) return false;
    setNotice(null);
    try {
      await saveRevision({ variables: { sprint: draft.sprint, key, input } });
      await draftQuery.refetch();
      return true;
    } catch (failure) {
      setNotice(errorText(failure, 'The revision could not be saved'));
      return false;
    }
  };
  const onApplyRevision = async (key: string, flag?: { reason: string }) => {
    if (!draft) return null;
    setNotice(null);
    try {
      const res = await applyRevision({ variables: { sprint: draft.sprint, key, flag } });
      await draftQuery.refetch();
      return res.data?.applySprintDraftRevision ?? null;
    } catch (failure) {
      setNotice(errorText(failure, 'The revision could not be applied'));
      return null;
    }
  };
  const onDiscardRevision = (key: string) => draft && run(discardRevision({ variables: { sprint: draft.sprint, key } }), 'The revision could not be discarded');
  const onScout = (key: string) => run(runScout({ variables: { key } }), 'The scout could not start');
  const onCheckStoryboards = () => draft && run(checkStoryboards({ variables: { sprint: draft.sprint } }), 'The storyboard could not be read');
  const onSaveVisual = (id: string) => draft && run(saveVisual({ variables: { sprint: draft.sprint, id } }), 'The visual could not be saved');
  const onDiscardVisual = (id: string) => draft && run(dropVisual({ variables: { sprint: draft.sprint, id } }).then(() => setVisualId(null)), 'The visual could not be discarded');
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
  const ready = draft ? publishReadiness(draft, flow) : null;
  const showPanel = (next: PlanningPanel) => {
    setVisualId(null);
    setPanel(next);
    const params = new URLSearchParams(window.location.search);
    params.set('panel', next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  };

  const capacity = draft ? capacityOf(draft) : null;
  const badge = (id: PlanningPanel) => (draft ? panelBadge(id, draft) : 0);

  return (
    <div className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-4', folded ? 'min-[1100px]:grid-cols-[minmax(0,1fr)_44px]' : 'min-[1100px]:grid-cols-[minmax(0,1fr)_340px]')}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Select aria-label="Sprint to plan" className="w-[260px] max-[760px]:w-full" value={String(chosen.id)} onValueChange={(value) => setSprintId(Number(value))} options={options.map((sprint) => ({ value: String(sprint.id), label: `${sprint.name}${sprint.state === 'active' ? ' (active)' : ''}` }))} />
          <PlanningStatus signal={signal} />
          {draft && (
            <p aria-label="Draft summary" className="flex items-center gap-1.5 text-[0.78rem] text-muted-foreground">
              {draftSummaryText(draft)}
              <InfoTip label="About the summary">
                {draft.landed > 0 ? `${draft.landed} tickets of this sprint are merged and not counted. ` : ''}
                {draft.carriedPast ? `${draft.carriedPast} merged tickets carried from the last sprint are not shown. ` : ''}
                AC lines waiting on other tickets and open decisions are in the bar below and on the AC check tab.
              </InfoTip>
            </p>
          )}
          <span className="flex-1" />
          <Button onClick={onLoad} disabled={busy}><Download size={14} aria-hidden="true" />{loading.loading ? 'Loading...' : draft ? 'Load again from Jira' : 'Load from Jira'}</Button>
        </div>
        <PlanningStatusNote signal={signal} draft={draft} onOpenChat={() => openChat()} onRepublish={() => void onRepublish()} />
        {signal && !planner && <DeveloperOrder signal={signal} />}
        {notice && <p className="text-sm text-status-conflict" role="alert">{notice}</p>}
        {draftQuery.error && !draft && <p className="text-sm text-status-conflict" role="alert">{draftQuery.error.message}</p>}

        {!draft ? (
          <section className="grid gap-3 border-y border-border py-6" aria-label="No draft yet">
            <p className="text-sm text-muted-foreground">{chosen.name} has no draft yet. Load it from Jira to see the team's lanes, the scope cut, and the AC check.</p>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Planning panel">
              {panels.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={!openVisual && shown === id}
                  onClick={() => showPanel(id)}
                  className={cn('inline-flex h-7 items-center gap-1.5 rounded-xs border border-border bg-surface-1 px-3 font-display text-xs font-semibold text-secondary-foreground max-[760px]:h-11', !openVisual && shown === id && 'border-accent bg-accent text-black')}
                >
                  {label}
                  {badge(id) > 0 && <span className={cn('min-w-[1.15rem] rounded-pill px-1 text-center font-mono text-[0.6rem] font-bold text-black', id === 'new' ? 'bg-sky-300' : 'bg-status-warn')}>{badge(id)}</span>}
                </button>
              ))}
              {visuals.map((visual) => (
                <button
                  key={visual.id}
                  type="button"
                  role="tab"
                  aria-selected={openVisual?.id === visual.id}
                  onClick={() => setVisualId(visual.id)}
                  className={cn('inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-xs border border-dashed border-border bg-surface-1 px-3 font-display text-xs font-semibold text-secondary-foreground max-[760px]:h-11', openVisual?.id === visual.id && 'border-accent bg-accent text-black')}
                >
                  <BarChart3 size={12} className="flex-none" aria-hidden="true" /><span className="min-w-0 truncate">{visual.title}</span>
                  {visual.stale && <span className="size-1.5 flex-none rounded-full bg-status-warn" title="The draft changed after this was made" aria-label="out of date" />}
                </button>
              ))}
            </div>
            {/* A developer's DOCK reads the planner's draft: every control in the panels is disabled. */}
            {!openVisual && shown === 'mine' && <MyTicketsPanel draft={draft} me={me} summaries={summaries} onOpenTicket={openTicket} />}
            {!openVisual && shown === 'order' && <PlanTab />}
            {!openVisual && shown === 'team' && (
              <TeamMap
                draft={draft} plan={full?.tickets ?? []} summaries={summaries} view={view} perDev={capacity?.perDev ?? 0} busy={busy} readOnly={!planner} onView={chooseView} filter={boardFilter} onFilter={setBoardFilter}
                onMove={onMove} onDecide={onDecide} onCheckStoryboards={onCheckStoryboards} onShowPanel={showPanel} onUseSplit={onUseSplit} onKeepSplit={onKeepSplit}
              />
            )}
            <fieldset disabled={!planner} className="contents">
            {!openVisual && shown === 'scope' && <ScopePanel draft={draft} busy={busy} onChange={onChange} onDecide={onDecide} onScout={onScout} />}
            {!openVisual && shown === 'ac' && <AcPanel draft={draft} summaries={summaries} busy={busy} onDecide={onDecide} onReferenceAll={onReferenceAll} onTranslate={(keys) => openChat(translatePrompt(draft.sprint, keys))} onHumanize={(key) => openChat(humanizePrompt(key, draft.sprint))} />}
            {!openVisual && shown === 'storyboard' && <StoryboardBoard draft={draft} busy={busy} onCheck={onCheckStoryboards} onDecide={onDecide} />}
            {!openVisual && shown === 'new' && (
              <TicketsPanel
                draft={draft} busy={busy} onSaveNew={onSaveNewTicket} onRemoveNew={onRemoveNewTicket} onCreateNew={onCreateNewTickets}
                onSaveRevision={onSaveRevision} onApplyRevision={onApplyRevision} onDiscardRevision={onDiscardRevision} onOpenTicket={openTicket}
                onHumanize={(key) => openChat(humanizePrompt(key, draft.sprint))}
              />
            )}
            {openVisual && <PlanningVisual visual={openVisual} sprint={draft.sprint} busy={busy} onSave={() => onSaveVisual(openVisual.id)} onDiscard={() => onDiscardVisual(openVisual.id)} onRedo={() => openChat(redoVisualPrompt(openVisual.title))} />}
            </fieldset>
            {ready && <PlanningBar draft={draft} ready={ready} signal={signal} busy={busy} onShow={showPanel} onPublish={() => void onPublish()} onRepublish={() => void onRepublish()} onWriting={() => { setBoardFilter('writing'); chooseView('board'); showPanel('team'); }} />}
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
      <PlanningChat session={session} folded={folded} onFold={fold} className={folded ? 'min-[1100px]:sticky min-[1100px]:top-4' : 'h-[520px] min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:h-[calc(100dvh-2rem)]'} />
    </div>
  );
};
