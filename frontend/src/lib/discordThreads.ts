/** Threads of the Discord channels the owner follows, filtered and ordered for the Discord page. */

export type ChannelKind = 'bug' | 'uat' | 'pr' | 'follow';
/** 'all', or the id of one followed channel. */
export type ChannelTab = string;
export type ThreadView = 'needs' | 'open' | 'done';

export interface DiscordChannel { id: string; name: string | null; kind: ChannelKind; thread: boolean; enabled: boolean }

export interface DiscordMessage {
  id: string;
  author: string;
  avatar: string;
  mine: boolean;
  at: string;
  text: string;
  mentions: Array<{ id: string; name: string; me: boolean; role: boolean }>;
  attachments: Array<{ name: string; size: number; type: string | null; url: string; width: number | null; height: number | null }>;
}

export interface DiscordThread {
  id: string;
  channelId: string;
  channel: string;
  kind: ChannelKind;
  title: string;
  url: string;
  state: string;
  why: string;
  needsYou: boolean;
  older: boolean;
  dismissed: boolean;
  createdBy: string | null;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  tags: string[];
  tickets: Array<{ key: string; status: string | null; assignee: string | null; sprint: string | null; sprintActive: boolean }>;
  prs: string[];
  claim: { author: string; mine: boolean; at: string } | null;
  claimerRepliedAt: string | null;
  mentionedAt: string | null;
  repliedAt: string | null;
  messages: DiscordMessage[];
}

export const ALL = 'all';

/** What each kind of channel lists. */
export const KINDS: Array<{ id: ChannelKind; label: string; help: string }> = [
  { id: 'bug', label: 'Bug report', help: 'Every thread; new ones nobody took need you' },
  { id: 'uat', label: 'UAT bug report', help: 'Every thread; new ones nobody took need you' },
  { id: 'pr', label: 'PR review', help: 'Your PR threads and the ones that ask you' },
  { id: 'follow', label: 'Follow', help: 'Only what mentions or involves you; a thread always' },
];

export const channelLabel = (channel: DiscordChannel) => (channel.name ? `${channel.thread ? '' : '#'}${channel.name}` : channel.id);

/** The tabs: All, then each followed channel that is on. */
export const channelTabs = (channels: DiscordChannel[]) => [{ id: ALL, label: 'All' }, ...channels.filter((channel) => channel.enabled).map((channel) => ({ id: channel.id, label: channelLabel(channel) }))];

