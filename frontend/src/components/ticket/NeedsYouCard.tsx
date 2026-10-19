import React from 'react';
import type { NeedItem, NeedKind } from '../../lib/ticketDetail';
import { Badge, Button, Card, type BadgeVariant } from '../ui';

const KIND: Record<NeedKind, { label: string; variant: BadgeVariant; action: string }> = {
  question: { label: 'Question', variant: 'warn', action: 'Reply in session' },
  ac: { label: 'AC fail', variant: 'danger', action: 'Show' },
  review: { label: 'Review', variant: 'danger', action: 'Open PR' },
  conflict: { label: 'Conflict', variant: 'danger', action: 'Inspect' },
  demo: { label: 'Demo', variant: 'neutral', action: 'Add link' },
};

/** What waits on the owner for this ticket. Renders nothing when nothing does. */
export const NeedsYouCard: React.FC<{ items: NeedItem[]; onAction: (item: NeedItem) => void }> = ({ items, onAction }) => {
  if (items.length === 0) return null;
  return (
    <Card className="border-status-warn/45 bg-[linear-gradient(var(--color-status-warn-bg),transparent_70%)]" role="region" aria-label="Needs you">
      <div className="mb-1 flex items-center justify-between gap-2 border-b border-status-warn/25 pb-2.5">
        <h2 className="font-display text-lg font-bold">Needs you</h2>
        <Badge variant="warn">{items.length}</Badge>
      </div>
      <ul className="flex flex-col">
        {items.map((item) => {
          const kind = KIND[item.kind];
          return (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0 last:pb-0">
              <span className="flex min-w-0 items-center gap-2 text-sm"><Badge variant={kind.variant} className="flex-none uppercase">{kind.label}</Badge><span className="min-w-0 text-pretty">{item.text}</span></span>
              <Button size="sm" variant={item.kind === 'question' ? 'primary' : 'default'} className="max-[760px]:h-11" onClick={() => onAction(item)}>{kind.action}</Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
