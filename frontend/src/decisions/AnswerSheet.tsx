import React from 'react';
import type { AgentRun } from '../agents/runs';
import { Button } from '../components/ui';
import { answerText, submissionOf, unansweredGuesses, type Draft, type Question } from './questions';

interface AnswerSheetProps {
  run: AgentRun;
  questions: Question[];
  drafts: Record<string, Draft>;
  submitting: boolean;
  readOnly: string | null;
  error: string | null;
  onOpen: (index: number) => void;
  onKeepAll: (ids: string[]) => void;
  onSubmit: () => void;
}

/** What the effect of submitting now is, in one sentence. */
function summary(questions: Question[], drafts: Record<string, Draft>): string {
  const { answers, changes, confirms } = submissionOf(questions, drafts);
  const sent = answers.length + changes.length;
  const waiting = questions.filter((question) => drafts[question.id]?.sent).length;
  const open = questions.length - sent - confirms.length - waiting;
  const parts = [
    sent ? `sous opens one session for ${sent === 1 ? 'one answer' : `${sent} answers`}` : null,
    confirms.length ? `${confirms.length === 1 ? 'one guess is' : `${confirms.length} guesses are`} recorded as confirmed` : null,
  ].filter(Boolean);
  const rest = open
    ? `${open === 1 ? 'One question stays' : `${open} questions stay`} open, so the pull requests stay draft.`
    : 'Nothing stays open, so the pull requests go up for review once sous is done.';
  return parts.length ? `If you submit now, ${parts.join(' and ')}. ${rest}` : 'Answer at least one question to submit.';
}

/** The ticket's answers on one page before they are sent together. */
export const AnswerSheet: React.FC<AnswerSheetProps> = ({ run, questions, drafts, submitting, readOnly, error, onOpen, onKeepAll, onSubmit }) => {
  const guesses = unansweredGuesses(questions, drafts);
  const answered = questions.filter((question) => answerText(question, drafts[question.id])).length;
  const firstOpen = questions.findIndex((question) => !answerText(question, drafts[question.id]));
  const nothingNew = (({ answers, changes, confirms }) => answers.length + changes.length + confirms.length === 0)(submissionOf(questions, drafts));
  // What still needs a look comes first: not answered, then unsure, then the rest; sent answers are folded away.
  const rank = (question: Question) => (!answerText(question, drafts[question.id]) ? 0 : drafts[question.id]?.unsure ? 1 : 2);
  const listed = questions.map((question, index) => ({ question, index })).filter(({ question }) => !drafts[question.id]?.sent).sort((a, b) => rank(a.question) - rank(b.question) || a.index - b.index);
  const sent = questions.map((question, index) => ({ question, index })).filter(({ question }) => drafts[question.id]?.sent);
  return (
    <article className="flex flex-col p-7 max-[760px]:p-4" aria-labelledby="answer-sheet">
      <p className="text-xs text-muted-foreground">{run.key} · {run.title || 'Untitled'}</p>
      <h2 id="answer-sheet" className="mt-2 text-xl font-semibold">Answer sheet · {answered} of {questions.length} answered</h2>
      <ol className="mt-4 grid gap-x-6 @min-[860px]:grid-cols-2">
        {listed.map(({ question, index }) => {
          const text = answerText(question, drafts[question.id]);
          return (
            <li key={question.id} className="border-b border-border">
              <button type="button" className="grid w-full grid-cols-[28px_minmax(0,1fr)] gap-x-2 py-2.5 text-left hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[760px]:min-h-11" onClick={() => onOpen(index)}>
                <span className="font-mono text-sm text-muted-foreground">{index + 1}</span>
                <span className="text-pretty text-sm text-foreground">{question.text}</span>
                <span />
                <span className={text ? 'text-pretty text-[0.8rem] text-secondary-foreground' : 'text-[0.8rem] text-amber-200'}>
                  {text ?? 'Not answered'}{drafts[question.id]?.unsure ? ' · unsure' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {sent.length > 0 && (
        <details className="mt-3 text-sm text-secondary-foreground">
          <summary className="cursor-pointer">{sent.length} sent, waiting for sous</summary>
          <ol className="mt-2 flex flex-col gap-1 text-[0.8rem]">
            {sent.map(({ question, index }) => <li key={question.id} className="text-pretty"><span className="mr-2 font-mono text-muted-foreground">{index + 1}</span>{question.text} · {answerText(question, drafts[question.id])}</li>)}
          </ol>
        </details>
      )}
      <p className="mt-4 text-pretty text-sm text-secondary-foreground">{summary(questions, drafts)}</p>
      {error && <p className="mt-2 text-pretty text-sm text-status-conflict" role="alert">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {firstOpen >= 0 && <Button variant="ghost" size="sm" onClick={() => onOpen(firstOpen)}>Back to question {firstOpen + 1}</Button>}
        <span className="flex-1" />
        {!readOnly && guesses.length > 0 && <Button size="sm" title="Answers every unanswered sous guess with Keep what sous built; nothing is sent until you submit" onClick={() => onKeepAll(guesses)}>Keep all sous built ({guesses.length})</Button>}
        {!readOnly && <Button variant="primary" size="sm" disabled={submitting || nothingNew} onClick={onSubmit}>{submitting ? 'Submitting…' : 'Submit'}</Button>}
      </div>
      {readOnly && <p className="mt-2 text-pretty text-xs text-muted-foreground">{readOnly}</p>}
    </article>
  );
};
