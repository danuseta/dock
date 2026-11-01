import React, { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { AgentRun } from '../agents/runs';
import { reportAge } from '../lib/sousReport';
import { cn } from '../lib/cn';
import { Button, Textarea } from '../components/ui';
import { OWN, OWN_EFFECT, type Draft, type Question } from './questions';

interface QuestionViewProps {
  run: AgentRun;
  question: Question;
  number: number;
  total: number;
  draft?: Draft;
  /** How many answers on this ticket went to sous and wait for it. */
  sentCount: number;
  /** Why this DOCK cannot answer; the options stay visible but cannot be picked. */
  readOnly: string | null;
  guessesLeft: number;
  onKeepAll: () => void;
  onChange: (next: Partial<Draft>) => void;
  onPrevious: () => void;
  onNext: () => void;
}

const LETTERS = 'ABCDEFGHIJ';

/** One question as an exam item: what sous asks, its context, the options, and under the picked one what it causes. */
export const QuestionView: React.FC<QuestionViewProps> = ({ run, question, number, total, draft, sentCount, readOnly, guessesLeft, onKeepAll, onChange, onPrevious, onNext }) => {
  const [textOpen, setTextOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const options = [...question.options, { key: OWN, label: question.kind === 'issue' ? 'Write my own answer' : 'Change it to what I write', effect: OWN_EFFECT[question.kind] }];
  const sent = Boolean(draft?.sent);
  const pullRequests = (run.pullRequests ?? []).filter((pr) => pr.status === 'open' || pr.status === 'draft');
  return (
    <article className="grid h-full @min-[860px]:grid-cols-[minmax(0,1fr)_320px]" aria-labelledby="decision-question">
      <div className="flex min-w-0 flex-col p-7 max-[760px]:p-4">
        <p className="text-xs text-muted-foreground">{run.key} · Question {number} of {total}</p>
        <h2 id="decision-question" className={cn('mt-2 text-pretty text-xl leading-snug font-semibold max-[760px]:text-base', !textOpen && 'max-[760px]:line-clamp-4')}>
          {question.blocking && <span className="mr-2 inline-block size-2 rounded-full bg-amber-300 align-middle" title="Sous waits on this answer" aria-label="Sous waits on this answer" />}
          {question.text}
        </h2>
        {question.text.length > 160 && <button type="button" className="hidden min-h-11 self-start border-0 bg-transparent p-0 text-xs font-semibold text-accent max-[760px]:block" aria-expanded={textOpen} onClick={() => setTextOpen((value) => !value)}>{textOpen ? 'Show less' : 'Show more'}</button>}
        <p className="mt-1 text-[0.8rem] text-muted-foreground">{question.kind === 'issue' ? 'Sous asked' : 'Sous guessed and went on'}{question.at ? ` · ${reportAge(question.at)}` : ''}</p>

        <div className="mt-5 flex flex-col gap-0.5" role="radiogroup" aria-label="Answer">
          {options.map((option, index) => {
            const picked = draft?.choice === option.key;
            return (
              <div key={option.key} className={cn('rounded-[8px] px-2.5 py-2.5 transition-colors duration-150', picked ? 'bg-surface-1' : 'hover:bg-surface-1')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  disabled={Boolean(readOnly) || sent}
                  className="flex w-full items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default max-[760px]:min-h-11"
                  onClick={() => onChange({ choice: option.key })}
                >
                  <span className={cn('grid size-6 flex-none place-items-center rounded-full border font-mono text-[0.68rem]', picked ? 'border-foreground bg-foreground text-background' : 'border-border-glow text-muted-foreground')}>{option.key === OWN ? '–' : LETTERS[index]}</span>
                  <span className="pt-0.5 text-[0.9rem] font-medium text-foreground">{option.label}</span>
                </button>
                {picked && (
                  <div className="mt-1.5 pl-9">
                    {option.key === OWN && (
                      <Textarea
                        autoFocus
                        readOnly={sent}
                        rows={3}
                        maxLength={4000}
                        className="mb-1.5 text-sm"
                        value={draft?.text ?? ''}
                        placeholder={question.kind === 'issue' ? 'Your answer for sous…' : 'What it should be…'}
                        aria-label={`Your own answer to question ${number}`}
                        onChange={(event) => onChange({ text: event.target.value })}
                      />
                    )}
                    <p className="border-l-2 border-border-glow pl-2.5 text-pretty text-[0.8rem] text-secondary-foreground">{option.effect}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4 max-[760px]:sticky max-[760px]:bottom-[calc(max(10px,env(safe-area-inset-bottom))+68px)] max-[760px]:z-10 max-[760px]:-mx-4 max-[760px]:bg-surface-0 max-[760px]:px-4 max-[760px]:pb-3">
          <Button variant="ghost" size="sm" onClick={onPrevious} disabled={number === 1}>‹ Previous</Button>
          {!readOnly && !sent && <Button variant="ghost" size="sm" aria-pressed={Boolean(draft?.unsure)} onClick={() => onChange({ unsure: !draft?.unsure })}>{draft?.unsure ? 'Marked unsure' : 'Mark unsure'}</Button>}
          {!readOnly && guessesLeft > 0 && <Button variant="ghost" size="sm" className="max-[760px]:hidden" title="Answers every unanswered sous guess with Keep what sous built and opens the answer sheet; nothing is sent until you submit" onClick={onKeepAll}>Keep all sous built ({guessesLeft})</Button>}
          <span className="flex-1" />
          {!readOnly && guessesLeft > 0 && (
            <span className="relative hidden max-[760px]:block">
              <Button variant="ghost" size="icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={16} aria-hidden="true" /></Button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 bottom-full mb-1 w-max rounded-[8px] border border-border bg-surface-1 p-1 shadow-card">
                  <Button role="menuitem" variant="ghost" size="sm" onClick={() => { setMenuOpen(false); onKeepAll(); }}>Keep all sous built ({guessesLeft})</Button>
                </div>
              )}
            </span>
          )}
          <Button variant="primary" size="sm" onClick={onNext}>{number === total ? 'Answer sheet' : 'Save, next'}</Button>
        </div>
        {sent && <p className="mt-2 text-pretty text-xs text-status-merged">Sent. Sous picks it up in a new session; the question closes once sous records it.</p>}
        {readOnly && <p className="mt-2 text-pretty text-xs text-muted-foreground">{readOnly}</p>}
      </div>
      <aside className="order-first flex flex-col gap-2.5 border-b border-border bg-background p-5 text-[0.8rem] text-secondary-foreground @min-[860px]:order-none @min-[860px]:border-b-0 @min-[860px]:border-l" aria-label="Context">
        <p className="font-mono text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase max-[760px]:text-xs">Context</p>
        <p className="text-pretty"><span className="text-foreground">Ticket.</span> {run.title || 'Untitled'}</p>
        {question.detail && <p className="text-pretty"><span className="text-foreground">What it does.</span> {question.detail}</p>}
        {pullRequests.length > 0 && (
          <p><span className="text-foreground">Pull requests.</span> {pullRequests.map((pr) => <a key={pr.url} href={pr.url} target="_blank" rel="noreferrer" className="mr-2 underline-offset-2 hover:underline">{pr.repo}#{pr.number}</a>)}</p>
        )}
        {run.ac.length > 0 && (
          <details>
            <summary className="cursor-pointer text-foreground">Acceptance criteria ({run.ac.length})</summary>
            <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-5">{run.ac.map((item) => <li key={item.n} className="text-pretty">{item.text}</li>)}</ol>
          </details>
        )}
        {sentCount > 0 && <p className="border-t border-border pt-2.5 text-pretty"><span className="text-foreground">Also on this ticket.</span> {sentCount === 1 ? 'One answer was sent and waits' : `${sentCount} answers were sent and wait`} for sous.</p>}
      </aside>
    </article>
  );
};
