import React from 'react';
import { Hand } from 'lucide-react';
import type { AgentRun } from './runs';
import { RunDecisions } from './RunDecisions';
import { RunQuestions } from './RunQuestions';
import { ownerChecks, waitsOnOwner } from '../lib/sousReport';
import { useOwnerChecks } from './useOwnerChecks';
import { Badge, Button, Card } from '../components/ui';

interface OwnerChecksProps {
  runs: AgentRun[];
  /** Why this DOCK cannot act; hides the controls. */
  readOnly: string | null;
  onTicketClick: (key: string) => void;
  onToast: (toast: { message: string; type: 'success' | 'error' }) => void;
}

/** Builds whose pull requests wait on the owner before review: open issues to answer and guessed decisions to confirm or change. */
export const OwnerChecks: React.FC<OwnerChecksProps> = ({ runs, readOnly, onTicketClick, onToast }) => {
  const checks = useOwnerChecks();
  const waiting = runs.filter(waitsOnOwner).map((run) => ({ run, ...ownerChecks(run) }));
  if (!waiting.length) return null;

  const report = async (work: () => Promise<void>, done: string) => {
    try {
      await work();
      onToast({ message: done, type: 'success' });
    } catch (error) {
      onToast({ message: error instanceof Error ? error.message : 'DOCK could not save it', type: 'error' });
      throw error;
    }
  };

  return (
    <section className="mb-8 flex flex-col gap-4" aria-label="Before review">
      <h2 className="font-display text-lg font-bold">Before review <span className="text-sm font-normal text-muted-foreground">· the pull requests stay draft until you settle these</span></h2>
      {waiting.map(({ run, issues, decisions }) => (
        <Card key={run.key} className="flex flex-col gap-3 border-amber-300/45">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Badge variant="neutral" className="shrink-0 gap-1.5 border-amber-300/45 bg-amber-300/10 px-3 py-2 text-sm text-amber-200"><Hand size={16} aria-hidden="true" />{run.key}</Badge>
              <div className="min-w-0">
                <p className="truncate font-medium">{run.title || 'Untitled'}</p>
                <p className="font-mono text-[0.68rem] text-muted-foreground">{[issues.length && `${issues.length} to answer`, decisions.length && `${decisions.length} to confirm`].filter(Boolean).join(' · ')}{(run.prBe || run.prFe) ? ' · PR draft' : ' · no PR yet'}</p>
              </div>
            </div>
            <Button size="sm" onClick={() => onTicketClick(run.key)}>Inspect Ticket</Button>
          </div>
          {issues.length > 0 && <RunQuestions run={run} busy={checks.busy} readOnly={readOnly} onAnswer={(n, text) => report(() => checks.answerIssue(run.key, n, text), `I-${n} answered: a new sous session picks it up.`)} />}
          {decisions.length > 0 && (
            <RunDecisions
              run={run}
              pendingOnly
              busy={checks.busy}
              readOnly={readOnly}
              onConfirm={(ns) => report(() => checks.confirmDecisions(run.key, ns), `Confirmed ${ns.map((n) => `D-${n}`).join(', ')}.`)}
              onChange={(n, choice) => report(() => checks.changeDecision(run.key, n, choice), `D-${n} change sent: a new sous session revises the work.`)}
            />
          )}
        </Card>
      ))}
    </section>
  );
};
