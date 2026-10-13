const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

export const SESSIONS_PATH = '/sessions';

export function sessionIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('session');
  return id !== null && SESSION_ID.test(id) ? id : null;
}

export const sessionUrl = (id: string | null): string => (id === null ? SESSIONS_PATH : `${SESSIONS_PATH}?session=${encodeURIComponent(id)}`);
