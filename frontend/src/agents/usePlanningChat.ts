import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_CHAT_SESSIONS, OPEN_PLANNING_CHAT } from '../graphql/queries';
import { chatStore } from '../chat/store';
import type { ChatSession } from '../chat/messages';
import { planningChatTitle } from './planning';

export interface PlanningSession {
  title: string;
  id: string | null;
  loading: boolean;
  starting: boolean;
  error: string | null;
  /** Creates the sprint's Planning chat the first time; resolves to its session id. */
  start: () => Promise<string | null>;
  /** Fills the message box of the Planning chat, creating it first when needed; never sends. */
  open: (prefill?: string) => Promise<void>;
}

/** The sprint's Planning-<sprint> chat session that the Draft page shows in its right column. */
export function usePlanningSession(sprint: string): PlanningSession {
  const title = planningChatTitle(sprint);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ sprint: string; id: string } | null>(null);
  const sessions = useQuery<{ chatSessions: ChatSession[] }>(GET_CHAT_SESSIONS, { variables: { source: 'dock', limit: 300 }, skip: !sprint, fetchPolicy: 'cache-and-network' });
  const [create, creating] = useMutation<{ openPlanningChat: string }>(OPEN_PLANNING_CHAT);
  // The list arrives newest first.
  const found = sessions.data?.chatSessions.find((item) => item.title === title)?.id ?? null;
  const id = found ?? (created?.sprint === sprint ? created.id : null);

  const start = async () => {
    if (id) return id;
    setError(null);
    try {
      const answer = await create({ variables: { sprint } });
      const next = answer.data?.openPlanningChat ?? null;
      if (next) setCreated({ sprint, id: next });
      return next;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The chat could not be opened');
      return null;
    }
  };
  const open = async (prefill?: string) => {
    const target = await start();
    if (target && prefill) chatStore.prefill(target, prefill);
  };
  return { title, id, loading: !sessions.data && sessions.loading, starting: creating.loading, error: error ?? sessions.error?.message ?? null, start, open };
}
