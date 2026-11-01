import { useQuery } from '@apollo/client';
import { Clock, Settings } from 'lucide-react';
import { GET_ORCHESTRATOR_CRON_STATUS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { deferredLines, fillSummary, type CronStatus } from './cronRound';
import { usePhone } from './usePhone';

/** The lead row of the Agents page: what the cron holds now and what it did last. Hidden while the cron is off and has never run, except on a phone, where it is the only way into the cron settings. */
export const CronRow = ({ pollMs, onOpenSettings, className }: { pollMs: number; onOpenSettings: () => void; className?: string }) => {
  const { data } = useQuery<{ orchestratorCronStatus: string }>(GET_ORCHESTRATOR_CRON_STATUS, { fetchPolicy: 'network-only', pollInterval: pollMs });
  const phone = usePhone();
  if (!data) return null;
  const status = JSON.parse(data.orchestratorCronStatus) as CronStatus;
  if (!status.enabled && !status.lastFill && !phone) return null;
  const full = status.slots.busy >= status.parallel;
  const facts = [
    { label: 'Slots', value: `${status.slots.busy}/${status.parallel}`, className: full ? 'text-amber-200' : 'text-foreground' },
    { label: 'Waiting for a slot', value: String(status.slots.waiting), className: status.slots.waiting ? 'text-amber-200' : 'text-foreground' },
    { label: 'Started today', value: `${status.startedToday}/${status.maxPerDay}`, className: status.startedToday >= status.maxPerDay ? 'text-amber-200' : 'text-foreground' },
  ];
  const deferred = deferredLines(status.lastFill);

  return (
    <section className={cn('mb-4 rounded-md border border-border bg-surface-1 px-4 py-3', className)} aria-label="Orchestrator cron">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button type="button" onClick={onOpenSettings} className="flex min-h-9 items-center gap-2 font-display text-sm font-bold hover:text-accent max-[760px]:min-h-11">
          <Clock size={15} aria-hidden="true" />Cron
          <span className={cn('rounded-xs border px-1.5 py-0.5 font-mono text-[0.62rem] font-bold uppercase', status.enabled ? 'border-status-merged/40 text-status-merged' : 'border-border text-muted-foreground')}>{status.enabled ? 'on' : 'off'}</span>
          <Settings size={15} aria-hidden="true" className="ml-1 hidden text-muted-foreground max-[760px]:block" />
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
