import { useEffect } from 'react';
import { useQuery } from '@apollo/client';
import { GET_AGENT_LOOKS } from '../../graphql/queries';
import { apiOrigin } from '../../lib/apollo';
import { useAgentLooksStore, type AgentLookRow } from '../../stores/useAgentLooksStore';

const POLL_MS = 60_000;

/** Keeps the saved agent looks in the store, so every avatar in DOCK shows the same name, colour and image. */
export const AgentLooksLoader = () => {
  const { data } = useQuery<{ agentLooks: AgentLookRow[] }>(GET_AGENT_LOOKS, { fetchPolicy: 'cache-and-network', pollInterval: POLL_MS });
  const setRows = useAgentLooksStore((state) => state.setRows);
  useEffect(() => {
    if (data?.agentLooks) setRows(data.agentLooks, apiOrigin);
  }, [data, setRows]);
  return null;
};
