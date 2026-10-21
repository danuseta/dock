const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

export const SESSIONS_PATH = '/sessions';

export function sessionIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('session');
  return id !== null && SESSION_ID.test(id) ? id : null;
}

const THREAD_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function threadIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('thread');
  return id !== null && THREAD_ID.test(id) ? id : null;
}

export const sessionUrl = (id: string | null, thread: string | null = null): string => {
  if (id === null) return SESSIONS_PATH;
  return `${SESSIONS_PATH}?session=${encodeURIComponent(id)}${thread ? `&thread=${encodeURIComponent(thread)}` : ''}`;
};
