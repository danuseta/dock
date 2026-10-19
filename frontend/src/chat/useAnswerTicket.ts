import { useCallback, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { SEND_CHAT_MESSAGE } from '../graphql/mutations';
import { GET_CHAT_SESSIONS } from '../graphql/queries';
import type { ChatSession } from './messages';

/**
 * Answers the agent working a ticket: the text goes to the newest DOCK session of that ticket,
 * the one the cron or the Session button opened, as if typed there.
 */
export function useAnswerTicket() {
  const client = useApolloClient();
  const [sending, setSending] = useState(false);

  const answer = useCallback(async (ticketKey: string, text: string) => {
    setSending(true);
    try {
      const { data } = await client.query<{ chatSessions: ChatSession[] }>({ query: GET_CHAT_SESSIONS, variables: { source: 'dock', limit: 300 }, fetchPolicy: 'network-only' });
      // The list arrives newest first.
      const session = data.chatSessions.find((item) => item.ticketKey === ticketKey);
      if (!session) throw new Error(`No DOCK session works on ${ticketKey} yet. Open one with Session.`);
      await client.mutate({ mutation: SEND_CHAT_MESSAGE, variables: { sessionId: session.id, text } });
      return session.title || ticketKey;
    } finally {
      setSending(false);
    }
  }, [client]);

  return { answer, sending };
}
