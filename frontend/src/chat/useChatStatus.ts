import { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client';
import { GET_CHAT_STATUS } from '../graphql/queries';
import { SLOW_POLL_MS } from './messages';
import type { ChatStatus } from './status';

export function useChatStatus(machine?: string | null): { status: ChatStatus | undefined; now: number; refetch: () => void } {
  const { data, refetch } = useQuery<{ chatStatus: ChatStatus }>(GET_CHAT_STATUS, { variables: { machine: machine || undefined }, fetchPolicy: 'cache-and-network', pollInterval: SLOW_POLL_MS });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return { status: data?.chatStatus, now, refetch: () => void refetch() };
}
