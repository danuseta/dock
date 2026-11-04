import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { CheckCircle2, Circle, FlaskConical, Loader2, MinusCircle, PlayCircle, XCircle } from 'lucide-react';
import { RUN_QA, SET_QA_AUTO_RUN } from '../graphql/mutations';
import { GET_QA_LOCAL } from '../graphql/queries';
import { Badge, Button, Checkbox } from '../components/ui';
import { cn } from '../lib/cn';
import { qaBusy, qaLine, qaPhase, qaVideoUrl, shortTc, verdictVariant, type QaLocal } from './qa';

const label = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const BUSY_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;

const TcIcon: React.FC<{ state: string }> = ({ state }) => {
  const common = { size: 12, 'aria-hidden': true, className: 'flex-none' } as const;
  if (state === 'passed') return <CheckCircle2 {...common} className="flex-none text-status-merged" />;
  if (state === 'failed') return <XCircle {...common} className="flex-none text-status-conflict" />;
  if (state === 'running') return <Loader2 {...common} className="flex-none animate-spin text-accent" />;
  if (state === 'blocked' || state === 'skipped') return <MinusCircle {...common} className="flex-none text-status-warn" />;
  return <Circle {...common} className="flex-none text-muted-foreground" />;
};

/** Local QA of the session's ticket: where the run is, each test case with its video, and the predicted verdict. Hidden where qonflo-qa-local is not installed. */
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
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn(label, 'flex items-center gap-1.5')}><FlaskConical size={12} aria-hidden="true" />QA local</h3>
        {run?.verdict && phase !== 'preparing' && <Badge variant={verdictVariant(run.verdict)} title={run.rule ? `Rule ${run.rule}` : undefined}>{run.verdict}</Badge>}
      </div>
      <p className={cn('flex items-center gap-1.5 font-mono text-[0.72rem]', phase === 'failed' || phase === 'not-started' ? 'text-status-conflict' : 'text-secondary-foreground')}>
        {busy && <Loader2 size={12} aria-hidden="true" className="flex-none animate-spin" />}
        <span className="min-w-0">{qaLine(qa, phase)}</span>
      </p>
      {run && phase !== 'preparing' && (
        <>
          <ol className="grid grid-cols-4 gap-0.5" aria-label="QA steps">
            {run.steps.map((step) => (
              <li key={step.id} title={`${step.label}: ${step.state}`} className={cn('h-1.5 rounded-pill', step.state === 'running' ? 'bg-accent' : step.state === 'failed' ? 'bg-status-conflict' : step.state === 'done' ? 'bg-secondary-foreground/50' : 'bg-surface-2')}>
                <span className="sr-only">{step.label} {step.state}</span>
              </li>
            ))}
          </ol>
          <ul className="flex flex-col gap-0.5 font-mono text-[0.7rem] text-secondary-foreground" aria-label="Test cases">
            {run.testCases.map((tc) => (
              <li key={tc.id} className="flex min-w-0 items-center gap-2" title={[tc.title, tc.note].filter(Boolean).join(' — ')}>
                <TcIcon state={tc.state} />
                <span className="flex-none">{shortTc(tc.id)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{tc.title}</span>
                {tc.seconds != null && tc.seconds > 0 && <span className="flex-none tabular-nums text-muted-foreground">{Math.round(tc.seconds)}s</span>}
                {tc.video && (
                  <a href={qaVideoUrl(ticketKey, run.runId, tc.video)} target="_blank" rel="noreferrer" className="flex-none text-accent hover:text-foreground" aria-label={`Video of ${shortTc(tc.id)}`}>
                    <PlayCircle size={13} aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
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
