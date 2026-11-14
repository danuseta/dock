import { useState } from 'react';
import { useApolloClient, useMutation } from '@apollo/client';
import { GET_CHAT_SESSIONS, OPEN_PLANNING_CHAT } from '../graphql/queries';
import { chatStore } from '../chat/store';
import type { ChatSession } from '../chat/messages';
import { planningChatTitle } from './planning';

/** Opens the sprint's Planning chat in the ChatDock, creating it the first time. */
export function useOpenPlanningChat(sprint: string) {
  const title = planningChatTitle(sprint);
  const [error, setError] = useState<string | null>(null);
  const client = useApolloClient();
  const [create, creating] = useMutation<{ openPlanningChat: string }>(OPEN_PLANNING_CHAT);

  const open = async () => {
    setError(null);
    try {
      const sessions = await client.query<{ chatSessions: ChatSession[] }>({ query: GET_CHAT_SESSIONS, variables: { source: 'dock', limit: 300 }, fetchPolicy: 'network-only' });
      // The list arrives newest first.
      const existing = sessions.data.chatSessions.find((item) => item.title === title);
      if (existing) {
        chatStore.openSession(existing.id);
        return;
      }
      const created = await create({ variables: { sprint } });
      const id = created.data?.openPlanningChat;
      if (id) chatStore.openSession(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The chat could not be opened');
    }
  };
  return { title, open, opening: creating.loading, error };
}
