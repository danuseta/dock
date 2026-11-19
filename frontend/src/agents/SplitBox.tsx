import React, { useState } from 'react';
import { ChevronDown, ChevronUp, SplitSquareHorizontal } from 'lucide-react';
import { Button } from '../components/ui';
import type { DraftSplit } from './planning';

const keysText = (keys: string[]) => (keys.length <= 2 ? keys.join(' and ') : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`);

/** Team map's one-line version of the split box, only while a ticket sits in another week; Details opens the call per ticket. */
export const SplitRow: React.FC<{ split: DraftSplit; busy: boolean; onUse: (keys: string[]) => void; onKeep: (keys: string[]) => void }> = ({ split, busy, onUse, onKeep }) => {
  const [open, setOpen] = useState(false);
  if (split.error || !split.diffs.length) return null;
  const keys = split.diffs.map((diff) => diff.key);
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-0 px-3 py-2 text-[0.78rem] text-secondary-foreground">
        <SplitSquareHorizontal size={14} className="flex-none text-sky-300" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-pretty">Split page "{split.page}" v{split.version}: <b className="font-mono text-foreground">{keysText(keys)}</b> {keys.length === 1 ? 'sits' : 'sit'} in a different week than the draft.</span>
        <Button size="sm" onClick={() => onUse(keys)} disabled={busy}>Use split page</Button>
        <Button size="sm" variant="ghost" onClick={() => onKeep(keys)} disabled={busy}>Keep</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}Details</Button>
      </div>
      {open && <SplitBox split={split} busy={busy} onUse={(key) => onUse([key])} onKeep={(key) => onKeep([key])} />}
    </div>
  );
};

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
