import React from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Button, Textarea } from '../components/ui';
import { cn } from '../lib/cn';
import { GradeChip } from './JudgeDays';
import { callOf, dayLabel, findingHref, gradeOf, ownerWaitText, withCalls, wibTime, type JudgeCall, type JudgeDaySheet as Sheet, type JudgeFinding } from './judge';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const kindOf = (title: string) => /^(Task|Review|QA)-/.exec(title)?.[1] ?? 'Manual';

export interface ViewProps {
  sheet: Sheet;
  calls: Record<string, JudgeCall>;
  notes: Record<string, string>;
  dayNote: string;
  busy: boolean;
  onCall: (finding: JudgeFinding, call: JudgeCall) => void;
  onNote: (finding: JudgeFinding, note: string) => void;
  onNoteDone: (finding: JudgeFinding) => void;
  onDayNote: (note: string) => void;
  onBack: () => void;
  onDay: (day: string) => void;
  onConfirm: () => void;
  onNavigate: (path: string) => void;
}

const BackButton: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={13} aria-hidden="true" />Days of the sprint</Button>
);

const Finding: React.FC<{ finding: JudgeFinding; note: string; busy: boolean; onCall: ViewProps['onCall']; onNote: ViewProps['onNote']; onNoteDone: ViewProps['onNoteDone']; onNavigate: ViewProps['onNavigate'] }> = ({ finding, note, busy, onCall, onNote, onNoteDone, onNavigate }) => {
  const call = callOf(finding);
  return (
    <li className={cn('border-t border-border py-3 first:border-t-0', call === 'not' && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-xs border px-1.5 py-px font-mono text-[0.64rem] font-bold', finding.cause === 'environment' ? 'border-border text-muted-foreground' : 'border-status-conflict/40 text-status-conflict')}>{finding.causeLabel}</span>
        <button type="button" onClick={() => onNavigate(findingHref(finding))} className="ml-auto inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[0.7rem] font-semibold text-accent hover:underline max-[760px]:min-h-11">
          {finding.threadUrl ? 'Open thread' : finding.messageId ? 'Open at message' : 'Open session'}<ExternalLink size={11} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-1.5 text-pretty text-[0.84rem] text-foreground">{finding.text}</p>
      {finding.quote && <p className="mt-1 border-l-2 border-border pl-2 text-[0.74rem] italic text-muted-foreground">{finding.quote}</p>}
      {finding.shouldHave && <p className="mt-1 text-[0.78rem] text-secondary-foreground"><b className="font-semibold text-foreground">Should have:</b> {finding.shouldHave}</p>}
      <div className="mt-2 inline-flex overflow-hidden rounded-xs border border-border-glow font-mono text-[0.68rem]" role="radiogroup" aria-label="Your call">
        {(['mistake', 'not'] as const).map((option) => (
          <button key={option} type="button" role="radio" aria-checked={call === option} disabled={busy} onClick={() => onCall(finding, option)} className={cn('px-2.5 py-1 max-[760px]:min-h-11 max-[760px]:px-3.5', call === option ? (option === 'mistake' ? 'bg-status-conflict-bg font-bold text-status-conflict' : 'bg-surface-hover font-bold text-foreground') : 'text-secondary-foreground hover:bg-surface-1')}>
            {option === 'mistake' ? 'Mistake' : 'Not a mistake'}
          </button>
        ))}
      </div>
      {call === 'not' && (
        <Textarea aria-label="Why it is not a mistake (optional)" placeholder="Why it is not a mistake (optional): Judge reads this as an example next time" className="mt-2 min-h-[56px] text-[0.78rem]" value={note} onChange={(event) => onNote(finding, event.target.value)} onBlur={() => onNoteDone(finding)} />
      )}
    </li>
  );
};

/** Step B, one day's sheet: the day list is hidden, Judge's calls are preset, the owner flips what they disagree with and confirms. */
export const JudgeDaySheetView: React.FC<ViewProps> = ({ sheet, calls, notes, dayNote, busy, onCall, onNote, onNoteDone, onDayNote, onBack, onDay, onConfirm, onNavigate }) => {
  const sessions = sheet.sessionList.map((session) => {
    const findings = withCalls(session.findings, calls);
    return { ...session, findings, grade: session.status === 'judged' || findings.length ? gradeOf(findings, session.ownerWaitMinutes) : session.grade };
  });
  const flagged = sessions.filter((session) => session.findings.length > 0);
  const clean = sessions.filter((session) => session.findings.length === 0);
  const worst = sessions.reduce((grade, session) => (session.grade && session.grade > grade ? session.grade : grade), 'A');
  const worstFrom = sessions.filter((session) => session.grade === worst && worst !== 'A').map((session) => session.title);
  const kinds = sessions.reduce<Record<string, number>>((count, session) => ({ ...count, [kindOf(session.title)]: (count[kindOf(session.title)] ?? 0) + 1 }), {});
  const lost = ownerWaitText(sessions.filter((session) => session.findings.some((finding) => callOf(finding) === 'mistake' && finding.cause !== 'environment')).reduce((sum, session) => sum + session.ownerWaitMinutes, 0));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <BackButton onBack={onBack} />
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" disabled={!sheet.previousDay} onClick={() => sheet.previousDay && onDay(sheet.previousDay)}><ChevronLeft size={13} aria-hidden="true" />{sheet.previousDay ? dayLabel(sheet.previousDay) : 'Earlier'}</Button>
          <Button size="sm" variant="ghost" disabled={!sheet.nextDay} onClick={() => sheet.nextDay && onDay(sheet.nextDay)}>{sheet.nextDay ? dayLabel(sheet.nextDay) : 'Later'}<ChevronRight size={13} aria-hidden="true" /></Button>
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-6 max-[1000px]:grid-cols-1">
        <section aria-label={`Sheet of ${dayLabel(sheet.day)}`} className="min-w-0">
          <h3 className="font-display text-lg font-bold">{dayLabel(sheet.day)}{sheet.judgedAt ? ` · judged ${wibTime(sheet.judgedAt)}` : ''} · {sheet.sessions} {sheet.sessions === 1 ? 'session' : 'sessions'}, {flagged.length} with findings</h3>
          <p className="mt-1 text-pretty text-[0.8rem] text-secondary-foreground">Judge's call for the day. Change only what you disagree with, then confirm.</p>
          {flagged.map((session) => (
            <article key={session.sessionId} className="mt-4 rounded-md border border-border bg-surface-0 px-3.5 py-2" aria-label={session.title}>
              <header className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-display text-[0.9rem] font-semibold">{session.title}</span>
                <GradeChip grade={session.grade} />
                <span className="font-mono text-[0.66rem] text-muted-foreground">{session.origin}{session.startedAt && session.lastMessageAt ? ` · ${wibTime(session.startedAt)}–${wibTime(session.lastMessageAt)}` : ''}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onNavigate(`/sessions?session=${encodeURIComponent(session.sessionId)}`)}>Open</Button>
              </header>
              <ul>{session.findings.map((finding) => <Finding key={finding.id} finding={finding} note={notes[finding.id] ?? finding.note ?? ''} busy={busy} onCall={onCall} onNote={onNote} onNoteDone={onNoteDone} onNavigate={onNavigate} />)}</ul>
            </article>
          ))}
          {clean.length > 0 && <p className="mt-4 text-pretty text-[0.78rem] text-muted-foreground">{clean.length} {clean.length === 1 ? 'session' : 'sessions'} without findings: {clean.map((session) => session.title).join(', ')}{clean.every((session) => session.grade === 'A') ? ' · all A' : ''}</p>}
          <label className="mt-5 block text-[0.76rem]">
            <span className="mb-1 block font-medium text-secondary-foreground">Note for Judge about this day (optional)</span>
            <Textarea className="min-h-[64px] text-[0.8rem]" value={dayNote} onChange={(event) => onDayNote(event.target.value)} />
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <BackButton onBack={onBack} />
            <Button size="sm" variant="primary" className="ml-auto" disabled={busy} onClick={onConfirm}>Confirm {dayLabel(sheet.day)}</Button>
          </div>
        </section>
        <aside aria-label="The day" className="h-fit rounded-md border border-border bg-surface-0 p-3.5 text-[0.8rem] text-secondary-foreground">
          <h3 className={head}>The day</h3>
          <p className="mt-2"><b className="text-foreground">Sessions.</b> {sheet.judged} judged{Object.keys(kinds).length ? `: ${Object.entries(kinds).map(([kind, count]) => `${kind} ${count}`).join(', ')}` : ''}. {sheet.pending ? `${sheet.pending} still waiting.` : 'None left waiting.'}</p>
          <p className="mt-2"><b className="text-foreground">Grade.</b> {worst}{worstFrom.length ? `, from ${worstFrom.join(' and ')}` : ''}.</p>
          <p className="mt-2"><b className="text-foreground">Owner time lost.</b> {lost ? `About ${lost}.` : 'None.'}</p>
          <p className="mt-2"><b className="text-foreground">Not answered by noon tomorrow?</b> Judge's call stands; you can still change it until the sprint sheet is accepted.</p>
        </aside>
      </div>
    </div>
  );
};
