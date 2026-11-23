// The sprint's plan status in the Draft toolbar: the stepper Draft > Published > Running; under it where the draft and the
// sprint stand and, only when needed, what waits. The one action this DOCK may take, Publish or Republish, sits in the bottom bar.
import React from 'react';
import { ChevronRight, Lock, Send } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { holdSteps, planAttention, planMetaLine, type PlanSignal, type SprintDraft } from './planning';

const link = 'font-medium text-accent hover:underline';

/** Draft > Published > Running, the current stage bold; with the hold rule on, Waiting for start comes before Running. */
export const PlanningStatus: React.FC<{ signal: PlanSignal | null; hold?: { holdOn: boolean; held: boolean } | null }> = ({ signal, hold = null }) => {
  const { steps, current } = holdSteps(signal, hold);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Plan stage">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-1.5" aria-current={index === current ? 'step' : undefined}>
          {index > 0 && <ChevronRight size={13} className="text-muted-foreground" aria-hidden="true" />}
          <span className={cn('inline-flex items-center gap-1.5 text-sm', index === current ? 'font-semibold text-foreground' : index < current ? 'text-secondary-foreground' : 'text-muted-foreground')}>
            <i className={cn('size-2 rounded-full', index <= current ? (index === current && current === 0 ? 'bg-accent' : 'bg-status-merged') : 'border border-muted-foreground')} aria-hidden="true" />
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
};

/** The muted line under the toolbar: where the draft and the sprint stand, then what waits, each with its link. */
export const PlanningStatusNote: React.FC<{ signal: PlanSignal | null; draft: SprintDraft | null; onOpenChat: () => void; onRepublish: () => void }> = ({ signal, draft, onOpenChat, onRepublish }) => {
  const planner = signal ? signal.isPlanner : true;
  const items = planAttention(signal, draft);
  const actions: Record<string, () => void> = { chat: onOpenChat, republish: onRepublish };
  const linkText: Record<string, string> = { chat: 'open', republish: 'republish' };
  return (
    <p aria-label="Sprint plan status" className="text-pretty text-[0.8rem] text-muted-foreground">
      {planMetaLine(signal, draft)}
      {items.map((item) => (
        <React.Fragment key={item.text}>
          {' · '}
          {item.text}
          {item.action && (item.action !== 'republish' || planner) && <>{' '}<button type="button" className={link} onClick={actions[item.action]}>{linkText[item.action]}</button></>}
        </React.Fragment>
      ))}
    </p>
  );
};

/** Publish before the first revision, Republish after; a developer's DOCK reads the planner's draft and gets a lock instead. */
export const PublishButton: React.FC<{ signal: PlanSignal | null; draft: SprintDraft | null; busy: boolean; onPublish: () => void; onRepublish: () => void }> = ({ signal, draft, busy, onPublish, onRepublish }) => {
  const planner = signal ? signal.isPlanner : true;
  const pending = !!signal?.revision && (signal.joined.length + signal.acChanged.length) > 0;
  const label = !signal?.revision ? 'Publish' : pending ? `Republish r${signal.revision + 1}` : 'Republish';
  if (!planner) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={`Only ${signal?.planner ?? 'planner'} can change and publish the draft`}><Lock size={12} aria-hidden="true" />Read-only</span>;
  return (
    <Button variant={signal?.revision && !pending ? 'default' : 'primary'} onClick={signal?.revision ? onRepublish : onPublish} disabled={busy || !draft || (!signal?.revision && !draft.canPublish)}>
      <Send size={14} aria-hidden="true" />{label}
    </Button>
  );
};

/** The developer's own work order, built from the published plan; before publish it says what it waits for. */
export const DeveloperOrder: React.FC<{ signal: PlanSignal }> = ({ signal }) => {
  if (!signal.revision) {
    return (
      <section aria-label="Your work order" className="rounded-md border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
        The per-developer plan is made after publish. {signal.sprint} is still a draft with {signal.planner ?? 'planner'}.
      </section>
    );
  }
  return (
    <section aria-label="Your work order" className="min-w-0 rounded-md border border-border bg-surface-0 px-4 py-3">
      <h3 className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Work order {signal.me ?? ''} · plan r{signal.revision}</h3>
      {signal.myOrder.length === 0 && signal.myOutside.length === 0 && <p className="mt-2 text-sm text-muted-foreground">You have no To Do tickets in this plan.</p>}
      <ol className="mt-1">
        {signal.myOrder.map((item, index) => (
          <li key={item.key} className="flex flex-wrap items-baseline gap-x-3 border-b border-border py-2 last:border-b-0">
            <span className="w-6 font-mono text-[0.72rem] tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="font-mono text-[0.84rem] font-semibold">{item.key}</span>
            <span className="min-w-0 flex-1 text-[0.84rem] text-secondary-foreground">{item.summary}</span>
            <span className="font-mono text-[0.64rem] text-muted-foreground">{item.sp ?? '-'} SP</span>
          </li>
        ))}
        {signal.myOutside.map((key) => (
          <li key={key} className="flex items-center gap-3 py-2 text-[0.8rem] text-muted-foreground">
            <span className="w-6" />
            <span className="font-mono font-semibold">{key}</span>
            <span>outside the plan · cron skips it until republish</span>
          </li>
        ))}
      </ol>
    </section>
  );
};
