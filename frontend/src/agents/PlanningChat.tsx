// The chat column of Agents > Sprint > Planning: the DOCK chat session titled Planning-<sprint>, opened with a first
// message that runs the kit skill sprint-planner. The agent asks its open questions and changes the draft through the
// ingest routes; the panel beside it polls that draft.
import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { MessagesSquare, Plus } from 'lucide-react';
import { Button } from '../components/ui';
import { GET_CHAT_SESSIONS, OPEN_PLANNING_CHAT } from '../graphql/queries';
import { ChatThread } from '../chat/ChatThread';
import type { ChatSession } from '../chat/messages';
import { planningChatTitle } from './planning';

export const PlanningChat: React.FC<{ sprint: string }> = ({ sprint }) => {
  const title = planningChatTitle(sprint);
  const [error, setError] = useState<string | null>(null);
  const sessions = useQuery<{ chatSessions: ChatSession[] }>(GET_CHAT_SESSIONS, { variables: { source: 'dock', limit: 300 }, fetchPolicy: 'cache-and-network' });
  // DOCK opens the session with a first message that runs the kit skill sprint-planner for this sprint.
  const [create, creating] = useMutation<{ openPlanningChat: string }>(OPEN_PLANNING_CHAT);
  // The list arrives newest first.
  const session = sessions.data?.chatSessions.find((item) => item.title === title) ?? null;

  const onOpen = async () => {
    setError(null);
    try {
      await create({ variables: { sprint } });
      await sessions.refetch();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The chat could not be opened');
    }
  };

  return (
    <section aria-label="Planning chat" className="flex h-[620px] max-h-[calc(100dvh-2rem)] min-h-[420px] min-w-0 flex-col self-start overflow-hidden rounded-md border border-border bg-surface-0 xl:sticky xl:top-4 xl:h-[680px]">
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
        <MessagesSquare size={14} className="flex-none text-secondary-foreground" aria-hidden="true" />
        <span className="font-display text-[0.84rem] font-semibold">Chat</span>
        <span className="min-w-0 truncate font-mono text-[0.62rem] text-muted-foreground">{title}</span>
      </div>
      {session ? (
        <ChatThread key={session.id} sessionId={session.id} className="min-h-0 flex-1" compact />
      ) : (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 px-4 py-6">
          <p className="text-pretty text-sm text-muted-foreground">
            Plan {sprint} in a chat: paste the storyboard link and the epic, answer the open questions, and every change the agent makes shows in the panel.
          </p>
          {error && <p className="text-sm text-status-conflict" role="alert">{error}</p>}
          <Button variant="primary" onClick={() => void onOpen()} disabled={creating.loading || (sessions.loading && !sessions.data)}>
            <Plus size={14} aria-hidden="true" />{creating.loading ? 'Opening...' : 'Open planning chat'}
          </Button>
        </div>
      )}
    </section>
  );
};
