const CONNECTION = 'Not saved. Check the connection, then try again.';

/** The reason a save was refused when the server gave one (BAD_USER_INPUT), else the connection message. */
export function saveErrorText(failure: unknown, fallback = CONNECTION): string {
  const errors = (failure as { graphQLErrors?: Array<{ message?: string; extensions?: { code?: unknown } }> } | null)?.graphQLErrors ?? [];
  const refused = errors.find((error) => error.extensions?.code === 'BAD_USER_INPUT' && error.message);
  return refused ? `Not saved: ${refused.message}` : fallback;
}
