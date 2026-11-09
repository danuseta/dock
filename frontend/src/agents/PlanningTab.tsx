import React, { useEffect, useId, useState } from 'react';
import { useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { ArrowRightLeft, Check, Clock, Download, EyeOff, Minus, Plus, RefreshCw, Scissors, Send, ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react';
import { Button, Card, Dialog, Input, Select } from '../components/ui';
import {
  DECIDE_SPRINT_DRAFT, GET_PLANNING_SPRINTS, GET_SPRINT_DRAFT, LOAD_SPRINT_DRAFT, PREVIEW_SPRINT_DRAFT_PUBLISH, PUBLISH_SPRINT_DRAFT,
  REFRESH_SPRINT_DRAFT_QA, UPDATE_SPRINT_DRAFT_TICKET,
} from '../graphql/queries';
import { cn } from '../lib/cn';
import {
  UNASSIGNED, barPlace, changeCount, dayOf, decisionLabel, findingKindLabel, lanes, parseWave, predictionTone, publishHint, scopeSummary, sortFindings,
  spanOf, waveRows, workingDayLabels,
  type DraftChange, type DraftFinding, type DraftTicket, type PlanningPanel, type PlanningSprint, type PublishResult, type SprintDraft,
} from './planning';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const chip = 'rounded-xs border px-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.08em]';
const NO_DEV = '__none';
const TONE: Record<string, string> = {
  ok: 'border-status-merged text-status-merged', conflict: 'border-status-conflict text-status-conflict', warn: 'border-status-warn text-status-warn', none: 'border-border text-muted-foreground',
};
const PANELS: Array<[PlanningPanel, string]> = [['team', 'Team map'], ['scope', 'Scope'], ['ac', 'AC check'], ['qa', 'QA check']];

const errorText = (failure: unknown, fallback: string) => (failure instanceof Error ? failure.message : fallback);

const QaChip: React.FC<{ ticket: DraftTicket; qaReason: string | null }> = ({ ticket, qaReason }) => {
  if (!ticket.prediction) return <span className={cn(chip, TONE.none)} title={qaReason ?? undefined}>{qaReason ? 'No QA' : 'QA pending'}</span>;
  return <span className={cn(chip, TONE[predictionTone(ticket.prediction.prediction)])} title={ticket.prediction.reasons.join('\n') || undefined}>{ticket.prediction.prediction}</span>;
};

const TeamPanel: React.FC<{ draft: SprintDraft }> = ({ draft }) => {
  const span = spanOf(draft);
  const labels = workingDayLabels(draft.startDate, span);
  const rows = lanes(draft);
  const waves = waveRows(draft);
  return (
    <div className="grid gap-5">
      <section aria-label="Load per developer">
        <h3 className={head}>Team map · load per developer</h3>
        <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          {rows.map((lane) => (
            <div key={lane.dev} className="rounded-md border border-border bg-surface-0 px-3 py-2.5">
              <b className="block font-display text-[0.84rem]" style={{ color: lane.color }}>{lane.dev}</b>
              <span className="font-mono text-[0.68rem] text-muted-foreground">{lane.sp} SP · {lane.tickets.length} tickets{lane.backlog ? ` · ${lane.backlog} backlog` : ''}</span>
            </div>
          ))}
        </div>
      </section>
      <section aria-label="Waves">
        <h3 className={head}>Waves · release order</h3>
        <ul className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
          {waves.map((row) => (
            <li key={row.wave} className="grid grid-cols-[90px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 max-[760px]:grid-cols-[90px_minmax(0,1fr)]">
              <span className="font-mono text-[0.72rem] font-bold">Wave {row.wave}<span className="block text-[0.62rem] font-normal text-muted-foreground">{row.count} tickets · {row.sp} SP</span></span>
              <span className="relative h-[10px] overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 bg-accent/60" style={{ width: `${Math.min(100, (row.closes / span) * 100)}%` }} />
                <span className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${(draft.sprintDays / span) * 100}%` }} />
              </span>
              <span className={cn('text-right font-mono text-[0.68rem] max-[760px]:col-span-2 max-[760px]:text-left', row.late ? 'text-status-conflict' : 'text-muted-foreground')}>
                closes {dayOf(row.closes)}{row.late ? ' · after sprint' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Schedule">
        <h3 className={head}>Schedule · every developer</h3>
        <div className="mt-2 overflow-hidden rounded-md border border-border bg-surface-0">
          <div className="overflow-x-auto">
            <div style={{ minWidth: `${112 + span * 64}px` }}>
              <div className="flex border-b border-border bg-surface-1 pl-[112px]">
                {Array.from({ length: span }, (_, index) => (
                  <div key={index} className={cn('flex-1 border-l border-border px-1.5 py-1.5 font-mono text-[0.6rem] text-muted-foreground', index >= draft.sprintDays && 'bg-surface-2')}>
                    <b className="block text-secondary-foreground">D{index + 1}</b>{labels[index] ?? ''}
                  </div>
                ))}
              </div>
              {rows.map((lane) => (
                <div key={lane.dev} className="flex min-h-[52px] border-b border-border last:border-b-0">
                  <div className="w-[112px] flex-none border-r border-border px-3 py-2.5">
                    <b className="block truncate font-display text-[0.84rem]" style={{ color: lane.color }}>{lane.dev}</b>
                    <span className="font-mono text-[0.6rem] text-muted-foreground">{lane.sp} SP</span>
                  </div>
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 z-[1] w-0.5 bg-foreground/50" style={{ left: `${(draft.sprintDays / span) * 100}%` }} aria-hidden="true" />
                    {lane.tickets.map((ticket) => {
                      const place = barPlace(ticket, span);
                      const flagged = draft.findings.some((finding) => finding.key === ticket.key && finding.kind === 'after-it');
                      return (
                        <div
                          key={ticket.key}
                          className={cn('absolute top-[7px] h-[38px] overflow-hidden rounded-[6px] border px-1.5 py-[3px]', !ticket.inSprint && 'opacity-60', flagged && 'shadow-[inset_3px_0_0_var(--color-status-warn)]')}
                          style={{ left: `calc(${place.left} + 2px)`, width: `calc(${place.width} - 4px)`, borderColor: lane.color, background: `color-mix(in oklch, ${lane.color} 14%, transparent)` }}
                          title={`${ticket.key} · ${ticket.summary} · ${dayOf(ticket.start + 0.001)} to ${dayOf(ticket.end)}`}
                        >
                          <div className="flex justify-between gap-1 whitespace-nowrap font-mono text-[10px] font-semibold" style={{ color: lane.color }}>
                            <span>{ticket.key.replace(/^[A-Z]+-/, '')}</span><span>W{ticket.wave}</span>
                          </div>
                          <div className="truncate text-[10px] leading-tight text-secondary-foreground">{ticket.summary}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-[0.7rem] text-muted-foreground">1 SP = {1 / draft.spPerDay} day. The line marks the end of the sprint; bars past it are backlog.</p>
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
    <div className="grid gap-5">
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
    <section aria-label="QA check" className="grid gap-3">
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
  open: boolean; changes: DraftChange[] | null; results: PublishResult[] | null; loading: boolean; publishing: boolean; error: string | null; onConfirm: () => void; onClose: () => void;
}> = ({ open, changes, results, loading, publishing, error, onConfirm, onClose }) => {
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
              <li key={result.key} className="flex flex-wrap items-baseline gap-2 border-b border-border py-2 text-[0.8rem] last:border-b-0">
                <span className="font-mono font-semibold">{result.key}</span>
                <span className={cn(chip, result.status === 'updated' ? TONE.ok : TONE.conflict)}>{result.status}</span>
                {result.detail && <span className="text-muted-foreground">{result.detail}</span>}
              </li>
            ))}
            {results.length === 0 && <li className="py-2 text-sm text-muted-foreground">Jira already matched the plan; nothing was written.</li>}
          </ul>
        ) : changes && (
          <>
            <p className="mt-2 text-pretty text-sm text-muted-foreground">Only what differs from Jira now is written: AC lines and assignees. A ticket whose AC changed in Jira since it was loaded is skipped.</p>
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
              {changes.length === 0 && <li className="py-2 text-sm text-muted-foreground">Jira already matches the plan.</li>}
            </ul>
          </>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose} disabled={publishing}>{results ? 'Close' : 'Cancel'}</Button>
          {!results && <Button variant="primary" onClick={onConfirm} disabled={publishing || loading || !changes || count === 0}><Send size={14} aria-hidden="true" />{publishing ? 'Publishing...' : `Publish ${count} ${count === 1 ? 'ticket' : 'tickets'}`}</Button>}
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
  const draftQuery = useQuery<{ sprintDraft: SprintDraft | null }>(GET_SPRINT_DRAFT, { variables: { sprint: chosen?.name ?? '' }, skip: !chosen, fetchPolicy: 'cache-and-network' });
  const [loadDraft, loading] = useMutation(LOAD_SPRINT_DRAFT);
  const [updateTicket, updating] = useMutation(UPDATE_SPRINT_DRAFT_TICKET);
  const [decide, deciding] = useMutation(DECIDE_SPRINT_DRAFT);
  const [refreshQa, refreshing] = useMutation(REFRESH_SPRINT_DRAFT_QA);
  const [publish, publishing] = useMutation(PUBLISH_SPRINT_DRAFT);
  const [preview, previewing] = useLazyQuery<{ previewSprintDraftPublish: DraftChange[] }>(PREVIEW_SPRINT_DRAFT_PUBLISH, { fetchPolicy: 'network-only' });
  const draft = draftQuery.data?.sprintDraft ?? null;
  const busy = loading.loading || updating.loading || deciding.loading || refreshing.loading || publishing.loading;

  const run = (work: Promise<unknown>, fallback: string) => {
    setNotice(null);
    work.then(() => draftQuery.refetch()).catch((failure: unknown) => setNotice(errorText(failure, fallback)));
  };
  const onLoad = () => chosen && run(loadDraft({ variables: { sprintId: chosen.id } }), 'The sprint could not be loaded from Jira');
  const onChange = (key: string, change: { dev?: string | null; wave?: number; sp?: number }) => draft && run(updateTicket({ variables: { sprint: draft.sprint, key, ...change } }), 'The ticket could not be changed');
  const onDecide = (id: string, action: string, note?: string) => draft && run(decide({ variables: { sprint: draft.sprint, id, action, note: note ?? null } }), 'The decision could not be saved');
  const onRefreshQa = () => draft && run(refreshQa({ variables: { sprint: draft.sprint } }), 'The QA check failed');
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

  return (
    <div className="grid gap-5">
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
            {draft.tickets.length} open tickets{draft.landed > 0 && ` (${draft.landed} already past merge)`} · {draft.sprintDays} working days · {draft.devs.length} developers · {late} AC {late === 1 ? 'line' : 'lines'} after it · {escalated} ESCALATED · {publishHint(draft)}
          </p>
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
        </>
      )}
      <PublishDialog
        open={publishOpen}
        changes={previewing.loading ? null : previewing.data?.previewSprintDraftPublish ?? null}
        results={results}
        loading={previewing.loading}
        publishing={publishing.loading}
        error={publishError}
        onConfirm={() => void onConfirm()}
        onClose={() => setPublishOpen(false)}
      />
    </div>
  );
};
