import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_ORCHESTRATIONS } from '../graphql/queries';
import { SUBMIT_DECISIONS } from '../graphql/mutations';
import type { AgentRun } from '../agents/runs';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { AllClearScene } from '../components/empty/scenes/AllClearScene';
import { Toast } from '../components/Toast';
import { Card, Page } from '../components/ui';
import { cn } from '../lib/cn';
import { monitorsOnly, useDockMode } from '../lib/dockMode';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { AnswerSheet } from '../decisions/AnswerSheet';
import { QuestionView } from '../decisions/QuestionView';
import { isAnswered, questionsOf, submissionOf, type Question } from '../decisions/questions';
import { useDraft } from '../decisions/useDraft';

const SHEET = 0;

/** The open question of the URL: ?ticket=KEY&q=N, where q=0 (or none past the last) is the answer sheet. */
function fromSearch(search: string) {
  const params = new URLSearchParams(search);
  const q = Number(params.get('q') ?? 1);
  return { ticket: params.get('ticket'), q: Number.isInteger(q) && q >= 0 ? q : 1 };
}

function toSearch(ticket: string, q: number) {
  window.history.replaceState(window.history.state, '', `/decisions?ticket=${encodeURIComponent(ticket)}&q=${q}`);
}

/** The questions sous left for the owner, ticket by ticket, answered like an exam and submitted per ticket. */
const DecisionsPage: React.FC = () => {
  const { data, loading, error } = useQuery(GET_ORCHESTRATIONS, { ...CACHED_QUERY_OPTIONS, pollInterval: 30000 });
  const [submitDecisions, { loading: submitting }] = useMutation(SUBMIT_DECISIONS, { refetchQueries: ['GetOrchestrations', 'GetOwnerQuestions'], awaitRefetchQueries: true });
  const readOnly = monitorsOnly(useDockMode()) ? 'This DOCK only monitors. Answer on the workspace DOCK.' : null;
  const [place, setPlace] = useState(() => fromSearch(window.location.search));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Tickets whose agent waits on an answer come first.
  const tickets = useMemo(() => ((data?.orchestrations ?? []) as AgentRun[])
    .map((run) => ({ run, questions: questionsOf(run) }))
    .filter((item) => item.questions.length > 0)
    .sort((a, b) => Number(b.questions.some((q) => q.blocking)) - Number(a.questions.some((q) => q.blocking))), [data]);
  const current = tickets.find((item) => item.run.key === place.ticket) ?? tickets[0] ?? null;
  const questions: Question[] = current?.questions ?? [];
  const { drafts, update, clear, markSent } = useDraft(current?.run.key ?? null);
  const q = place.ticket === current?.run.key && place.q <= questions.length ? place.q : 1;

  const go = (ticket: string, next: number) => {
    setSubmitError(null);
    setPlace({ ticket, q: next });
    toSearch(ticket, next);
  };

  // Answers to questions that were settled meanwhile are dropped.
  useEffect(() => {
    if (!current) return;
    const stale = Object.keys(drafts).filter((id) => !questions.some((question) => question.id === id));
    if (stale.length) clear(stale);
  }, [current, drafts, questions, clear]);

  // A, B, C… picks an option, Enter saves and goes on, J and K move between questions; typing in a box is left alone.
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const question = questions[q - 1];
      const key = event.key.toLowerCase();
      if (key === 'j' && q !== SHEET) go(current.run.key, q === questions.length ? SHEET : q + 1);
      else if (key === 'k' && q > 1) go(current.run.key, q - 1);
      else if (key === 'k' && q === SHEET) go(current.run.key, questions.length);
      else if (event.key === 'Enter' && q !== SHEET && !(target instanceof HTMLButtonElement)) go(current.run.key, q === questions.length ? SHEET : q + 1);
      else if (question && !readOnly && /^[a-j]$/.test(key)) {
        const option = question.options['abcdefghij'.indexOf(key)];
        if (option && !drafts[question.id]?.sent) update(question.id, { choice: option.key });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;
  if (error && !data) return <Page width="full"><Card className="border-status-conflict text-status-conflict" role="alert">Decisions failed to load: {error.message}</Card></Page>;

  const submit = async () => {
    if (!current) return;
    const submission = submissionOf(questions, drafts);
    const sent = questions.filter((question) => isAnswered(drafts[question.id]) && !drafts[question.id]?.sent).map((question) => question.id);
    setSubmitError(null);
    try {
      await submitDecisions({ variables: { ticketKey: current.run.key, ...submission } });
      markSent(sent);
      setToast(submission.answers.length + submission.changes.length ? `${current.run.key}: sent. Sous picks it up in a new session.` : `${current.run.key}: confirmed.`);
    } catch (failure) {
      setSubmitError(`${failure instanceof Error ? failure.message : 'The answers could not be sent'}. Your answers are still here.`);
    }
  };

  return (
    <Page width="full">
      <h1 className="mb-5 font-display text-2xl font-bold">Decisions</h1>
      {!current ? (
        <Card><EmptyState scene={<AllClearScene />} title={<span className="text-status-merged">Nothing to answer</span>} description="Sous has no open question and every guess is confirmed." /></Card>
      ) : (
        <div className="grid grid-cols-[260px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-surface-0 max-[900px]:grid-cols-1">
          <nav className="border-r border-border p-2.5 max-[900px]:order-2 max-[900px]:border-r-0 max-[900px]:border-t" aria-label="Tickets with questions">
            {tickets.map(({ run, questions: list }) => {
              const on = run.key === current.run.key;
              const saved = on ? drafts : {};
              return (
                <div key={run.key} className={cn('rounded-[8px] p-2.5', on && 'bg-surface-1')}>
                  <button type="button" className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => go(run.key, 1)}>
                    <span className="flex justify-between font-mono text-[0.78rem] font-semibold"><span>{run.key}</span><span className="font-normal text-muted-foreground">{list.length} open</span></span>
                    <span className="mt-0.5 block truncate text-[0.78rem] text-muted-foreground">{run.title || 'Untitled'}</span>
                  </button>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {list.map((question, index) => (
                      <button
                        key={question.id}
                        type="button"
                        aria-label={`Question ${index + 1}${question.blocking ? ', sous waits on it' : ''}${isAnswered(saved[question.id]) ? ', answered' : ''}`}
                        aria-current={on && q === index + 1 ? 'step' : undefined}
                        className={cn(
                          'relative grid size-7 place-items-center rounded-[6px] font-mono text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[760px]:size-11',
                          isAnswered(saved[question.id]) && 'bg-surface-2 text-foreground',
                          saved[question.id]?.unsure && 'border border-dashed border-border-glow',
                          on && q === index + 1 && 'text-foreground ring-1 ring-secondary-foreground',
                        )}
                        onClick={() => go(run.key, index + 1)}
                      >
                        {index + 1}
                        {question.blocking && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-300" aria-hidden="true" />}
                      </button>
                    ))}
                    {on && <button type="button" className={cn('h-7 rounded-[6px] px-2 text-xs text-muted-foreground hover:text-foreground max-[760px]:h-11', q === SHEET && 'text-foreground ring-1 ring-secondary-foreground')} onClick={() => go(run.key, SHEET)}>Answer sheet</button>}
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="min-w-0 p-7 max-[760px]:p-4">
            {q === SHEET ? (
              <AnswerSheet run={current.run} questions={questions} drafts={drafts} submitting={submitting} readOnly={readOnly} error={submitError} onOpen={(index) => go(current.run.key, index + 1)} onSubmit={() => void submit()} />
            ) : (
              <QuestionView
                key={questions[q - 1].id}
                run={current.run}
                question={questions[q - 1]}
                number={q}
                total={questions.length}
                draft={drafts[questions[q - 1].id]}
                readOnly={readOnly}
                onChange={(next) => update(questions[q - 1].id, next)}
                onPrevious={() => go(current.run.key, q - 1)}
                onNext={() => go(current.run.key, q === questions.length ? SHEET : q + 1)}
              />
            )}
          </div>
        </div>
      )}
      {toast && <Toast message={toast} type="success" onClose={() => setToast(null)} />}
    </Page>
  );
};

export default DecisionsPage;
