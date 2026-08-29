export const CACHED_QUERY_OPTIONS = {
  fetchPolicy: 'cache-first',
  nextFetchPolicy: 'cache-first',
  returnPartialData: true,
} as const;

export function isInitialQueryLoading(loading: boolean, data: unknown): boolean {
  return loading && data === undefined;
}
