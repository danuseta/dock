import React from 'react';
import { ArrowLeft, Check, X } from 'lucide-react';
import { Button } from '../components/ui';
import { GradeChip } from './JudgeDays';
import { dayLabel, wibStamp, type JudgeSprintSheet, type MergedRetroItem } from './judge';

const KIND_LABEL: Record<string, string> = { keep: 'Keep', problem: 'Problem', try: 'Try' };
const DEST_LABEL: Record<string, string> = { kit: 'kit PR', memory: 'memory', dock: 'DOCK issue', note: 'note only', 'qa-agent': 'QA bot triage rule (PR by a developer)' };
const SOURCE_LABEL: Record<string, string> = { ledger: 'Ledger', judge: 'Judge' };
const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

export const SourceChips: React.FC<{ sources: string[] }> = ({ sources }) => (
  <span className="flex flex-wrap gap-1">{sources.map((source) => <span key={source} className="rounded-pill border border-border-glow px-1.5 font-mono text-[0.58rem] leading-4 text-secondary-foreground">{SOURCE_LABEL[source] ?? source}</span>)}</span>
);

const BackToDays: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={13} aria-hidden="true" />Days of the sprint</Button>
);

interface SprintSheetProps {
  sprint: string;
  previous: string | null;
  sheet: JudgeSprintSheet;
  patterns: MergedRetroItem[];
  busy: boolean;
  onBack: () => void;
  onOpenDay: (day: string) => void;
  onAction: (entry: MergedRetroItem, action: string) => void;
}

/** The Sprint sheet: the sprint's numbers, findings by cause, days still waiting, and the Problem / Try lines to accept. */
export const SprintSheet: React.FC<SprintSheetProps> = ({ sprint, previous, sheet, patterns, busy, onBack, onOpenDay, onAction }) => {
  const top = Math.max(1, ...sheet.causes.map((cause) => cause.count));
  const stats: Array<[string, string]> = [
    [`${sheet.daysAnswered} of ${sheet.dayCount}`, `days answered · ${sheet.sessions} sessions${sheet.waiting ? ` · ${sheet.waiting} not judged yet` : ''}`],
    [String(sheet.judged), `sessions judged · ${sheet.waiting} waiting${sheet.lastRun ? ` · last run ${wibStamp(sheet.lastRun)}` : ''}`],
    [String(sheet.findings), `findings in ${sheet.findingSessions} sessions`],
    [`${sheet.ownerHours} h`, 'owner time lost to agent mistakes'],
  ];
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center gap-2"><BackToDays onBack={onBack} /><span className="font-display text-[0.95rem] font-bold">{sprint} · Sprint sheet</span></div>
      <dl className="grid grid-cols-5 border-y border-border max-[900px]:grid-cols-2">
        {stats.map(([value, label]) => (
          <div key={label} className="border-r border-border px-4 py-3 max-[900px]:[&:nth-child(2n)]:border-r-0">
            <dd className="font-display text-2xl font-bold tabular-nums">{value}</dd>
            <dt className="text-[0.72rem] text-muted-foreground">{label}</dt>
          </div>
        ))}
        <div className="px-4 py-3">
          <dd><GradeChip grade={sheet.grade} className="size-8 text-base" /></dd>
          <dt className="text-[0.72rem] text-muted-foreground">sprint grade{sheet.previousGrade ? ` · ${previous ?? 'last sprint'} was ${sheet.previousGrade}` : ''}</dt>
        </div>
      </dl>
      {sheet.summary && <p className="text-sm text-secondary-foreground" role="status">Sprint summary: {sheet.summary.status === 'waiting' ? 'waiting for the queue (until 23:30)' : sheet.summary.status === 'running' ? 'running' : 'done'}{sheet.summary.notJudged ? ` · ${sheet.summary.notJudged} sessions not judged yet` : ''}.</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 max-[1000px]:grid-cols-1">
        <section aria-label="Findings by cause">
          <h3 className={head}>Findings by cause</h3>
          {sheet.causes.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No findings yet.</p> : (
            <ul className="mt-2">
              {sheet.causes.map((cause) => (
                <li key={cause.cause} className="grid grid-cols-[180px_minmax(0,1fr)_32px] items-center gap-3 border-b border-border py-2 text-[0.8rem] last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)_32px]">
                  <span>{cause.label}</span>
                  <span className="h-2 overflow-hidden rounded-pill bg-surface-2 max-[760px]:col-span-2 max-[760px]:row-start-2" aria-hidden="true"><span className="block h-full bg-status-conflict" style={{ width: `${Math.round((cause.count / top) * 100)}%` }} /></span>
                  <span className="text-right font-mono tabular-nums">{cause.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Waiting for you">
          <h3 className={head}>Waiting for you ({sheet.waitingDays.length} {sheet.waitingDays.length === 1 ? 'day' : 'days'})</h3>
          {sheet.waitingDays.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Every day is answered.</p> : (
            <ul className="mt-2">{sheet.waitingDays.map((day) => (
              <li key={day.day}><button type="button" onClick={() => onOpenDay(day.day)} className="w-full border-0 border-b border-border bg-transparent py-2 text-left text-[0.8rem] hover:bg-surface-1 max-[760px]:min-h-11">{dayLabel(day.day)}, {day.findings} {day.findings === 1 ? 'finding' : 'findings'}. Until you confirm, Judge&apos;s call counts.</button></li>
            ))}</ul>
          )}
        </section>
      </div>
      <section aria-label="Patterns to accept">
        <h3 className={head}>Patterns to accept</h3>
        {patterns.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No Problem or Try line waits. The Judge sprint summary posts them at the end of the sprint.</p> : (
          <ol className="mt-1">
            {patterns.map((entry) => (
              <li key={entry.item.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0 max-[760px]:grid-cols-[minmax(0,1fr)]">
                <span className="flex flex-col gap-1 pt-0.5 font-mono text-[0.66rem] font-bold uppercase tracking-[0.08em] text-secondary-foreground">{KIND_LABEL[entry.item.kind] ?? entry.item.kind}<SourceChips sources={entry.sources} /></span>
                <div className="min-w-0">
                  <p className="text-pretty text-[0.84rem] text-foreground">{entry.item.text}</p>
                  <p className="mt-1 text-[0.72rem] text-muted-foreground">{[...new Set([...entry.item.evidence, ...entry.others.flatMap((other) => other.evidence)])].join(' · ')}</p>
                  <p className="mt-1 font-mono text-[0.64rem] text-muted-foreground">goes to {DEST_LABEL[entry.item.dest] ?? entry.item.dest}</p>
                </div>
                <div className="flex flex-wrap items-start justify-end gap-1.5 max-[760px]:justify-start">
                  <Button size="sm" variant="ghost" onClick={() => onAction(entry, 'close')} disabled={busy}><X size={13} aria-hidden="true" />Reject</Button>
                  <Button size="sm" variant="primary" onClick={() => onAction(entry, 'accept')} disabled={busy}><Check size={13} aria-hidden="true" />Accept</Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <div><BackToDays onBack={onBack} /></div>
    </div>
  );
};
