import React, { useState } from 'react';
import { Check, FileSearch, FilePlus2, Info, Undo2, X } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { UNASSIGNED, devColors, newTicketMissing, storyboardDecisionId, storyboardNoneId, unrecordedEpics, type DraftFinding, type PlanningPanel, type SprintDraft } from './planning';
import { boardCards, boardLanes, cardShown, filterCounts, type BoardCard, type BoardFilter } from './boardLogic';

const fmt = (value: number) => String(Math.round(value * 10) / 10);
const dot = 'inline-block size-2 flex-none rounded-full';
const AC_DOT = 'bg-status-warn';
const SB_DOT = 'bg-violet-400';

const Card: React.FC<{ card: BoardCard; picked: boolean; dim: boolean; onPick: () => void }> = ({ card, picked, dim, onPick }) => (
  <button
    type="button"
    onClick={onPick}
    aria-pressed={picked}
    className={cn(
      'relative flex min-w-0 flex-col gap-0.5 rounded-xs border bg-surface-1 px-2 py-1.5 text-left text-[0.74rem] transition-opacity hover:border-border-glow',
      card.isNew ? 'border-dashed border-sky-400' : 'border-border',
      picked && 'border-accent outline outline-1 outline-accent',
      dim && 'opacity-35',
    )}
  >
    <span className="absolute right-1.5 top-1.5 flex gap-1">
      {card.flags.ac && <span className={cn(dot, AC_DOT)} title="An AC line names another ticket, not decided" />}
      {card.flags.sb && <span className={cn(dot, SB_DOT)} title="Storyboard not recorded" />}
    </span>
    <span className={cn('pr-6 font-mono text-[0.7rem] font-bold', card.isNew ? 'text-sky-300' : 'text-foreground')}>{card.createdKey ?? card.key}</span>
    <span className="truncate text-secondary-foreground" title={card.summary}>{card.summary || 'Untitled ticket'}</span>
    <span className="flex gap-1.5 font-mono text-[0.64rem] text-muted-foreground"><span>{card.sp ?? '?'} SP</span><span className="truncate">{card.isNew ? `new · ${card.type ?? 'Task'}` : card.status}</span></span>
  </button>
);

