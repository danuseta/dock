import React, { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { NeedItem, NeedKind } from '../../lib/ticketDetail';
import { Button, Input } from '../ui';

const KIND: Record<NeedKind, { label: string; action: string }> = {
  question: { label: 'Question', action: 'Open session' },
  ac: { label: 'AC fail', action: 'Show' },
  review: { label: 'Review', action: 'Open PR' },
  conflict: { label: 'Conflict', action: 'Inspect' },
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
    <div className="flex basis-full flex-wrap items-center gap-2 pt-1">
      {choices.map((choice, index) => <Button key={choice} size="sm" variant={index === 0 ? 'primary' : 'default'} className="max-[760px]:h-11" disabled={answering} onClick={() => send(choice)}>{choice}</Button>)}
      <form className="flex min-w-[220px] flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
        <Input className="h-8 min-w-0 flex-1 text-sm max-[760px]:h-11" value={draft} placeholder={choices.length ? 'Or write your own answer...' : 'Answer the agent...'} aria-label="Answer to the agent" disabled={answering} onChange={(event) => setDraft(event.target.value)} />
        <Button size="sm" type="submit" className="max-[760px]:h-11" disabled={answering || !draft.trim()} aria-label="Send the answer"><SendHorizontal size={14} aria-hidden="true" />{answering ? 'Sending...' : 'Send'}</Button>
      </form>
    </div>
  );
};

/** What waits on the owner for this ticket, as one strip. Renders nothing when nothing does. */
export const NeedsYouCard: React.FC<NeedsYouCardProps> = ({ items, onAction, onAnswer, answering, answerBlocked }) => {
  if (items.length === 0) return null;
  return (
    <section className="rounded-r-sm border-l-[3px] border-status-warn bg-status-warn-bg px-3.5 py-2.5" aria-label="Needs you">
      <h2 className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.08em] text-status-warn">Needs you</h2>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-1 text-sm">
            <span className="font-mono text-[0.68rem] font-bold uppercase text-muted-foreground">{KIND[item.kind].label}</span>
            <span className="min-w-0 text-pretty text-foreground">{item.text}</span>
            <button type="button" className="text-sm font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[760px]:min-h-11" onClick={() => onAction(item)}>{KIND[item.kind].action}</button>
            {item.kind === 'question' && <Answer choices={item.choices ?? []} onAnswer={onAnswer} answering={answering} answerBlocked={answerBlocked} />}
          </li>
        ))}
      </ul>
    </section>
  );
};
