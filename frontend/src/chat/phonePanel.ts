import { formatDuration } from './activity/activity';
import type { ChatSession } from './messages';

/** The width below which the chat panel fills the screen and uses its phone layout. */
export const PHONE_PANEL_QUERY = '(max-width: 699px)';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The line under the session title in the phone header. */
export function sessionStateLine(input: { status: string; busy: boolean; waiting: boolean; messageCount: number; turnStartedAt: string | null; now: number }): string {
  if (input.waiting) return 'needs you';
  if (input.status === 'queued') return 'queued';
  if (input.busy) {
    const started = input.turnStartedAt ? Date.parse(input.turnStartedAt) : Number.NaN;
    const elapsed = Number.isFinite(started) ? formatDuration(Math.max(0, input.now - started)) : '';
    return elapsed ? `running · ${elapsed}` : 'running';
  }
  if (input.status === 'error') return 'last turn failed';
  return `idle · ${plural(input.messageCount, 'message')}`;
}

export function sessionsLine(sessions: readonly Pick<ChatSession, 'status'>[]): string {
  const running = sessions.filter((session) => session.status === 'running' || session.status === 'queued').length;
  return running > 0 ? `${plural(sessions.length, 'session')} · ${running} running` : plural(sessions.length, 'session');
}

export const isReviewSession = (session: Pick<ChatSession, 'title'>) => /^Review-/i.test(session.title);

/** A message preview without the markdown marks a one-line list cannot render. */
export function plainPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const offlineLine = (machine: string) => `${machine.charAt(0).toUpperCase()}${machine.slice(1)} offline`;
