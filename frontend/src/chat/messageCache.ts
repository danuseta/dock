import { isOptimistic, type ChatMessage } from './messages';

export const CACHED_SESSIONS = 20;
export const CACHED_MESSAGES = 200;

interface Remembered { messages: ChatMessage[]; hasOlder: boolean }

const remembered = new Map<string, Remembered>();

/** What the thread of a session showed last time, so reopening it paints at once and only the newer lines are fetched. */
export function recallMessages(sessionId: string): Remembered | undefined {
  return remembered.get(sessionId);
}

export function rememberMessages(sessionId: string, messages: ChatMessage[], hasOlder: boolean): void {
  const confirmed = messages.filter((message) => !isOptimistic(message));
  if (confirmed.length === 0) return;
  const cut = Math.max(0, confirmed.length - CACHED_MESSAGES);
  let from = cut;
  while (from > 0 && confirmed[from].role !== 'user') from -= 1;
  const kept = confirmed.slice(confirmed[from].role === 'user' ? from : cut);
  remembered.delete(sessionId);
  remembered.set(sessionId, { messages: kept, hasOlder: hasOlder || kept.length < confirmed.length });
  if (remembered.size > CACHED_SESSIONS) remembered.delete(remembered.keys().next().value!);
}
