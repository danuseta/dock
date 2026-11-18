import React from 'react';
import { SplitSquareHorizontal } from 'lucide-react';
import { Button } from '../components/ui';
import type { DraftSplit } from './planning';

/** Planning: the weeks the Confluence split page gives, the tickets that sit elsewhere, and the planner's call on each. */
export const SplitBox: React.FC<{ split: DraftSplit; busy: boolean; onUse: (key: string) => void; onKeep: (key: string) => void }> = ({ split, busy, onUse, onKeep }) => {
  if (split.error) {
    return <p className="rounded-md border border-border bg-surface-0 px-4 py-3 text-[0.8rem] text-secondary-foreground" role="status">{split.error}. Planning works as before; nothing is blocked.</p>;
  }
  const count = split.diffs.length;
  return (
    <section aria-label="Split points from Confluence" className="rounded-md border border-border bg-surface-0 px-4 py-3">
      <h3 className="mb-1 flex flex-wrap items-center gap-2 font-display text-sm font-bold">
        <SplitSquareHorizontal size={15} aria-hidden="true" />Split points from Confluence
        <span className="font-mono text-[0.7rem] font-normal text-muted-foreground">"{split.page}" v{split.version} · {split.rows} rows</span>
      </h3>
      <p className="mb-2 text-[0.78rem] text-secondary-foreground">
        {count ? `${count} ${count === 1 ? 'ticket sits' : 'tickets sit'} in a different week than the split page says.` : 'Every ticket the split page lists sits in its week.'}
      </p>
      {split.diffs.map((diff) => (
        <div key={diff.key} className="flex flex-wrap items-center gap-3 border-t border-border py-2 text-[0.8rem]">
          <b className="w-24 font-mono text-accent">{diff.key}</b>
          <span>draft <b>Week {diff.draftWeek}</b> · split page <b>Week {diff.splitWeek}</b>{diff.note && <span className="text-muted-foreground"> · {diff.note}</span>}</span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="primary" onClick={() => onUse(diff.key)} disabled={busy}>Use split page</Button>
            <Button size="sm" onClick={() => onKeep(diff.key)} disabled={busy}>Keep</Button>
          </span>
        </div>
      ))}
    </section>
  );
};
