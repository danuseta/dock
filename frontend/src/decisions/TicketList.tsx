import React, { useState } from 'react';
import type { AgentRun } from '../agents/runs';
import { cn } from '../lib/cn';
import { isAnswered, type Draft, type Question } from './questions';
import { read } from './useDraft';

export interface TicketQuestions { run: AgentRun; questions: Question[] }

type Filter = 'all' | 'waits' | 'ready';

interface TicketListProps {
  tickets: TicketQuestions[];
  openKey: string;
  /** The open ticket's drafts, live; the other tickets read theirs from storage. */
  drafts: Record<string, Draft>;
  /** The open question, 1-based; 0 is the answer sheet. */
  q: number;
  onOpen: (ticket: string, q: number) => void;
}

const FILTERS: Array<{ id: Filter; label: string }> = [{ id: 'all', label: 'All' }, { id: 'waits', label: 'Sous waits' }, { id: 'ready', label: 'Ready to submit' }];

/** One status square in the open ticket's calendar of questions. */
const Day: React.FC<{ question: Question; index: number; draft?: Draft; current: boolean; onClick: () => void }> = ({ question, index, draft, current, onClick }) => {
  const answered = isAnswered(draft);
  const state = draft?.sent ? 'sent' : draft?.unsure ? 'unsure' : answered ? 'answered' : 'open';
  return (
    <button
      type="button"
      aria-label={`Question ${index + 1}, ${state}${question.blocking ? ', sous waits on it' : ''}`}
      aria-current={current ? 'step' : undefined}
      className={cn(
        'relative grid aspect-square place-items-center rounded-[5px] border font-mono text-[0.7rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        state === 'open' && 'border-border bg-background text-muted-foreground',
        state === 'answered' && 'border-transparent bg-surface-2 text-foreground',
        state === 'unsure' && 'border-dashed border-secondary-foreground text-foreground',
        state === 'sent' && 'border-transparent text-muted-foreground line-through opacity-60',
        current && 'text-foreground ring-2 ring-foreground',
      )}
      onClick={onClick}
    >
      {index + 1}
      {question.blocking && !draft?.sent && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-300" aria-hidden="true" />}
    </button>
  );
};

/** The tickets with questions: one line each, the open one with its questions laid out like a calendar. */
export const TicketList: React.FC<TicketListProps> = ({ tickets, openKey, drafts, q, onOpen }) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const rows = tickets.map((ticket) => {
    const saved = ticket.run.key === openKey ? drafts : read(ticket.run.key);
    const answered = ticket.questions.filter((question) => isAnswered(saved[question.id])).length;
    return { ...ticket, saved, answered, waits: ticket.questions.some((question) => question.blocking && !saved[question.id]?.sent) };
  });
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (needle && !`${row.run.key} ${row.run.title}`.toLowerCase().includes(needle)) return false;
    if (filter === 'waits') return row.waits;
    if (filter === 'ready') return row.answered === row.questions.length;
    return true;
  });

  return (
    <nav className="sticky top-4 flex max-h-[calc(100dvh-2rem)] flex-col self-start border-r border-border p-2.5 max-[900px]:static max-[900px]:order-2 max-[900px]:max-h-none max-[900px]:border-r-0 max-[900px]:border-t" aria-label="Tickets with questions">
      <div className="flex items-center gap-2 px-1 pb-2">
        <input className="h-8 min-w-0 flex-1 rounded-[6px] border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[760px]:h-11" placeholder="Find a ticket…" aria-label="Find a ticket" value={query} onChange={(event) => setQuery(event.target.value)} />
        <span className="font-mono text-[0.68rem] whitespace-nowrap text-muted-foreground">{shown.length} tickets</span>
      </div>
      <div className="flex flex-wrap gap-1 px-1 pb-2">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" aria-pressed={filter === item.id} className={cn('h-6 rounded-full border px-2 text-[0.7rem] max-[760px]:h-9', filter === item.id ? 'border-border-glow bg-surface-2 text-foreground' : 'border-border text-muted-foreground')} onClick={() => setFilter(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No ticket matches.</p>}
        {shown.map((row) => {
          const open = row.run.key === openKey;
          const line = (
            <span className="grid w-full grid-cols-[72px_minmax(0,1fr)_auto_8px] items-center gap-2 text-left text-xs">
              <span className="font-mono font-semibold text-foreground">{row.run.key}</span>
              <span className="truncate text-muted-foreground">{row.run.title || 'Untitled'}</span>
              <span className={cn('font-mono text-[0.68rem]', row.answered === row.questions.length ? 'text-status-merged' : 'text-muted-foreground')}>{row.answered}/{row.questions.length}</span>
              <span className={cn('size-1.5 rounded-full', row.waits && 'bg-amber-300')} aria-label={row.waits ? 'Sous waits on an answer' : undefined} />
            </span>
          );
          return open ? (
            <div key={row.run.key} className="my-0.5 rounded-[8px] bg-surface-1 p-2">
              <div className="mb-2">{line}</div>
              <div className="grid grid-cols-7 gap-1">
                {row.questions.map((question, index) => <Day key={question.id} question={question} index={index} draft={row.saved[question.id]} current={q === index + 1} onClick={() => onOpen(row.run.key, index + 1)} />)}
              </div>
              <button type="button" className={cn('mt-2 rounded-[6px] px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground max-[760px]:min-h-11', q === 0 && 'text-foreground underline underline-offset-2')} onClick={() => onOpen(row.run.key, 0)}>Answer sheet ›</button>
            </div>
          ) : (
            <button key={row.run.key} type="button" className="flex h-8 w-full items-center rounded-[6px] px-2 hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[760px]:h-11" onClick={() => onOpen(row.run.key, 1)}>{line}</button>
          );
        })}
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-1 pt-2 text-[0.68rem] text-muted-foreground">
        <span><s>1</s> sent</span><span><span className="mr-1 inline-block size-2.5 rounded-[3px] bg-surface-2 align-[-1px]" />answered</span><span><span className="mr-1 inline-block size-2.5 rounded-[3px] border border-dashed border-secondary-foreground align-[-1px]" />unsure</span><span><span className="mr-1 inline-block size-1.5 rounded-full bg-amber-300 align-[1px]" />sous waits</span>
      </p>
    </nav>
  );
};
