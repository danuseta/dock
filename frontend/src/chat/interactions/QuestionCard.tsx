import React, { useState } from 'react';
import { Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useNow } from '../activity/useNow';
import { MAX_NOTE, countdown, isAnswerable, questionAnswer, questionDismissal, toggleChoice, type ChatInteraction, type QuestionBody, type QuestionSelection, type SettledLine } from './interactions';
import { useAnswer } from './useAnswer';

export const QuestionCard: React.FC<{ sessionId: string; interaction: ChatInteraction; body: QuestionBody; onSettled: (line: SettledLine) => void }> = ({ sessionId, interaction, body, onSettled }) => {
  const now = useNow(true);
  const { busy, error, submit } = useAnswer(sessionId, interaction, onSettled);
  const [selections, setSelections] = useState<QuestionSelection[]>(() => body.questions.map(() => ({ picked: [], other: '' })));
  const open = isAnswerable(interaction, now);
  const left = countdown(interaction.expiresAt, now);
  const change = (index: number, next: QuestionSelection) => setSelections((current) => current.map((item, at) => (at === index ? next : item)));
  const answer = questionAnswer(body.questions, selections);
  return (
    <section className="flex min-h-0 min-w-0 shrink flex-col rounded-sm border border-border-glow bg-surface-1 p-2.5" aria-label={`Question: ${interaction.title}`}>
      <div className="flex min-w-0 flex-none items-baseline justify-between gap-2">
        <p className="min-w-0 break-words font-display text-xs font-bold [overflow-wrap:anywhere]" role="alert">Claude has a question{interaction.title ? `: ${interaction.title}` : ''}</p>
        <span className="flex-none font-mono text-[0.66rem] text-muted-foreground tabular-nums">{left.text}</span>
      </div>
      <div className="mt-2 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain" tabIndex={0} role="region" aria-label="Questions">
        {body.questions.map((question, index) => {
          const selection = selections[index];
          return (
            <fieldset key={index} className="min-w-0 border-0 p-0" disabled={!open || busy}>
              <legend className="mb-1 break-words text-[0.82rem] [overflow-wrap:anywhere]">{question.question}{question.multiSelect ? ' (choose any)' : ''}</legend>
              <div className="flex flex-wrap gap-2">
                {question.options.map((option, optionIndex) => {
                  const chosen = selection.picked.includes(optionIndex);
                  return (
                    <button
                      key={optionIndex}
                      type="button"
                      aria-pressed={chosen}
                      title={option.description || undefined}
                      className={cn(
                        'min-h-11 max-w-full rounded-sm border px-3 py-1.5 text-left text-[0.8rem] break-words [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50',
                        chosen ? 'border-accent bg-accent-dim text-foreground' : 'border-border bg-surface-0 text-secondary-foreground hover:bg-surface-2',
                      )}
                      onClick={() => change(index, { picked: toggleChoice(selection.picked, optionIndex, question.multiSelect), other: '' })}
                    >
                      <span className="block font-semibold">{option.label}</span>
                      {option.description && <span className="block text-[0.7rem] text-muted-foreground">{option.description}</span>}
                    </button>
                  );
                })}
              </div>
              <label className="mt-2 block text-[0.7rem] text-muted-foreground">
                Other (replaces the choices above)
                <input
                  type="text"
                  className="mt-1 block min-h-11 w-full min-w-0 rounded-sm border border-border bg-surface-0 px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
                  maxLength={MAX_NOTE}
                  value={selection.other}
                  placeholder="Type your own answer"
                  onChange={(event) => change(index, { picked: event.target.value ? [] : selection.picked, other: event.target.value })}
                />
              </label>
            </fieldset>
          );
        })}
      </div>
      {error && <p className="mt-1.5 flex-none text-pretty text-xs break-words text-status-conflict" role="alert">{error}</p>}
      <div className="mt-2 flex flex-none flex-wrap gap-2">
        <Button size="sm" variant="default" className="min-h-11 min-w-[6.5rem] flex-1" disabled={!open || busy} onClick={() => void submit(questionDismissal())}>Dismiss</Button>
        <Button size="sm" variant="primary" className="min-h-11 min-w-[6.5rem] flex-1" disabled={!open || busy || !answer} onClick={() => answer && void submit(answer)}>Send answer</Button>
      </div>
    </section>
  );
};
