import { dotState, type DotState } from './headerState';
import type { ChatSession } from './messages';

export type SessionGroupKey = 'needs-you' | 'today' | 'yesterday' | 'week' | 'earlier';
export interface SessionGroup { key: SessionGroupKey; label: string; sessions: ChatSession[] }

const LABELS: Record<SessionGroupKey, string> = { 'needs-you': 'Needs you', today: 'Today', yesterday: 'Yesterday', week: 'This week', earlier: 'Earlier' };
const ORDER: SessionGroupKey[] = ['needs-you', 'today', 'yesterday', 'week', 'earlier'];
const DAY_MS = 24 * 60 * 60 * 1000;

const isBusy = (session: Pick<ChatSession, 'status'>) => session.status === 'queued' || session.status === 'running';
const localDay = (at: number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Needs you stays on top; the rest goes by the local calendar day of the last message. Running shows as the dot only. */
export function sessionGroupKey(session: Pick<ChatSession, 'waiting' | 'lastMessageAt'>, now: number): SessionGroupKey {
  if (session.waiting) return 'needs-you';
  // Rounded, so a day that is 23 or 25 hours long around a clock change still counts as one.
  const days = Math.round((localDay(now) - localDay(Date.parse(session.lastMessageAt))) / DAY_MS);
  if (!Number.isFinite(days)) return 'earlier';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days <= 6 ? 'week' : 'earlier';
}

// Done sessions stay grey even while the bridge is down, so the list does not turn red at once.
export function sidebarDot(session: Pick<ChatSession, 'waiting' | 'status'>, facts: { bridgeUp: boolean | undefined }): DotState {
  const busy = isBusy(session);
  if (!session.waiting && !busy) return 'done';
  return dotState({ bridgeUp: facts.bridgeUp, waiting: Boolean(session.waiting), busy });
}

export function groupSessions(sessions: ChatSession[], now: number): SessionGroup[] {
  return ORDER
    .map((key) => ({ key, label: LABELS[key], sessions: sessions.filter((s) => sessionGroupKey(s, now) === key) }))
    .filter((group) => group.sessions.length > 0);
}
