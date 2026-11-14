// The sprint's plan status at the top of Planning, at most three lines: the sprint and its stepper Draft > Dipublish >
// Jalan with the one action this DOCK may take; where the draft and the sprint stand; and only when needed, what waits.
import React from 'react';
import { ChevronRight, Lock, Send } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { PLAN_STEPS, planAttention, planMetaLine, stepIndex, type PlanSignal, type Readiness, type SprintDraft } from './planning';

interface PlanningStatusProps {
  sprint: string;
  signal: PlanSignal | null;
  draft: SprintDraft | null;
  ready: Readiness | null;
  busy: boolean;
  onPublish: () => void;
  onRepublish: () => void;
  onOpenChat: () => void;
  onShowReady: () => void;
}

const link = 'font-medium text-accent hover:underline';

export const PlanningStatus: React.FC<PlanningStatusProps> = ({ sprint, signal, draft, ready, busy, onPublish, onRepublish, onOpenChat, onShowReady }) => {
  const current = stepIndex(signal);
  const planner = signal ? signal.isPlanner : true;
  const items = planAttention(signal, draft);
  const pending = !!signal?.revision && (signal.joined.length + signal.acChanged.length) > 0;
  const label = !signal?.revision ? 'Publish' : pending ? `Publish ulang r${signal.revision + 1}` : 'Publish ulang';
  const onAction = signal?.revision ? onRepublish : onPublish;
  const actions: Record<string, () => void> = { chat: onOpenChat, republish: onRepublish };
  const linkText: Record<string, string> = { chat: 'buka', republish: 'publish ulang' };

  return (
    <section aria-label="Sprint plan status" className="rounded-md border border-border bg-surface-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-display text-base font-bold">{sprint}</span>
        <ol className="flex items-center gap-1.5" aria-label="Plan stage">
          {PLAN_STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-1.5" aria-current={index === current ? 'step' : undefined}>
              {index > 0 && <ChevronRight size={13} className="text-muted-foreground" aria-hidden="true" />}
              <span className={cn('inline-flex items-center gap-1.5 text-sm', index === current ? 'font-semibold text-foreground' : index < current ? 'text-secondary-foreground' : 'text-muted-foreground')}>
                <i className={cn('size-2 rounded-full', index <= current ? (index === current && current === 0 ? 'bg-accent' : 'bg-status-merged') : 'border border-muted-foreground')} aria-hidden="true" />
                {step}
              </span>
            </li>
          ))}
        </ol>
        <span className="ml-auto flex items-center gap-2 max-[760px]:ml-0">
          {ready && ready.total > 0 && (
            <button type="button" onClick={onShowReady} title="Cuma info, Publish tetap aktif" className={cn('rounded-xs border px-1.5 py-0.5 font-mono text-[0.68rem] font-bold', ready.done === ready.total ? 'border-status-merged text-status-merged' : 'border-status-warn text-status-warn')}>
              Siap publish {ready.done} dari {ready.total}
            </button>
          )}
          {planner ? (
            <Button size="sm" variant={signal?.revision && !pending ? 'default' : 'primary'} onClick={onAction} disabled={busy || !draft || (!signal?.revision && !draft.canPublish)}>
              <Send size={13} aria-hidden="true" />{label}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={`Cuma ${signal?.planner ?? 'planner'} yang bisa ubah dan publish draft`}><Lock size={12} aria-hidden="true" />Read-only</span>
          )}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{planMetaLine(signal, draft)}</p>
      {items.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {items.map((item, index) => (
            <React.Fragment key={item.text}>
              {index > 0 && ' · '}
              {item.text}
              {item.action && (item.action !== 'republish' || planner) && <>{' '}<button type="button" className={link} onClick={actions[item.action]}>{linkText[item.action]}</button></>}
            </React.Fragment>
          ))}
        </p>
      )}
    </section>
  );
};

/** The developer's own work order, built from the published plan; before publish it says what it waits for. */
export const DeveloperOrder: React.FC<{ signal: PlanSignal }> = ({ signal }) => {
  if (!signal.revision) {
    return (
      <section aria-label="Your work order" className="rounded-md border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
        Plan per developer dibikin setelah publish. {signal.sprint} masih draft di {signal.planner ?? 'planner'}.
      </section>
    );
  }
  return (
    <section aria-label="Your work order" className="min-w-0 rounded-md border border-border bg-surface-0 px-4 py-3">
      <h3 className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Urutan kerja {signal.me ?? ''} · plan r{signal.revision}</h3>
      {signal.myOrder.length === 0 && signal.myOutside.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Tidak ada tiket To Do kamu di plan ini.</p>}
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
            <span>di luar plan · cron lewati sampai publish ulang</span>
          </li>
        ))}
      </ol>
    </section>
  );
};
