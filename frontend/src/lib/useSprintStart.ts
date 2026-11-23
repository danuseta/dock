import { useQuery } from '@apollo/client';
import { GET_SPRINT_START } from '../graphql/queries';
import type { SprintStart } from './sprintStart';

/** The sprint's start state; no sprint is the active one. */
export function useSprintStart(sprint?: string | null, skip = false) {
  const query = useQuery<{ sprintStart: SprintStart | null }>(GET_SPRINT_START, { variables: { sprint: sprint ?? null }, skip, fetchPolicy: 'cache-and-network', pollInterval: 30000 });
  return { view: query.data?.sprintStart ?? null, refetch: query.refetch };
}