export const VIEWS: Array<{ id: ThreadView; label: string }> = [
  { id: 'needs', label: 'Needs you' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
];

/** The labels of the board-threads branch of shovian/dock. */
export const STATE_LABEL: Record<string, string> = {
  FLOW_1: 'New bug',
  FLOW_2: 'Bug, mentions you',
  FLOW_3: 'UAT bug',
  FLOW_4: 'UAT bug, mentions you',
  YOUR_TURN: 'Your turn',
  FLOW_5: 'Comment on your PR',
  REVIEW_ASKED: 'Review asked',
  YOURS_IN_PROGRESS: 'Yours, in progress',
  TAKEN: 'Taken',
  WAITING_ON_REPORTER: 'Waiting on reporter',
  FOLLOWING: 'Following',
  HANDLED: 'Handled',
  CLOSED: 'Closed',
};

const ORDER = ['FLOW_1', 'FLOW_2', 'FLOW_3', 'FLOW_4', 'YOUR_TURN', 'FLOW_5', 'REVIEW_ASKED', 'YOURS_IN_PROGRESS', 'TAKEN', 'WAITING_ON_REPORTER', 'FOLLOWING', 'HANDLED', 'CLOSED'];
const rank = (state: string) => (ORDER.includes(state) ? ORDER.indexOf(state) : ORDER.length);
const SETTLED = new Set(['HANDLED', 'CLOSED']);

export const isDone = (thread: DiscordThread) => thread.dismissed || SETTLED.has(thread.state);
export const needsYou = (thread: DiscordThread) => thread.needsYou && !thread.dismissed;

const inView: Record<ThreadView, (thread: DiscordThread) => boolean> = {
  needs: needsYou,
  open: (thread) => !isDone(thread),
  done: isDone,
};

const inTab = (row: DiscordThread, tab: ChannelTab) => tab === ALL || row.channelId === tab;

/**
 * The threads of one tab and view. Needs you lists what is fresh first, by state then newest, and the quiet ones after;
 * the other views go newest first.
 */
export function threadsFor(rows: DiscordThread[], tab: ChannelTab, view: ThreadView): DiscordThread[] {
  const listed = rows.filter((row) => inTab(row, tab) && inView[view](row));
  const newest = (a: DiscordThread, b: DiscordThread) => b.lastActivity.localeCompare(a.lastActivity);
  if (view !== 'needs') return listed.sort(newest);
  return listed.sort((a, b) => Number(a.older) - Number(b.older) || rank(a.state) - rank(b.state) || newest(a, b));
}

export const countFor = (rows: DiscordThread[], tab: ChannelTab, view: ThreadView) => rows.filter((row) => inTab(row, tab) && inView[view](row)).length;

/** "12m", "3h", "2d": how long ago, for the list. */
export function ago(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

const WIB: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Jakarta' };

/** "22 Oct 18:58 WIB": when it was posted, in Jakarta time whatever the browser's zone. */
export const wib = (iso: string) => `${new Date(iso).toLocaleString('en-GB', { ...WIB, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(',', '')} WIB`;
/** "18:58 WIB". */
export const wibTime = (iso: string) => `${new Date(iso).toLocaleTimeString('en-GB', { ...WIB, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} WIB`;
/** "Thu 23 Oct", the day in Jakarta, for the dividers between messages. */
export const wibDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { ...WIB, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');

/** True when the title, a ticket key, a person or a message has the text, in any case. */
export function matchesSearch(thread: DiscordThread, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [thread.title, thread.createdBy ?? '', ...thread.tickets.map((ticket) => ticket.key), ...thread.messages.flatMap((message) => [message.author, message.text])]
    .some((value) => value.toLowerCase().includes(needle));
}

export const NO_SPRINT = 'No sprint';
export interface SprintGroup { name: string; active: boolean; threads: DiscordThread[] }

const sprintNumber = (name: string) => Number(/(\d+)\s*$/.exec(name)?.[1] ?? -1);

/**
 * The threads by the Jira sprint of their first ticket that has one: the active sprint first, then the newest sprint
 * number first, and threads without a sprint last. Each group keeps the order it was given.
 */
export function sprintGroups(threads: DiscordThread[]): SprintGroup[] {
  const groups = new Map<string, SprintGroup>();
  for (const thread of threads) {
    const ticket = thread.tickets.find((item) => item.sprint);
    const name = ticket?.sprint ?? NO_SPRINT;
    const group = groups.get(name) ?? { name, active: Boolean(ticket?.sprintActive), threads: [] };
    group.threads.push(thread);
    groups.set(name, group);
  }
  return [...groups.values()].sort((a, b) => Number(a.name === NO_SPRINT) - Number(b.name === NO_SPRINT) || Number(b.active) - Number(a.active) || sprintNumber(b.name) - sprintNumber(a.name) || a.name.localeCompare(b.name));
}

const TICKET_IN_TITLE = /(\b[A-Z][A-Z0-9_]{1,31}-[1-9]\d{0,9}\b)/i;

/** The title with its ticket keys marked, so the list colours them instead of repeating them as a chip. */
export const titleParts = (title: string) => title.split(TICKET_IN_TITLE).filter(Boolean).map((text) => ({ text, ticket: TICKET_IN_TITLE.test(text) }));

export type Progress = 'open' | 'progress' | 'done';

/** The one chip a row shows: done when settled or marked done, in progress once somebody said on it. */
export const progressOf = (thread: DiscordThread): Progress => (isDone(thread) ? 'done' : thread.claim ? 'progress' : 'open');

export const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Splits a message into plain text and the @names it mentions, so the page can mark them. */
export function mentionParts(message: DiscordMessage): Array<{ text: string; mention?: 'me' | 'other' | 'role' }> {
  const names = message.mentions.map((mention) => ({ token: `@${mention.name}`, me: mention.me, role: mention.role })).sort((a, b) => b.token.length - a.token.length);
  if (!names.length) return [{ text: message.text }];
  const escaped = names.map((name) => name.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return message.text.split(new RegExp(`(${escaped.join('|')})`)).filter(Boolean).map((part) => {
    const name = names.find((entry) => entry.token === part);
    return name ? { text: part, mention: name.me ? 'me' : name.role ? 'role' : 'other' } : { text: part };
  });
}

export const DISCORD_ITEM = 'discord-';

/** The threads that need the owner and are not quiet yet, as Needs you items on Home. */
export const discordAttention = (rows: DiscordThread[]) => rows.filter((row) => needsYou(row) && !row.older).map((row) => ({
  id: `${DISCORD_ITEM}${row.id}`,
  type: 'DISCORD',
  message: `${row.why} in ${row.channel === row.title ? 'a followed thread' : `#${row.channel}`}: ${row.title}`,
  ticketKey: row.tickets[0]?.key ?? null,
}));
