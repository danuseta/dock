import { useEffect, useRef } from 'react';
import { useQuery } from '@apollo/client';
import { GET_CHECKPOINTS } from '../graphql/queries';
import { refreshAcTrace } from '../lib/acTrace';
import { newIds, type Checkpoint } from './checkpoints';

export const CHECKPOINT_POLL_MS = 5000;

/** The ticket's checkpoints, read again on a poll; a new one asks the Sessions Tiket → kode line to read the board again. */
export function useCheckpoints(ticketKey: string | null | undefined, pollMs = CHECKPOINT_POLL_MS): Checkpoint[] {
  const key = ticketKey?.trim().toUpperCase() || '';
  const { data } = useQuery<{ checkpoints: Checkpoint[] }>(GET_CHECKPOINTS, { variables: { key }, skip: !key, pollInterval: pollMs, fetchPolicy: 'cache-and-network' });
  const checkpoints = key ? data?.checkpoints ?? [] : [];
  const seen = useRef<{ key: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!key || !data) return;
    const before = seen.current?.key === key ? seen.current.ids : null;
    if (newIds(before, data.checkpoints).length > 0) refreshAcTrace(key);
    seen.current = { key, ids: new Set(data.checkpoints.map((checkpoint) => checkpoint.id)) };
  }, [key, data]);
  return checkpoints;
}