/** Team map > Board: a lane per developer with the cards still to build, issue dots, filters, and a drawer with the picked card's calls. */
export const PlanningBoard: React.FC<{
  draft: SprintDraft; perDev: number; busy: boolean; readOnly: boolean;
  renderFinding: (finding: DraftFinding) => React.ReactNode;
  onDecide: (id: string, action: string, note?: string) => void; onCheckStoryboards: () => void; onShowPanel: (panel: PlanningPanel) => void;
}> = ({ draft, perDev, busy, readOnly, renderFinding, onDecide, onCheckStoryboards, onShowPanel }) => {
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const cards = boardCards(draft);
  const lanes = boardLanes(draft, perDev);
  const counts = filterCounts(cards);
  const colorOf = devColors(lanes.map((lane) => lane.dev));
  const card = cards.find((item) => item.key === picked) ?? null;
  const ticket = card && !card.isNew ? draft.tickets.find((item) => item.key === card.key) ?? null : null;
  const fresh = card?.isNew ? (draft.newTickets ?? []).find((item) => item.id === card.key) ?? null : null;
  const findings = ticket ? draft.findings.filter((finding) => finding.key === ticket.key) : [];
  const epicOpen = ticket?.epic && unrecordedEpics(draft).includes(ticket.epic) ? ticket.epic : null;
  const flag = ticket?.storyboard ?? null;
  const missing = fresh ? newTicketMissing(fresh) : [];
  const filters: Array<[BoardFilter, React.ReactNode]> = [
    ['all', 'All'],
    ['ac', <><span className={cn(dot, AC_DOT)} aria-hidden="true" />AC to decide · {counts.ac}</>],
    ['sb', <><span className={cn(dot, SB_DOT)} aria-hidden="true" />Storyboard · {counts.sb}</>],
    ['new', <>New · {counts.new}</>],
  ];

  return (
    <section aria-label="Board" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
        <span className="mr-1 text-xs text-muted-foreground">Show</span>
        {filters.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
            className={cn('inline-flex h-7 items-center gap-1.5 rounded-pill border border-border px-2.5 font-mono text-[0.68rem] text-secondary-foreground hover:border-border-glow max-[760px]:h-11', filter === id && 'border-accent text-accent')}>
            {label}
          </button>
        ))}
      </div>

      {card && (
        <section aria-label={`${card.key} details`} className="rounded-md border border-accent bg-surface-1 px-3 py-2.5 text-[0.8rem]">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-pretty font-display text-sm font-semibold">
              <span className={cn('mr-2 font-mono', card.isNew ? 'text-sky-300' : 'text-foreground')}>{card.createdKey ?? card.key}</span>{card.summary || 'Untitled ticket'}
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)} aria-label="Close the card details"><X size={13} aria-hidden="true" /></Button>
          </div>
          <p className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">
            {card.dev ?? UNASSIGNED} · {card.sp ?? '?'} SP · {card.isNew ? (card.createdKey ? `created as ${card.createdKey}` : 'created on Publish') : card.status}{card.epic ? ` · epic ${card.epic}` : ''}
          </p>
          <fieldset disabled={readOnly} className="contents">
            {findings.length > 0 && <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">{findings.map((finding) => renderFinding(finding))}</ul>}
            {epicOpen && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <span className={cn(dot, SB_DOT)} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-secondary-foreground">Storyboard of {epicOpen} not recorded.</span>
                <Button size="sm" onClick={onCheckStoryboards} disabled={busy}><FileSearch size={13} aria-hidden="true" />Check storyboard</Button>
                <Button size="sm" onClick={() => onDecide(storyboardNoneId(epicOpen), 'none')} disabled={busy}>No storyboard</Button>
              </div>
            )}
            {ticket && flag && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <span className={cn(dot, flag.checked ? 'bg-status-merged' : SB_DOT)} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-secondary-foreground">{flag.checked ? 'AC checked' : 'AC needs a check'} against storyboard v{flag.version} · {flag.frames.join(', ')}</span>
                {flag.checked
                  ? <Button size="sm" variant="ghost" onClick={() => onDecide(storyboardDecisionId(ticket.key, flag.version), 'clear')} disabled={busy}><Undo2 size={13} aria-hidden="true" />Undo</Button>
                  : <Button size="sm" variant="primary" onClick={() => onDecide(storyboardDecisionId(ticket.key, flag.version), 'checked')} disabled={busy}><Check size={13} aria-hidden="true" />AC checked</Button>}
              </div>
            )}
          </fieldset>
          {fresh && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <span className="min-w-0 flex-1 text-secondary-foreground">
                {fresh.error ? <span className="text-status-conflict">{fresh.error}</span> : missing.length ? `Still missing: ${missing.join(', ')}.` : fresh.dev ? 'Ready to create on Publish.' : 'No developer yet.'}
              </span>
              <Button size="sm" onClick={() => onShowPanel('new')}><FilePlus2 size={13} aria-hidden="true" />Open in Tickets</Button>
            </div>
          )}
          {ticket && !findings.length && !epicOpen && !flag && <p className="mt-2 border-t border-border pt-2 text-muted-foreground">Nothing to decide on this card.</p>}
        </section>
      )}

      <div className="grid min-w-0 auto-cols-[minmax(200px,1fr)] grid-flow-col gap-2.5 overflow-x-auto pb-1 max-[760px]:auto-cols-[minmax(240px,85%)]">
        {lanes.map((lane) => {
          const tint = lane.dev === UNASSIGNED ? 'var(--color-muted-foreground)' : colorOf.get(lane.dev) ?? 'var(--color-muted-foreground)';
          const unassigned = lane.dev === UNASSIGNED;
          return (
            <div key={lane.dev} className={cn('flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-surface-0 p-2', unassigned && 'border-dashed')}>
              <h4 className="flex items-baseline justify-between gap-1.5">
                <b className="truncate font-display text-[0.82rem]" style={{ color: tint }}>{lane.dev}</b>
                <span className={cn('flex-none font-mono text-[0.66rem]', lane.over ? 'text-status-conflict' : 'text-muted-foreground')}>{unassigned ? `${lane.cards.length} ${lane.cards.length === 1 ? 'card' : 'cards'}` : `${fmt(lane.load)} / ${fmt(lane.share)} SP`}</span>
              </h4>
              {!unassigned && (
                <span className="block h-1 overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
                  <span className={cn('block h-full', lane.over ? 'bg-status-conflict' : 'bg-secondary-foreground')} style={{ width: `${lane.share ? Math.min(100, (lane.load / lane.share) * 100) : 0}%` }} />
                </span>
              )}
              {lane.cards.map((item) => <Card key={item.key} card={item} picked={picked === item.key} dim={!cardShown(item, filter)} onPick={() => setPicked(picked === item.key ? null : item.key)} />)}
              {!lane.cards.length && <p className="text-[0.72rem] text-muted-foreground">No open card.</p>}
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className={cn(dot, AC_DOT)} aria-hidden="true" />AC names another ticket, not decided</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn(dot, SB_DOT)} aria-hidden="true" />storyboard not recorded or AC to check</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[3px] border border-dashed border-sky-400" aria-hidden="true" />new ticket, created on Publish</span>
        <span className="inline-flex items-center gap-1.5"><Info size={11} aria-hidden="true" />Lanes show SP left against each person's share of the capacity.</span>
      </p>
    </section>
  );
};
