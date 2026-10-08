export interface ChatMessage {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | string;
  text: string;
  state: 'queued' | 'taken' | 'done' | 'failed' | string;
  at: string;
}

export interface ChatSession {
  id: string;
  source: 'cli' | 'dock' | string;
  title: string;
  ticketKey?: string | null;
  forkFrom?: string | null;
  status: 'idle' | 'queued' | 'running' | 'error' | string;
  statusDetail?: string | null;
  messageCount: number;
  startedAt: string;
  lastMessageAt: string;
  lastText?: string | null;
}

export const BRIDGE_OFFLINE = 'The laptop bridge is offline. Start it with: node dock-chat.cjs run';
export const BALLOON_LENGTH = 70;
export const FAST_POLL_MS = 1000;
export const SLOW_POLL_MS = 10000;

/** A message the browser has shown before the server confirmed it carries a negative id. */
export const isOptimistic = (message: ChatMessage) => message.id < 0;

/**
 * Joins two batches into one thread: one entry per id (the incoming copy wins, so a state change
 * such as queued -> done is picked up), ascending by id, with unconfirmed messages kept last.
 */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<number, ChatMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  const all = [...byId.values()];
  return [
    ...all.filter((message) => !isOptimistic(message)).sort((a, b) => a.id - b.id),
    ...all.filter(isOptimistic).sort((a, b) => b.id - a.id),
  ];
}

const isOpenTurn = (message: ChatMessage) => !isOptimistic(message) && message.role === 'user' && (message.state === 'queued' || message.state === 'taken');

/**
 * The `afterId` for the next poll: normally the newest id we hold. When the session has gone quiet but one of
 * our own messages still reads queued or taken, the cursor steps back to just before it, so the poll returns
 * that message again with its final state.
 */
export function pollCursor(messages: ChatMessage[], status?: string): number | undefined {
  const confirmed = messages.filter((message) => !isOptimistic(message));
  if (confirmed.length === 0) return undefined;
  const open = status === 'queued' || status === 'running' ? undefined : confirmed.find(isOpenTurn);
  return open ? open.id - 1 : confirmed[confirmed.length - 1].id;
}

export function oldestId(messages: ChatMessage[]): number | undefined {
  return messages.find((message) => !isOptimistic(message))?.id;
}

export function newestAssistantId(messages: ChatMessage[]): number {
  let newest = 0;
  for (const message of messages) if (message.role === 'assistant' && message.id > newest) newest = message.id;
  return newest;
}

export function isTurnInProgress(status: string | undefined, messages: ChatMessage[]): boolean {
  return status === 'queued' || status === 'running' || messages.some((message) => isOptimistic(message) || isOpenTurn(message));
}

export const pollInterval = (busy: boolean) => (busy ? FAST_POLL_MS : SLOW_POLL_MS);

/** Why the send button is off, or null when a message may be sent. */
export function sendBlocker(input: { source?: string; busy: boolean; bridgeOnline?: boolean }): string | null {
  if (input.source === 'cli') return 'This session was run in the terminal. It is read-only here.';
  if (input.bridgeOnline === false) return BRIDGE_OFFLINE;
  if (input.busy) return 'Claude is still working on your last message.';
  return null;
}

export function balloonText(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > BALLOON_LENGTH ? `${line.slice(0, BALLOON_LENGTH)}…` : line;
}

export interface TicketBalloon { key: string; sessionId: string; text: string }

/** One balloon per ticket: the newest assistant line among that ticket's dock sessions. */
export function ticketBalloons(messages: ChatMessage[], sessions: Array<{ id: string; ticketKey?: string | null }>): TicketBalloon[] {
  const ticketOf = new Map(sessions.map((session) => [session.id, session.ticketKey]));
  const newest = new Map<string, ChatMessage>();
  for (const message of messages) {
    const key = ticketOf.get(message.sessionId);
    if (!key) continue;
    const current = newest.get(key);
    if (!current || message.id > current.id) newest.set(key, message);
  }
  return [...newest].map(([key, message]) => ({ key, sessionId: message.sessionId, text: balloonText(message.text) }));
}

export function relativeTime(at: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(at)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}
