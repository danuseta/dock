import React from 'react';
import { AlertTriangle, Check, MessagesSquare, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '../components/ui';
import { apiOrigin } from '../lib/apollo';
import { planningChatTitle, visualTime, type DraftVisual } from './planning';

/** One visual the planning agent made, in a sandboxed frame: a snapshot of the draft, with Save and Discard. */
export const PlanningVisual: React.FC<{ visual: DraftVisual; sprint: string; busy: boolean; onSave: () => void; onDiscard: () => void; onRedo: () => void }> = ({ visual, sprint, busy, onSave, onDiscard, onRedo }) => (
  <section aria-label={visual.title} className="grid grid-cols-[minmax(0,1fr)] gap-3">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 flex-1 text-pretty font-mono text-[0.72rem] text-muted-foreground">
        Snapshot {visualTime(visual.createdAt)} · from chat {planningChatTitle(sprint)}
        {visual.saved && <span className="ml-2 rounded-xs border border-status-merged px-1.5 text-[0.6rem] font-bold uppercase tracking-[0.08em] text-status-merged">Saved</span>}
      </p>
      <Button size="sm" onClick={onSave} disabled={busy || visual.saved}><Check size={13} aria-hidden="true" />{visual.saved ? 'Saved' : 'Save'}</Button>
      <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}><Trash2 size={13} aria-hidden="true" />Discard</Button>
    </div>
    {visual.stale && (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-status-warn px-3 py-2" role="status">
        <AlertTriangle size={14} className="flex-none text-status-warn" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-pretty text-[0.8rem] text-[var(--color-status-warn-ink)]">The draft changed after this was made. The numbers may be out of date.</p>
        <Button size="sm" onClick={onRedo}><MessagesSquare size={13} aria-hidden="true" />Ask the agent to redo it</Button>
      </div>
    )}
    <p className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
      <ShieldCheck size={12} className="flex-none" aria-hidden="true" />Made by the planning agent. DOCK never asks for your PIN here.
    </p>
    <iframe
      key={`${visual.id}-${visual.createdAt}`}
      src={`${apiOrigin}${visual.url}`}
      title={visual.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="h-[70vh] min-h-[420px] w-full rounded-md border border-border bg-surface-1 max-[760px]:min-h-[360px]"
    />
  </section>
);
