import React, { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { NeedItem, NeedKind } from '../../lib/ticketDetail';
import { Badge, Button, Card, Input, type BadgeVariant } from '../ui';

const KIND: Record<NeedKind, { label: string; variant: BadgeVariant; action: string }> = {
  question: { label: 'Question', variant: 'warn', action: 'Open session' },
  ac: { label: 'AC fail', variant: 'danger', action: 'Show' },
  review: { label: 'Review', variant: 'danger', action: 'Open PR' },
  conflict: { label: 'Conflict', variant: 'danger', action: 'Inspect' },
  demo: { label: 'Demo', variant: 'neutral', action: 'Add link' },
};

interface NeedsYouCardProps {
  items: NeedItem[];
  onAction: (item: NeedItem) => void;
  /** Sends an answer to the agent's question; rejects with the reason when it cannot. */
  onAnswer: (text: string) => Promise<void>;
  answering: boolean;
  /** Set when this DOCK cannot answer, for example a run the other DOCK reports. */
  answerBlocked?: string | null;
}

const Answer: React.FC<Pick<NeedsYouCardProps, 'onAnswer' | 'answering' | 'answerBlocked'> & { choices: string[] }> = ({ choices, onAnswer, answering, answerBlocked }) => {
  const [draft, setDraft] = useState('');
  if (answerBlocked) return <p className="basis-full text-pretty text-xs text-muted-foreground">{answerBlocked}</p>;
  const send = (text: string) => {
    if (!text.trim()) return;
    void onAnswer(text.trim()).then(() => setDraft(''), () => undefined);
  };
  return (
    <div className="flex basis-full flex-wrap items-center gap-2">
      {choices.map((choice, index) => <Button key={choice} size="sm" variant={index === 0 ? 'primary' : 'default'} className="max-[760px]:h-11" disabled={answering} onClick={() => send(choice)}>{choice}</Button>)}
      <form className="flex min-w-[220px] flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
        <Input className="h-8 min-w-0 flex-1 text-sm max-[760px]:h-11" value={draft} placeholder={choices.length ? 'Or write your own answer...' : 'Answer the agent...'} aria-label="Answer to the agent" disabled={answering} onChange={(event) => setDraft(event.target.value)} />
        <Button size="sm" type="submit" className="max-[760px]:h-11" disabled={answering || !draft.trim()} aria-label="Send the answer"><SendHorizontal size={14} aria-hidden="true" />{answering ? 'Sending...' : 'Send'}</Button>
      </form>
    </div>
  );
};

/** What waits on the owner for this ticket. Renders nothing when nothing does. */
export const NeedsYouCard: React.FC<NeedsYouCardProps> = ({ items, onAction, onAnswer, answering, answerBlocked }) => {
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
              <Button size="sm" variant={item.kind === 'question' ? 'ghost' : 'default'} className="max-[760px]:h-11" onClick={() => onAction(item)}>{kind.action}</Button>
              {item.kind === 'question' && <Answer choices={item.choices ?? []} onAnswer={onAnswer} answering={answering} answerBlocked={answerBlocked} />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
