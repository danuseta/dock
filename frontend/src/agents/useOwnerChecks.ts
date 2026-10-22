import { useCallback, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { CHANGE_DECISION, CONFIRM_DECISIONS } from '../graphql/mutations';
import { useAnswerTicket } from '../chat/useAnswerTicket';

/**
 * The owner's word on a sous build: answer an issue or change a decision (each opens a new sous session),
 * or confirm guessed decisions (recorded only). Each call rejects with the reason when DOCK refuses it.
 */
export function useOwnerChecks() {
  const client = useApolloClient();
  const { answer, sending } = useAnswerTicket();
  const [saving, setSaving] = useState(false);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await work();
      await client.refetchQueries({ include: ['GetOrchestrations', 'GetOrchestration'] });
    } finally {
      setSaving(false);
    }
  }, [client]);

  const answerIssue = useCallback((ticketKey: string, issue: number, text: string) => run(() => answer(ticketKey, text, issue)), [answer, run]);
  const changeDecision = useCallback((ticketKey: string, n: number, choice: string) => run(() => client.mutate({ mutation: CHANGE_DECISION, variables: { ticketKey, n, choice } })), [client, run]);
  const confirmDecisions = useCallback((ticketKey: string, ns: number[]) => run(() => client.mutate({ mutation: CONFIRM_DECISIONS, variables: { ticketKey, ns } })), [client, run]);

  return { answerIssue, changeDecision, confirmDecisions, busy: saving || sending };
}
