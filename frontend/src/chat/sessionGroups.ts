import { dotState, type DotState } from './headerState';
import type { ChatSession } from './messages';

export type SessionGroupKey = 'needs-you' | 'running' | 'done';
export interface SessionGroup { key: SessionGroupKey; label: string; sessions: ChatSession[] }

const LABELS: Record<SessionGroupKey, string> = { 'needs-you': 'Needs you', running: 'Running', done: 'Done' };
const ORDER: SessionGroupKey[] = ['needs-you', 'running', 'done'];

export function sessionGroupKey(session: Pick<ChatSession, 'waiting' | 'status'>): SessionGroupKey {
  if (session.waiting) return 'needs-you';
  return session.status === 'queued' || session.status === 'running' ? 'running' : 'done';
}

// Done sessions stay grey even while the bridge is down, so the list does not turn red at once.
export function sidebarDot(session: Pick<ChatSession, 'waiting' | 'status'>, facts: { bridgeUp: boolean | undefined; stale: boolean }): DotState {
  const key = sessionGroupKey(session);
  if (key === 'done') return 'done';
  const busy = session.status === 'queued' || session.status === 'running';
  return dotState({ bridgeUp: facts.bridgeUp, waiting: key === 'needs-you', busy, delayed: facts.stale && busy });
}

export function groupSessions(sessions: ChatSession[]): SessionGroup[] {
  return ORDER
    .map((key) => ({ key, label: LABELS[key], sessions: sessions.filter((s) => sessionGroupKey(s) === key) }))
    .filter((group) => group.sessions.length > 0);
}
