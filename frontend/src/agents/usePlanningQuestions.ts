import { useMutation, useQuery } from '@apollo/client';
import { ANSWER_SPRINT_DRAFT_QUESTION, GET_SPRINT_DRAFT, GET_SPRINT_PLAN_SIGNAL } from '../graphql/queries';
import type { PlanSignal, SprintDraft } from './planning';

export interface QuestionTarget { id: string; key: string | null; number: number }

/** The draft's questions and whether this DOCK may answer them, polled like the Planning panel. */
export function usePlanningQuestions(sprint: string | null) {
  const draft = useQuery<{ sprintDraft: SprintDraft | null }>(GET_SPRINT_DRAFT, { variables: { sprint: sprint ?? '' }, skip: !sprint, fetchPolicy: 'cache-and-network', pollInterval: 10000 });
  const signal = useQuery<{ sprintPlanSignal: PlanSignal | null }>(GET_SPRINT_PLAN_SIGNAL, { variables: { sprint: sprint ?? '' }, skip: !sprint, fetchPolicy: 'cache-first' });
  const [answerMutation, answering] = useMutation(ANSWER_SPRINT_DRAFT_QUESTION);
  const questions = draft.data?.sprintDraft?.questions ?? [];
  const canAnswer = signal.data?.sprintPlanSignal?.isPlanner ?? true;
  const answer = async (id: string, text: string) => {
    await answerMutation({ variables: { sprint, id, answered: true, text } });
    await draft.refetch();
  };
  return { questions, canAnswer, answer, answering: answering.loading, planner: signal.data?.sprintPlanSignal?.planner ?? null };
}
