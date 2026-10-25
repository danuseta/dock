import type { PushMessage } from './push';

const MAX_BODY = 180;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const CHOICES = /\s*\[([^\][|]+(?:\|[^\][|]+)+)\]\s*$/;

/** "Keep the tag filter? [Keep|Drop]" reads as the question plus its answers; without brackets there are none. */
export function splitChoices(waiting: string): { question: string; choices: string[] } {
  const match = CHOICES.exec(waiting);
  if (!match) return { question: waiting, choices: [] };
  return { question: waiting.slice(0, match.index).trim(), choices: match[1].split('|').map((choice) => choice.trim()).filter(Boolean) };
}

/** A run that waits on the owner: its fixed answers, at most two, become buttons that answer from the notification. */
export function waitingNotice(run: { key: string; waiting: string }): PushMessage {
  const { question, choices } = splitChoices(run.waiting);
  const shown = choices.slice(0, 2);
  return {
    title: `${run.key} waits on you`,
    body: question.slice(0, MAX_BODY),
    url: `/detail/${encodeURIComponent(run.key)}`,
    tag: `wait-${run.key}`,
    ...(shown.length > 0 ? { actions: shown.map((choice, index) => ({ action: `answer:${index}`, title: choice })), data: { kind: 'answer', ticketKey: run.key, choices: shown } } : {}),
  };
}

export interface AskInfo {
  sessionId: string;
  sessionTitle: string;
  id: number;
  kind: string;
  title: string;
  tool: string | null;
  summary: string | null;
}

/**
 * A request in a chat turn. A permission can be denied from the notification; it can be allowed there only when it is
 * not a shell command, which has to be read in DOCK (behind its PIN) first. Plans and questions open the session.
 */
export function askNotice(ask: AskInfo): PushMessage {
  const base = {
    title: `${ask.sessionTitle || 'A session'} asks`,
    body: [ask.title, ask.summary].filter(Boolean).join(': ').slice(0, MAX_BODY),
    url: `/sessions?session=${encodeURIComponent(ask.sessionId)}`,
    tag: `ask-${ask.sessionId}-${ask.id}`,
  };
  if (ask.kind !== 'permission') return base;
  const actions = ask.tool && SHELL_TOOLS.has(ask.tool)
    ? [{ action: 'deny', title: 'Deny' }]
    : [{ action: 'allow', title: 'Allow once' }, { action: 'deny', title: 'Deny' }];
  return { ...base, actions, data: { kind: 'interaction', sessionId: ask.sessionId, id: ask.id } };
}

/** A chat turn that ended on its own. */
export function turnDoneNotice(turn: { sessionId: string; sessionTitle: string }): PushMessage {
  return {
    title: `${turn.sessionTitle || 'A session'} finished`,
    body: 'The agent finished its turn.',
    url: `/sessions?session=${encodeURIComponent(turn.sessionId)}`,
    tag: `done-${turn.sessionId}`,
  };
}

/** A ticket run that reached its last stage. */
export function runDoneNotice(run: { key: string; title: string }): PushMessage {
  return { title: `${run.key} finished`, body: run.title.slice(0, MAX_BODY), url: `/detail/${encodeURIComponent(run.key)}`, tag: `done-${run.key}` };
}

/** A run that went quiet or ended its turn with agents still running. */
export function stalledNotice(run: { key: string; stalledDetail?: string | null }): PushMessage {
  return {
    title: `${run.key} is stalled`,
    body: (run.stalledDetail || 'No agent activity for a while.').slice(0, MAX_BODY),
    url: `/detail/${encodeURIComponent(run.key)}`,
    tag: `stalled-${run.key}`,
  };
}

/** One new post in a followed Discord channel. */
export function discordPostNotice(post: { threadId: string; messageId: string; channel: string; author: string; text: string }): PushMessage {
  return { title: `${post.channel}: ${post.author}`, body: post.text.slice(0, MAX_BODY), url: '/discord', tag: `discord-${post.threadId}-${post.messageId}` };
}
