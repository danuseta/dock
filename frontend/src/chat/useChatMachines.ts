import { useQuery } from '@apollo/client';
import { GET_CHAT_MACHINES } from '../graphql/queries';
import { SLOW_POLL_MS, type ChatMachine } from './messages';

export function useChatMachines(): ChatMachine[] | undefined {
  const { data } = useQuery<{ chatMachines?: ChatMachine[] | null }>(GET_CHAT_MACHINES, { fetchPolicy: 'cache-and-network', pollInterval: SLOW_POLL_MS });
  return data?.chatMachines ?? undefined;
}
