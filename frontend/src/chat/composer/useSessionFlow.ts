import { useCallback, useState } from 'react';
import { useApolloClient, useQuery } from '@apollo/client';
import { GET_SOUS_FLOW, GET_SOUS_FLOW_PROMPT, GET_TICKET_SOUS_FLOW } from '../../graphql/queries';
import { isAllRun, parseSettings, profileNames, startsSous } from '../../lib/sousFlow';
import { sessionProfileName, withFlowLines, type SessionFlow } from './sessionFlow';

const storageKey = (sessionId: string) => `dock.sessionFlow.${sessionId}`;

function readPicked(sessionId: string): string | null {
  try { return window.localStorage.getItem(storageKey(sessionId)); } catch { return null; }
}

function writePicked(sessionId: string, name: string | null) {
  try {
    if (name) window.localStorage.setItem(storageKey(sessionId), name);
    else window.localStorage.removeItem(storageKey(sessionId));
  } catch { /* the pick only lasts this page view without storage */ }
}

/** The Sous flow of one chat session, picked in its composer. */
export function useSessionFlow(sessionId: string, ticketKey: string | null | undefined): SessionFlow {
  const client = useApolloClient();
  const { data } = useQuery<{ sousFlow: string }>(GET_SOUS_FLOW, { fetchPolicy: 'cache-and-network' });
  const key = ticketKey?.trim().toUpperCase() || '';
  const { data: ticketData } = useQuery<{ ticketSousFlow: string | null }>(GET_TICKET_SOUS_FLOW, { variables: { key }, skip: !key, fetchPolicy: 'cache-and-network' });
  const [picked, setPicked] = useState<{ sessionId: string; name: string | null }>(() => ({ sessionId, name: readPicked(sessionId) }));
  const own = picked.sessionId === sessionId ? picked.name : readPicked(sessionId);
  const settings = parseSettings(data?.sousFlow);
  const name = sessionProfileName(settings, own, ticketData?.ticketSousFlow);
  const profile = settings.profiles[name];
  const pick = useCallback((next: string | null) => {
    writePicked(sessionId, next);
    setPicked({ sessionId, name: next });
  }, [sessionId]);
  const decorate = async (text: string) => {
    if (!startsSous(text) || isAllRun(profile)) return text;
    const result = await client.query<{ sousFlowPrompt: { lines: string[] } }>({ query: GET_SOUS_FLOW_PROMPT, variables: { profile: name }, fetchPolicy: 'network-only' });
    return withFlowLines(text, profile, result.data.sousFlowPrompt.lines);
  };
  return { names: profileNames(settings), name, profile, picked: Boolean(own && settings.profiles[own]), pick, decorate };
}
