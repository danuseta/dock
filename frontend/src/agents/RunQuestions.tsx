import React, { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { AgentIssue, AgentRun } from './runs';
import { openIssues, reportAge } from '../lib/sousReport';
import { Button, Input } from '../components/ui';

interface RunQuestionsProps {
  run: AgentRun;
  /** Each answer starts a new sous session on the ticket's machine; rejects with the reason when it cannot. */
  onAnswer: (issue: number, text: string) => Promise<void>;
  busy: boolean;
  /** Why this DOCK cannot answer; hides the answer controls. */
  readOnly?: string | null;
}

const IssueAnswer: React.FC<{ issue: AgentIssue; busy: boolean; onSend: (text: string) => void }> = ({ issue, busy, onSend }) => {
  const [draft, setDraft] = useState('');
  const send = (text: string) => { if (text.trim()) onSend(text.trim()); };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {issue.options.map((option, index) => <Button key={option} size="sm" variant={index === 0 ? 'primary' : 'default'} className="max-[760px]:h-11" disabled={busy} onClick={() => send(option)}>{option}</Button>)}
      <form className="flex min-w-[200px] flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
        <Input className="h-8 min-w-0 flex-1 text-sm max-[760px]:h-11" value={draft} placeholder={issue.options.length ? 'Or write your own answer...' : 'Answer the agent...'} aria-label={`Answer to I-${issue.n}`} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
        <Button size="sm" type="submit" className="max-[760px]:h-11" disabled={busy || !draft.trim()} aria-label={`Send the answer to I-${issue.n}`}><SendHorizontal size={14} aria-hidden="true" />Send</Button>
      </form>
    </div>
  );
};

/** The open sous questions that wait on the owner, oldest first, each with its answer box; an answered one shows what was sent. */
export const RunQuestions: React.FC<RunQuestionsProps> = ({ run, onAnswer, busy, readOnly }) => {
  const [answered, setAnswered] = useState<Record<number, string>>({});
  const { owner, others } = openIssues(run);
  const waiting = owner.filter((issue) => !(issue.n in answered));
  const send = (issue: number, text: string) => {
    void onAnswer(issue, text).then(() => setAnswered((current) => ({ ...current, [issue]: text })), () => undefined);
  };
  return (
    <section id="run-waiting" className="flex scroll-mt-4 flex-col gap-2" aria-label="Waiting on you">
      {owner.filter((issue) => issue.n in answered).map((issue) => (
        <div key={issue.n} className="rounded-[8px] border border-status-merged/40 bg-status-merged-bg px-3 py-2.5 text-sm">
          <b className="mb-0.5 block font-mono text-[0.66rem] font-bold uppercase tracking-[0.08em] text-status-merged">Answered · I-{issue.n}</b>
          <p className="text-pretty">{issue.text}</p>
          <p className="mt-1 text-pretty"><span className="font-mono text-xs text-muted-foreground">You: </span>{answered[issue.n]}</p>
          <p className="mt-1 text-pretty text-xs text-muted-foreground">A new sous session picks it up on the next free slot.</p>
        </div>
      ))}
      {waiting.length > 0 && (
        <div className="rounded-[8px] border border-amber-300/50 bg-amber-300/10 px-3 py-2.5 text-sm">
          <p className="mb-1 flex flex-wrap justify-between gap-2 font-mono text-[0.66rem] font-bold uppercase tracking-[0.08em] text-amber-200">
            <span>Waiting on you · {waiting.length}</span>
            {waiting[0].at && <span className="font-medium normal-case tracking-normal text-muted-foreground">asked {reportAge(waiting[0].at)}</span>}
          </p>
          {waiting.map((issue) => (
            <div key={issue.n} className="border-t border-amber-300/20 py-2 first:border-t-0 first:pt-0 last:pb-0">
              <p className="font-mono text-[0.68rem] font-bold text-amber-200">I-{issue.n} · {issue.type.toLowerCase()}</p>
              <p className="text-pretty">{issue.text}</p>
              {!readOnly && <IssueAnswer issue={issue} busy={busy} onSend={(text) => send(issue.n, text)} />}
            </div>
          ))}
          {readOnly && <p className="mt-1.5 text-pretty text-xs text-muted-foreground">{readOnly}</p>}
        </div>
      )}
      {others.map((issue) => (
        <p key={issue.n} className="text-pretty text-xs text-muted-foreground"><span className="font-mono font-bold">I-{issue.n} · {issue.level}</span> {issue.text}</p>
      ))}
    </section>
  );
};
