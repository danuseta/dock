import React from 'react';
import { ChevronRight, Gavel } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { GRADE_CLASS, answeredText, dayCounts, dayLabel, dayStatusText, sheetLine, type JudgeDays as JudgeDaysData } from './judge';
import { InfoTip } from './InfoTip';

const head = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

export const GradeChip: React.FC<{ grade: string | null | undefined; className?: string }> = ({ grade, className }) => (
  grade ? <span className={cn('inline-grid size-6 flex-none place-items-center rounded-xs border font-mono text-[0.72rem] font-bold', GRADE_CLASS[grade] ?? 'border-border text-muted-foreground', className)} aria-label={`Grade ${grade}`}>{grade}</span> : null
);

const STATUS_CLASS: Record<string, string> = { waiting: 'text-status-warn', confirmed: 'text-status-merged', nothing: 'text-muted-foreground', stood: 'text-secondary-foreground' };

interface JudgeDaysProps {
  data: JudgeDaysData;
  onOpenDay: (day: string) => void;
  onOpenSprint: () => void;
  onJudgeNow: () => void;
  busy: boolean;
}

/** Step A, Days of the sprint: one row per day Judge read, newest first, and the Sprint sheet as the last row. */
export const JudgeDays: React.FC<JudgeDaysProps> = ({ data, onOpenDay, onOpenSprint, onJudgeNow, busy }) => (
  <section aria-label="Days of the sprint" className="min-w-0">
    <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className={head}>Hari sprint</h3>
      <InfoTip label="Tentang Judge">Judge baca session yang udah sepi, malam hari. Hari muncul di sini setelah ada session sprint ini yang dinilai.</InfoTip>
      <span className="text-[0.76rem] text-muted-foreground">{data.days.length ? answeredText(data.days) : 'belum ada session yang dinilai'}</span>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onJudgeNow} disabled={busy}><Gavel size={13} aria-hidden="true" />Nilai sekarang</Button>
    </div>
    <ul className="border-t border-border">
      {data.days.map((row) => (
        <li key={row.day}>
          <button type="button" onClick={() => onOpenDay(row.day)} className="grid w-full grid-cols-[112px_minmax(0,1fr)_28px_minmax(150px,auto)_16px] items-center gap-3 border-b border-border px-1 py-3 text-left hover:bg-surface-1 max-[760px]:grid-cols-[minmax(0,1fr)_28px_16px] max-[760px]:min-h-11">
            <span className="font-display text-[0.86rem] font-semibold">{dayLabel(row.day)}</span>
            <span className="min-w-0 truncate text-[0.78rem] text-secondary-foreground max-[760px]:col-start-1 max-[760px]:row-start-2">{dayCounts(row)}</span>
            <span className="max-[760px]:col-start-2 max-[760px]:row-start-1"><GradeChip grade={row.grade} /></span>
            <span className={cn('text-right text-[0.76rem] max-[760px]:col-start-1 max-[760px]:row-start-3 max-[760px]:text-left', STATUS_CLASS[row.status])}>{dayStatusText(row)}</span>
            <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground max-[760px]:col-start-3 max-[760px]:row-start-1" />
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={onOpenSprint} className="grid w-full grid-cols-[112px_minmax(0,1fr)_16px] items-center gap-3 border-b border-border px-1 py-3 text-left hover:bg-surface-1 max-[760px]:grid-cols-[minmax(0,1fr)_16px] max-[760px]:min-h-11">
          <span className="font-display text-[0.86rem] font-semibold">Lembar sprint</span>
          <span className="min-w-0 truncate text-[0.78rem] text-secondary-foreground max-[760px]:col-start-1 max-[760px]:row-start-2">{sheetLine(data.sheet)}</span>
          <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground max-[760px]:col-start-2 max-[760px]:row-start-1" />
        </button>
      </li>
    </ul>
  </section>
);
