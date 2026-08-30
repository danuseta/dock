export const CACHED_QUERY_OPTIONS = {
  fetchPolicy: 'cache-and-network',
  nextFetchPolicy: 'cache-first',
  returnPartialData: true,
  notifyOnNetworkStatusChange: false,
} as const;

export function isInitialQueryLoading(loading: boolean, data: unknown): boolean {
  return loading && data === undefined;
}

export function mergeReliableAssignee(existing?: string | null, incoming?: string | null): string | undefined {
  const next = incoming?.trim();
  if (!next || next.toLowerCase() === 'unassigned') return existing?.trim() || undefined;
  return next;
}

export function displayAssignee(assignee?: string | null): string {
  return mergeReliableAssignee(undefined, assignee) || 'Syncing assignee…';
}
