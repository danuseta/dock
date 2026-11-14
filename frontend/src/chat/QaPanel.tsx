import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { FlaskConical, Loader2, PlayCircle } from 'lucide-react';
import { RUN_QA, SET_QA_AUTO_RUN } from '../graphql/mutations';
import { GET_QA_LOCAL } from '../graphql/queries';
import { Button, Checkbox } from '../components/ui';
import { cn } from '../lib/cn';
import { PREDICTION_LABEL, qaBusy, qaLine, qaPhase, uatPrediction, type QaLocal } from './qa';

const label = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const BUSY_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;

const PREDICTION_TONE = { PASS: 'text-status-merged', ESCALATED: 'text-status-warn', 'NOT PASSED': 'text-status-conflict' } as const;

/**
 * Local QA of the session's ticket: where the run is, a short note after it, and what UAT will likely say. It only
 * informs; it never holds a push or a deploy. Hidden where qonflo-qa-local is not installed.
 */
export const QaPanel: React.FC<{ ticketKey: string }> = ({ ticketKey }) => {
  const [pollInterval, setPollInterval] = useState(IDLE_POLL_MS);
  const { data } = useQuery<{ qaLocal: QaLocal }>(GET_QA_LOCAL, { variables: { ticketKey }, pollInterval, fetchPolicy: 'cache-and-network' });
  const [runQa, { loading: starting }] = useMutation(RUN_QA, { refetchQueries: ['GetQaLocal'] });
  const [setAutoRun, { loading: saving }] = useMutation(SET_QA_AUTO_RUN, { refetchQueries: ['GetQaLocal'] });
  const [error, setError] = useState<string | null>(null);
  const qa = data?.qaLocal;
  const phase = qa?.available ? qaPhase(qa) : null;
  const busy = qaBusy(phase);
  useEffect(() => { setPollInterval(busy ? BUSY_POLL_MS : IDLE_POLL_MS); }, [busy]);
  if (!qa?.available || !phase) return null;
  const run = qa.run;
  const prediction = run && phase === 'done' ? uatPrediction(run.verdict) : null;
  const start = async () => {
    setError(null);
    try {
      await runQa({ variables: { ticketKey } });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'QA did not start');
    }
  };
  const toggle = async (on: boolean) => {
    setError(null);
    try {
      await setAutoRun({ variables: { on } });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The setting was not saved');
    }
  };
  return (
    <section className="flex flex-col gap-2" aria-label="QA">
      <h3 className={cn(label, 'flex items-center gap-1.5')}><FlaskConical size={12} aria-hidden="true" />QA local</h3>
      <p className={cn('flex items-center gap-1.5 font-mono text-[0.72rem]', phase === 'failed' || phase === 'not-started' ? 'text-status-conflict' : 'text-secondary-foreground')}>
        {busy && <Loader2 size={12} aria-hidden="true" className="flex-none animate-spin" />}
        <span className="min-w-0">{qaLine(qa, phase)}</span>
      </p>
      {run && phase !== 'preparing' && (
        <ol className="grid grid-cols-4 gap-0.5" aria-label="QA steps">
          {run.steps.map((step) => (
            <li key={step.id} title={`${step.label}: ${step.state}`} className={cn('h-1.5 rounded-pill', step.state === 'running' ? 'bg-accent' : step.state === 'failed' ? 'bg-status-conflict' : step.state === 'done' ? 'bg-secondary-foreground/50' : 'bg-surface-2')}>
              <span className="sr-only">{step.label} {step.state}</span>
            </li>
          ))}
        </ol>
      )}
      {prediction && (
        <p className="font-mono text-[0.72rem] text-secondary-foreground" title={run?.rule ? `Rule ${run.rule}` : undefined}>
          {PREDICTION_LABEL}: <span className={cn('font-bold', PREDICTION_TONE[prediction])}>{prediction}</span>
        </p>
      )}
      {error && <p className="text-xs text-status-conflict">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-secondary-foreground">
          <Checkbox checked={qa.autoRun} disabled={saving} onChange={(event) => void toggle(event.target.checked)} />
          Run after PR
        </label>
        <Button size="sm" variant="ghost" disabled={busy || starting} onClick={() => void start()} className="max-[900px]:h-11">
          <PlayCircle size={13} aria-hidden="true" />{run ? 'Run again' : 'Run QA'}
        </Button>
      </div>
    </section>
  );
};
