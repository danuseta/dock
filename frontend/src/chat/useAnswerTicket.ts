import { useCallback, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { ANSWER_TICKET } from '../graphql/mutations';

/**
 * Answers the agent working a ticket. DOCK sends the text to the newest DOCK session of that ticket,
 * the one the cron or the Session button opened, and holds it until a running turn ends.
 */
export function useAnswerTicket() {
  const client = useApolloClient();
  const [sending, setSending] = useState(false);

  const answer = useCallback(async (ticketKey: string, text: string, issue?: number) => {
    setSending(true);
    try {
      await client.mutate({ mutation: ANSWER_TICKET, variables: { ticketKey, text, issue } });
      return `the ${ticketKey} session`;
    } finally {
      setSending(false);
    }
  }, [client]);

  return { answer, sending };
}
