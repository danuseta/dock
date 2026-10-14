import { useQuery } from '@apollo/client';
import { Clock } from 'lucide-react';
import { GET_ORCHESTRATOR_CRON_STATUS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { deferredLines, fillSummary, type CronStatus } from './cronRound';

/** The lead row of the Agents page: what the cron holds now and what it did last. Hidden while the cron is off and has never run. */
export const CronRow = ({ pollMs, onOpenSettings }: { pollMs: number; onOpenSettings: () => void }) => {
  const { data } = useQuery<{ orchestratorCronStatus: string }>(GET_ORCHESTRATOR_CRON_STATUS, { fetchPolicy: 'network-only', pollInterval: pollMs });
  if (!data) return null;
  const status = JSON.parse(data.orchestratorCronStatus) as CronStatus;
  if (!status.enabled && !status.lastFill) return null;
  const full = status.slots.busy >= status.parallel;
  const facts = [
    { label: 'Slots', value: `${status.slots.busy}/${status.parallel}`, className: full ? 'text-amber-200' : 'text-foreground' },
    { label: 'Waiting for a slot', value: String(status.slots.waiting), className: status.slots.waiting ? 'text-amber-200' : 'text-foreground' },
    { label: 'Started today', value: `${status.startedToday}/${status.maxPerDay}`, className: status.startedToday >= status.maxPerDay ? 'text-amber-200' : 'text-foreground' },
  ];
  const deferred = deferredLines(status.lastFill);

  return (
    <section className="mb-4 rounded-md border border-border bg-surface-1 px-4 py-3" aria-label="Orchestrator cron">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button type="button" onClick={onOpenSettings} className="flex min-h-9 items-center gap-2 font-display text-sm font-bold hover:text-accent max-[760px]:min-h-11">
          <Clock size={15} aria-hidden="true" />Cron
          <span className={cn('rounded-xs border px-1.5 py-0.5 font-mono text-[0.62rem] font-bold uppercase', status.enabled ? 'border-status-merged/40 text-status-merged' : 'border-border text-muted-foreground')}>{status.enabled ? 'on' : 'off'}</span>
        </button>
        {facts.map((fact) => (
          <span key={fact.label} className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
            <strong className={cn('font-display text-base font-extrabold tabular-nums', fact.className)}>{fact.value}</strong>{fact.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-pretty text-xs text-secondary-foreground" role="status">Last fill: {fillSummary(status.lastFill)}</p>
      {deferred.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-pretty text-xs text-muted-foreground" aria-label="Deferred tickets">
          {deferred.map((line) => <li key={line}>Deferred, {line}</li>)}
        </ul>
      )}
    </section>
  );
};
