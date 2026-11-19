import React from 'react';
import { ChevronRight, Gavel } from 'lucide-react';
import { Button } from '../components/ui';
import { GradeChip } from '../agents/JudgeDays';
import { judgeHref, wibStamp, type SessionJudge } from '../agents/judge';

const STATUS_TEXT: Record<string, string> = { pending: 'Waiting for the next Judge window', running: 'Judge is reading it now', failed: 'Judge failed three times' };

/** The session's Judge line: the grade, which opens Retro > Judge on the session's day, and Judge again. */
export const SessionJudgeView: React.FC<{ judge: SessionJudge; day: string | null; canAct: boolean; busy: boolean; notice: string | null; onAgain: () => void; onNavigate?: (path: string) => void }> = ({ judge, day, canAct, busy, notice, onAgain, onNavigate }) => {
  const href = judgeHref('', { day });
  return (
    <section className="flex flex-col gap-1.5" aria-label="Judge">
      <a
        href={href}
        onClick={(event) => { if (!onNavigate) return; event.preventDefault(); onNavigate(href); }}
        className="flex items-center gap-2 self-start rounded-sm text-[0.74rem] text-secondary-foreground hover:text-foreground max-[900px]:min-h-11"
      >
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Judge</span>
        {judge.grade ? <GradeChip grade={judge.grade} /> : <span>{STATUS_TEXT[judge.status] ?? judge.status}</span>}
        {judge.judgedAt && <span className="font-mono text-[0.66rem] text-muted-foreground">{wibStamp(judge.judgedAt)}</span>}
        <ChevronRight size={13} aria-hidden="true" className="text-muted-foreground" />
      </a>
      {canAct && <Button size="sm" variant="ghost" className="self-start max-[900px]:h-11" disabled={busy || judge.status === 'running'} onClick={onAgain}><Gavel size={13} aria-hidden="true" />Judge again</Button>}
      {notice && <p className="text-xs text-secondary-foreground" role="status">{notice}</p>}
    </section>
  );
};
