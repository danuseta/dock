import React, { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { AgentIssue, AgentRun } from '../../agents/runs';
import { DECISION_TONE, canCancel, openIssues, reportDecisions } from '../../lib/sousReport';
import { Badge, Button, Input } from '../ui';

interface SousReportProps {
  run: AgentRun;
  /** Each answer and cancel starts a new sous session on the ticket's machine; rejects with the reason when it cannot. */
  onAnswer: (issue: number, text: string) => Promise<void>;
  onCancel: (decision: number, note: string) => Promise<void>;
  busy: boolean;
  /** Set when this DOCK cannot act, for example a run the other DOCK reports. */
  blocked?: string | null;
}

const IssueAnswer: React.FC<{ issue: AgentIssue; busy: boolean; onAnswer: SousReportProps['onAnswer'] }> = ({ issue, busy, onAnswer }) => {
  const [draft, setDraft] = useState('');
  const send = (text: string) => {
    if (!text.trim()) return;
    void onAnswer(issue.n, text.trim()).then(() => setDraft(''), () => undefined);
  };
  return (
    <div className="flex basis-full flex-wrap items-center gap-2 pt-1">
      {issue.options.map((option, index) => <Button key={option} size="sm" variant={index === 0 ? 'primary' : 'default'} disabled={busy} onClick={() => send(option)}>{option}</Button>)}
      <form className="flex min-w-[220px] flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
        <Input className="h-8 min-w-0 flex-1 text-sm max-[760px]:h-11" value={draft} placeholder={issue.options.length ? 'Or write your own answer...' : 'Answer the agent...'} aria-label={`Answer to I-${issue.n}`} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
        <Button size="sm" type="submit" disabled={busy || !draft.trim()} aria-label={`Send the answer to I-${issue.n}`}><SendHorizontal size={14} aria-hidden="true" />Send</Button>
      </form>
    </div>
  );
};

const CancelForm: React.FC<{ n: number; busy: boolean; onCancel: SousReportProps['onCancel']; onClose: () => void }> = ({ n, busy, onCancel, onClose }) => {
  const [note, setNote] = useState('');
  return (
    <form className="flex basis-full items-center gap-2 pt-1" onSubmit={(event) => { event.preventDefault(); if (note.trim()) void onCancel(n, note.trim()).then(onClose, () => undefined); }}>
      <Input autoFocus className="h-8 min-w-0 flex-1 text-sm max-[760px]:h-11" value={note} placeholder="Why, for the agent..." aria-label={`Reason to cancel D-${n}`} disabled={busy} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} />
      <Button size="sm" variant="danger" type="submit" disabled={busy || !note.trim()}>Batalkan D-{n}</Button>
      <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Keep</Button>
    </form>
  );
};

/** What sous recorded on the ticket: the issues waiting on the owner first, then every decision and who took it. */
export const SousReport: React.FC<SousReportProps> = ({ run, onAnswer, onCancel, busy, blocked }) => {
  const [cancelling, setCancelling] = useState<number | null>(null);
  const { owner, others } = openIssues(run);
  const decisions = reportDecisions(run);
  return (
    <section id="laporan-sous" className="scroll-mt-6" aria-label="Laporan sous">
      <h2 className="mb-1.5 flex flex-wrap items-baseline gap-2 font-display text-sm font-bold">
        Laporan sous
        {run.rounds && <span className="font-body text-xs font-medium text-muted-foreground">Round {run.rounds.used} of {run.rounds.max}</span>}
        {run.draft && <Badge variant="draft">Draft PR</Badge>}
        {run.productionData && <Badge variant="danger">Production data</Badge>}
      </h2>
      {owner.length === 0 && others.length === 0 && decisions.length === 0 && <p className="text-pretty text-sm text-muted-foreground">No issues or decisions recorded yet.</p>}
      {blocked && (owner.length > 0 || decisions.some(canCancel)) && <p className="text-pretty text-xs text-muted-foreground">{blocked}</p>}
      <ul className="flex flex-col">
        {owner.map((issue) => (
          <li key={`i-${issue.n}`} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-l-[3px] border-status-warn bg-status-warn-bg px-3 py-1.5 text-sm">
            <span className="font-mono text-[0.68rem] font-bold text-status-warn">I-{issue.n} · Waiting on you</span>
            <span className="font-mono text-[0.68rem] font-bold uppercase text-muted-foreground">{issue.type}</span>
            <span className="min-w-0 text-pretty text-foreground">{issue.text}</span>
            {!blocked && <IssueAnswer issue={issue} busy={busy} onAnswer={onAnswer} />}
          </li>
        ))}
        {others.map((issue) => (
          <li key={`i-${issue.n}`} className="flex flex-wrap items-baseline gap-x-2.5 py-1 text-sm">
            <span className="font-mono text-[0.68rem] font-bold text-muted-foreground">I-{issue.n} · {issue.level}</span>
            <span className="min-w-0 text-pretty text-secondary-foreground">{issue.text}</span>
          </li>
        ))}
        {decisions.map((decision) => (
          <li key={`d-${decision.n}`} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-1 text-sm">
            <span className="font-mono text-[0.68rem] font-bold text-muted-foreground">D-{decision.n}</span>
            <Badge variant={DECISION_TONE[decision.status ?? 'DECIDED'] ?? 'neutral'} className="text-[0.62rem]">{decision.status ?? 'DECIDED'}</Badge>
            <span className="font-mono text-[0.68rem] text-muted-foreground">by {decision.by ?? 'owner'}{decision.issue ? ` · I-${decision.issue}` : ''}</span>
            <span className="min-w-0 text-pretty text-foreground">{decision.text}</span>
            {decision.status === 'CANCELLED' && decision.cancelNote && <span className="basis-full text-pretty text-xs text-status-conflict">Cancelled: {decision.cancelNote}</span>}
            {!blocked && canCancel(decision) && cancelling !== decision.n && (
              <button type="button" className="text-sm font-semibold text-status-conflict hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 max-[760px]:min-h-11" disabled={busy} onClick={() => setCancelling(decision.n)}>Batalkan</button>
            )}
            {cancelling === decision.n && <CancelForm n={decision.n} busy={busy} onCancel={onCancel} onClose={() => setCancelling(null)} />}
          </li>
        ))}
      </ul>
    </section>
  );
};
