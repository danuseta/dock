import type { ChatSession } from './messages';

export type SessionGroupKey = 'needs-you' | 'running' | 'done';
export interface SessionGroup { key: SessionGroupKey; label: string; sessions: ChatSession[] }

const LABELS: Record<SessionGroupKey, string> = { 'needs-you': 'Needs you', running: 'Running', done: 'Done' };
const ORDER: SessionGroupKey[] = ['needs-you', 'running', 'done'];

export function sessionGroupKey(session: Pick<ChatSession, 'waiting' | 'status'>): SessionGroupKey {
  if (session.waiting) return 'needs-you';
  return session.status === 'queued' || session.status === 'running' ? 'running' : 'done';
}

export function groupSessions(sessions: ChatSession[]): SessionGroup[] {
  return ORDER
    .map((key) => ({ key, label: LABELS[key], sessions: sessions.filter((s) => sessionGroupKey(s) === key) }))
    .filter((group) => group.sessions.length > 0);
}
