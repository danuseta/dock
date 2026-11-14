import React from 'react';
import { Gavel } from 'lucide-react';
import { Button } from '../components/ui';
import { GradeChip } from '../agents/JudgeDays';
import { callOf, ownerWaitText, wibStamp, type SessionJudge } from '../agents/judge';

const label = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

const STATUS_TEXT: Record<string, string> = { pending: 'Waiting for the next Judge window', running: 'Judge is reading it now', failed: 'Judge failed three times' };

/** The session's Judge block: grade, the findings that stand by cause, and Judge again. */
export const SessionJudgeView: React.FC<{ judge: SessionJudge; canAct: boolean; busy: boolean; notice: string | null; onAgain: () => void }> = ({ judge, canAct, busy, notice, onAgain }) => {
  const standing = judge.findings.filter((finding) => callOf(finding) === 'mistake');
  const causes = [...new Set(standing.map((finding) => finding.causeLabel))];
  const wait = ownerWaitText(judge.ownerWaitMinutes);
  return (
    <section className="flex flex-col gap-2" aria-label="Judge">
      <h3 className={label}>Judge{judge.judgedAt ? ` · ${wibStamp(judge.judgedAt)}` : ''}</h3>
      {judge.status !== 'judged' && <p className="text-xs text-muted-foreground">{STATUS_TEXT[judge.status] ?? judge.status}{judge.error ? `: ${judge.error}` : ''}</p>}
      {judge.grade && (
        <div className="flex items-center gap-2">
          <GradeChip grade={judge.grade} className="size-8 text-base" />
          <span className="text-[0.74rem] text-secondary-foreground">{standing.length} {standing.length === 1 ? 'finding' : 'findings'}{wait ? ` · owner waited about ${wait}` : ''}</span>
        </div>
      )}
      {causes.length > 0 && <div className="flex flex-wrap gap-1">{causes.map((cause) => <span key={cause} className="rounded-xs border border-status-conflict/40 px-1.5 py-px font-mono text-[0.62rem] text-status-conflict">{cause}</span>)}</div>}
      {canAct && <Button size="sm" variant="ghost" className="self-start max-[900px]:h-11" disabled={busy || judge.status === 'running'} onClick={onAgain}><Gavel size={13} aria-hidden="true" />Judge again</Button>}
      {notice && <p className="text-xs text-secondary-foreground" role="status">{notice}</p>}
    </section>
  );
};
