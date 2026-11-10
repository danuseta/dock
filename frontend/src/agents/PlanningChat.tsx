// The planning chat of Agents > Sprint > Planning: the DOCK chat session titled Planning-<sprint>, opened with a first
// message that runs the kit skill sprint-planner. The button opens it in the floating ChatDock; the agent changes the
// draft through the ingest routes and the panel polls that draft.
import React, { useState } from 'react';
import { useApolloClient, useMutation } from '@apollo/client';
import { MessagesSquare } from 'lucide-react';
import { Button } from '../components/ui';
import { GET_CHAT_SESSIONS, OPEN_PLANNING_CHAT } from '../graphql/queries';
import { chatStore } from '../chat/store';
import type { ChatSession } from '../chat/messages';
import { planningChatTitle } from './planning';

export const PlanningChat: React.FC<{ sprint: string }> = ({ sprint }) => {
  const title = planningChatTitle(sprint);
  const [error, setError] = useState<string | null>(null);
  const client = useApolloClient();
  const [create, creating] = useMutation<{ openPlanningChat: string }>(OPEN_PLANNING_CHAT);

  const onOpen = async () => {
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

  return (
    <>
      <Button onClick={() => void onOpen()} disabled={creating.loading} title={title}>
        <MessagesSquare size={14} aria-hidden="true" />{creating.loading ? 'Opening...' : 'Open planning chat'}
      </Button>
      {error && <p className="basis-full text-sm text-status-conflict" role="alert">{error}</p>}
    </>
  );
};
