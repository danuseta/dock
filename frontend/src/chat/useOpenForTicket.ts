import { useCallback, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { CREATE_CHAT_SESSION } from '../graphql/mutations';
import { GET_CHAT_SESSIONS } from '../graphql/queries';
import type { ChatSession } from './messages';
import { chatStore } from './store';

/**
 * Opens the chat on a ticket: the newest DOCK session for that ticket when there is one,
 * otherwise a new session titled Task-<key>.
 */
export function useOpenForTicket() {
  const client = useApolloClient();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const openForTicket = useCallback(async (ticketKey: string) => {
    setOpening(true);
    setError('');
    try {
      const { data } = await client.query<{ chatSessions: ChatSession[] }>({ query: GET_CHAT_SESSIONS, variables: { source: 'dock', limit: 300 }, fetchPolicy: 'network-only' });
      // The list arrives newest first.
      let session = data.chatSessions.find((item) => item.ticketKey === ticketKey);
      if (!session) {
        const created = await client.mutate<{ createChatSession: ChatSession }>({ mutation: CREATE_CHAT_SESSION, variables: { title: `Task-${ticketKey}`, ticketKey } });
        session = created.data?.createChatSession;
      }
      if (!session) throw new Error('DOCK did not return a session');
      chatStore.openSession(session.id);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'The chat could not be opened');
    } finally {
      setOpening(false);
    }
  }, [client]);

  return { openForTicket, opening, error };
}
