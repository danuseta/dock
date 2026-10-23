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
import { monitorsOnly, useDockMode } from '../lib/dockMode';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { AnswerSheet } from '../decisions/AnswerSheet';
import { QuestionView } from '../decisions/QuestionView';
import { KEEP, isAnswered, questionsOf, submissionOf, type Question } from '../decisions/questions';
import { useDraft } from '../decisions/useDraft';
import { TicketList } from '../decisions/TicketList';

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
        <div className="grid grid-cols-[300px_minmax(0,1fr)] overflow-clip rounded-md border border-border bg-surface-0 max-[900px]:grid-cols-1">
          <TicketList tickets={tickets} openKey={current.run.key} drafts={drafts} q={q} onOpen={go} />
          <div className="@container min-w-0">
            {q === SHEET ? (
              <AnswerSheet run={current.run} questions={questions} drafts={drafts} submitting={submitting} readOnly={readOnly} error={submitError} onOpen={(index) => go(current.run.key, index + 1)} onKeepAll={(ids) => ids.forEach((id) => update(id, { choice: KEEP }))} onSubmit={() => void submit()} />
            ) : (
              <QuestionView
                key={questions[q - 1].id}
                run={current.run}
                question={questions[q - 1]}
                number={q}
                total={questions.length}
                draft={drafts[questions[q - 1].id]}
                sentCount={questions.filter((question) => drafts[question.id]?.sent).length}
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
