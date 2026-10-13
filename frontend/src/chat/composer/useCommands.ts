import { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client';
import { CHAT_COMMANDS } from './documents';
import { COMMAND_LIMIT, type ChatCommand } from './composerLogic';

const TYPING_PAUSE_MS = 150;

export function useCommands(machine: string, query: string | null): { commands: ChatCommand[]; loading: boolean } {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (query === null) {
      setSettled(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setSettled(query), TYPING_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const { data, loading } = useQuery<{ chatCommands: ChatCommand[] }>(CHAT_COMMANDS, {
    variables: { machine, query: settled || null, limit: COMMAND_LIMIT },
    skip: settled === null,
    fetchPolicy: 'cache-and-network',
  });
  return { commands: settled === null ? [] : data?.chatCommands ?? [], loading: query !== null && (loading || settled !== query) };
}
