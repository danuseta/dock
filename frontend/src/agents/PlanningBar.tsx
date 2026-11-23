import React from 'react';
import { AlertCircle, Check, CheckCircle2, Clapperboard, FilePlus2, Link2, PenLine } from 'lucide-react';
import { cn } from '../lib/cn';
import { PublishButton } from './PlanningStatus';
import type { PlanSignal, PlanningPanel, Readiness, SprintDraft } from './planning';
import { barIssues } from './boardLogic';

const issue = 'inline-flex h-7 items-center gap-1.5 rounded-pill border px-2.5 text-[0.74rem] max-[760px]:h-11';
const TONE = { warn: 'border-status-warn/60 text-[var(--color-status-warn-ink)]', ok: 'border-status-merged/50 text-status-merged', sky: 'border-sky-400/60 text-sky-300' };

/** Draft's sticky bottom bar: the capacity meter, a chip per open issue that opens its panel, and Publish. */
export const PlanningBar: React.FC<{
  draft: SprintDraft; ready: Readiness; signal: PlanSignal | null; busy: boolean;
  onShow: (panel: PlanningPanel) => void; onPublish: () => void; onRepublish: () => void;
  /** Opens the Team map Board filtered to the tickets below the writing standard. */
  onWriting?: () => void;
}> = ({ draft, ready, signal, busy, onShow, onPublish, onRepublish, onWriting }) => {
  const over = ready.sp > ready.capacity;
  const fine = !over || !!ready.cut;
  const counts = barIssues(draft);
  const shown = new Set(ready.items.map((item) => item.id));
  const detail = (id: string) => ready.items.find((item) => item.id === id)?.detail ?? undefined;
  return (
    <footer aria-label="Ready to publish" className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-background px-1 py-2.5 max-[760px]:bottom-[calc(max(10px,env(safe-area-inset-bottom))+64px)]">
      {shown.has('scope') && (
        <button type="button" onClick={() => onShow('scope')} title={detail('scope')} className="flex min-w-0 items-center gap-2 text-[0.78rem] max-[600px]:w-full">
          {fine ? <CheckCircle2 size={15} className="flex-none text-status-merged" aria-hidden="true" /> : <AlertCircle size={15} className="flex-none text-status-warn" aria-hidden="true" />}
          <span className="block h-2 w-36 flex-none overflow-hidden rounded-sm bg-surface-2 max-[600px]:w-24" aria-hidden="true">
            <span className={cn('block h-full', over ? 'bg-status-conflict' : 'bg-status-merged')} style={{ width: `${ready.capacity ? Math.min(100, (ready.sp / ready.capacity) * 100) : 100}%` }} />
          </span>
          <span className="min-w-0 truncate"><b className="font-mono">{ready.sp}</b> / {ready.capacity} SP{over ? (ready.cut ? ' · scope cut written' : ' · no scope cut') : ''}</span>
        </button>
      )}
      {shown.has('ac') && (
        <button type="button" className={cn(issue, counts.ac ? TONE.warn : TONE.ok)} onClick={() => onShow('ac')} title={detail('ac')}>
          {counts.ac ? <Link2 size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{counts.ac ? `${counts.ac} AC ${counts.ac === 1 ? 'reference' : 'references'}` : 'AC decided'}
        </button>
      )}
      {shown.has('storyboard') && (
        <button type="button" className={cn(issue, counts.epics || counts.checks || !ready.items.find((item) => item.id === 'storyboard')?.ok ? TONE.warn : TONE.ok)} onClick={() => onShow('storyboard')} title={detail('storyboard')}>
          {counts.epics || counts.checks ? <Clapperboard size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
          {counts.epics ? `${counts.epics} ${counts.epics === 1 ? 'storyboard' : 'storyboards'}` : counts.checks ? `${counts.checks} AC to check` : ready.items.find((item) => item.id === 'storyboard')?.ok ? 'Storyboards recorded' : 'No storyboard read yet'}
        </button>
      )}
      {counts.fresh + counts.revisions > 0 && (
        <button type="button" className={cn(issue, counts.needWork ? TONE.warn : TONE.sky)} onClick={() => onShow('new')} title={detail('new')}>
          <FilePlus2 size={13} aria-hidden="true" />{counts.fresh + counts.revisions} to review{counts.needWork ? ` · ${counts.needWork} ${counts.needWork === 1 ? 'needs' : 'need'} a field or developer` : ''}
        </button>
      )}
      {counts.writing > 0 && onWriting && (
        <button type="button" className={cn(issue, 'border-status-conflict/60 text-status-conflict')} onClick={onWriting} title="Show the tickets below the writing standard on the Board">
          <PenLine size={13} aria-hidden="true" />{counts.writing} {counts.writing === 1 ? 'ticket' : 'tickets'} below the writing standard
        </button>
      )}
      <span className="flex-1" />
      <span className="text-xs text-muted-foreground max-[1700px]:hidden" title="The bar only informs: Publish stays on">info only, Publish stays on</span>
      <PublishButton signal={signal} draft={draft} busy={busy} onPublish={onPublish} onRepublish={onRepublish} />
    </footer>
  );
};
