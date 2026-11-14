// The open questions of a sprint draft as cards in its Planning-<sprint> chat: the planner answers one with a quick reply
// or by typing in the composer after "Balas di kotak ketik". The answer is saved on the draft, as a draft decision and a
// Jira comment on the ticket, and goes into the contract's decisions on publish. Another DOCK reads them only.
import React from 'react';
import { Check, HelpCircle } from 'lucide-react';
import { cn } from '../lib/cn';
import { whenText, type DraftQuestion } from './planning';
import type { QuestionTarget } from './usePlanningQuestions';


interface CardsProps {
  questions: DraftQuestion[];
  canAnswer: boolean;
  busy: boolean;
  target: QuestionTarget | null;
  planner: string | null;
  onAnswer: (id: string, text: string) => void;
  onTarget: (target: QuestionTarget) => void;
}

export const PlanningQuestionCards: React.FC<CardsProps> = ({ questions, canAnswer, busy, target, planner, onAnswer, onTarget }) => {
  if (!questions.length) return null;
  return (
    <ol className="mt-4 flex min-w-0 flex-col gap-3" aria-label="Planning questions">
      {questions.map((question, index) => {
        const number = index + 1;
        const chips = question.answered ? ['draft decisions', ...(question.key ? [`komentar Jira ${question.key}`] : []), 'Confluence › Keputusan saat publish'] : [];
        return (
          <li key={question.id} className={cn('rounded-md border border-border bg-surface-1 px-3 py-2.5', target?.id === question.id && 'border-accent')}>
            <div className="flex flex-wrap items-center gap-2 text-[0.8rem]">
              <HelpCircle size={14} aria-hidden="true" className={question.answered ? 'text-status-merged' : 'text-status-warn'} />
              <b className="font-display">Pertanyaan {number}</b>
              {question.key && <span className="rounded-xs border border-border px-1.5 font-mono text-[0.68rem] font-bold">{question.key}</span>}
              <span className="ml-auto font-mono text-[0.64rem] text-muted-foreground">{whenText(question.askedAt)}</span>
            </div>
            <p className="mt-1.5 text-pretty text-[0.84rem] text-foreground">{question.text}</p>
            {question.answered ? (
              <>
                <div className="mt-2 border-l-2 border-status-merged/60 pl-2.5 text-[0.8rem]">
                  <p className="font-mono text-[0.66rem] text-status-merged">Dijawab · {question.answeredBy ?? '-'} · {whenText(question.answeredAt)}</p>
                  {question.answer && <p className="text-secondary-foreground">"{question.answer}"</p>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chips.map((chip) => <span key={chip} className="inline-flex items-center gap-1 rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.62rem] text-muted-foreground"><Check size={11} aria-hidden="true" />{chip}</span>)}
                </div>
              </>
            ) : canAnswer ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(question.options ?? []).map((option) => (
                  <button key={option} type="button" disabled={busy} onClick={() => onAnswer(question.id, option)} className="h-7 rounded-pill border border-border bg-surface-0 px-3 font-mono text-[0.7rem] text-secondary-foreground hover:border-accent hover:text-accent disabled:opacity-50 max-[900px]:h-11">{option}</button>
                ))}
                <button type="button" onClick={() => onTarget({ id: question.id, key: question.key, number })} className="h-7 px-2 text-[0.72rem] font-semibold text-accent hover:underline max-[900px]:h-11">Balas di kotak ketik</button>
              </div>
            ) : (
              <p className="mt-2 font-mono text-[0.66rem] text-muted-foreground">nunggu jawaban {planner ?? 'planner'}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
};
