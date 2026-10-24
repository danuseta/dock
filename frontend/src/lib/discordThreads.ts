/** Threads of the Discord channels the owner follows, filtered and ordered for the Discord page. */

export type ChannelKind = 'bug' | 'uat' | 'pr' | 'follow';
/** 'all', or the id of one followed channel. */
export type ChannelTab = string;
export type ThreadView = 'needs' | 'open' | 'done' | 'all';

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
  /** The avatar of whoever opened the thread. */
  createdByAvatar: string | null;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  tags: string[];
  /** Reviewers a pull request asks for, from "-1" or "-2" in its first message or tags; two otherwise. */
  slots: number;
  tickets: Array<{ key: string; status: string | null; assignee: string | null; sprint: string | null; sprintActive: boolean }>;
  prs: string[];
  claim: { author: string; mine: boolean; at: string } | null;
  /** Everyone who said on it; in a PR thread the author of the pull request is left out. */
  onIt: string[];
  /** The Jira Pass labels of the thread's tickets. */
  passes: string[];
  claimerRepliedAt: string | null;
  mentionedAt: string | null;
  repliedAt: string | null;
  messages: DiscordMessage[];
}

export const ALL = 'all';

/** What each kind of channel lists. */
export const KINDS: Array<{ id: ChannelKind; label: string; help: string }> = [
  { id: 'bug', label: 'Bug report', help: 'Every thread; one that mentions you or answers you needs you' },
  { id: 'uat', label: 'UAT bug report', help: 'Every thread; one that mentions you or answers you needs you' },
  { id: 'pr', label: 'PR review', help: 'Every pull request with the reviewers it asks for; yours and the ones that ask you need you' },
  { id: 'follow', label: 'Follow', help: 'Only what mentions or involves you; a thread always' },
];

export const kindLabel = (kind: ChannelKind) => KINDS.find((entry) => entry.id === kind)?.label ?? kind;

export const channelLabel = (channel: DiscordChannel) => (channel.name ? `${channel.thread ? '' : '#'}${channel.name}` : channel.id);

/** The tabs: All, then each followed channel that is on. */
export const channelTabs = (channels: DiscordChannel[]) => [{ id: ALL, label: 'All' }, ...channels.filter((channel) => channel.enabled).map((channel) => ({ id: channel.id, label: channelLabel(channel) }))];

export const VIEWS: Array<{ id: ThreadView; label: string }> = [
  { id: 'needs', label: 'Needs you' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
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
  NOT_YOURS: 'Others reviewing',
  FIXED: 'Fixed',
  TICKET_MADE: 'Jira ticket made',
  HANDLED: 'Handled',
  CLOSED: 'Closed',
};

const ORDER = ['FLOW_1', 'FLOW_2', 'FLOW_3', 'FLOW_4', 'YOUR_TURN', 'FLOW_5', 'REVIEW_ASKED', 'YOURS_IN_PROGRESS', 'TAKEN', 'WAITING_ON_REPORTER', 'FOLLOWING', 'NOT_YOURS', 'FIXED', 'TICKET_MADE', 'HANDLED', 'CLOSED'];
const rank = (state: string) => (ORDER.includes(state) ? ORDER.indexOf(state) : ORDER.length);
const SETTLED = new Set(['FIXED', 'TICKET_MADE', 'HANDLED', 'CLOSED']);

/** Settled, marked done, or a pull request with a Pass label for every reviewer it asks for. */
export const isDone = (thread: DiscordThread) => thread.dismissed || SETTLED.has(thread.state) || (thread.kind === 'pr' && thread.passes.length >= thread.slots);
export const needsYou = (thread: DiscordThread) => thread.needsYou && !thread.dismissed;

const inView: Record<ThreadView, (thread: DiscordThread) => boolean> = {
  needs: needsYou,
  open: (thread) => !isDone(thread),
  done: isDone,
  all: () => true,
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

/** A PR thread's reviewer slots: passed (a Pass label), on it (said on it, no Pass yet) or free. */
export type Slot = 'pass' | 'onit' | 'free';
export function slotsOf(thread: DiscordThread): Slot[] {
  const passed = Math.min(thread.passes.length, thread.slots);
  const taken = Math.max(passed, Math.min(thread.onIt.length, thread.slots));
  return Array.from({ length: thread.slots }, (_, index) => (index < passed ? 'pass' : index < taken ? 'onit' : 'free'));
}

/**
 * The one chip a row shows. A pull request is done with a Pass label for every reviewer and in progress once every
 * slot is taken; anything else is done when settled or marked done, and in progress once somebody said on it or the
 * owner replied.
 */
export function progressOf(thread: DiscordThread): Progress {
  if (isDone(thread)) return 'done';
  if (thread.kind === 'pr') return thread.onIt.length >= thread.slots ? 'progress' : 'open';
  return thread.claim || thread.repliedAt ? 'progress' : 'open';
}

export const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The link a mention becomes in a message's markdown; the page draws it as a highlighted name. */
export const MENTION_LINK = '#mention-';
export type MentionKind = 'me' | 'other' | 'role';

/**
 * A message as markdown the way Discord shows it: every line break kept, custom emoji as :name:, and each @name it
 * mentions as a link to MENTION_LINK + me, role or other.
 */
export function discordMarkdown(message: DiscordMessage): string {
  const names = message.mentions.map((mention) => ({ token: `@${mention.name}`, kind: (mention.me ? 'me' : mention.role ? 'role' : 'other') as MentionKind })).sort((a, b) => b.token.length - a.token.length);
  const escaped = names.map((name) => name.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const text = message.text.replace(/<a?:(\w+):\d+>/g, ':$1:');
  const marked = names.length
    ? text.split(new RegExp(`(${escaped.join('|')})`)).map((part) => {
      const name = names.find((entry) => entry.token === part);
      return name ? `[${part.replace(/[[\]]/g, '\\$&')}](${MENTION_LINK}${name.kind})` : part;
    }).join('')
    : text;
  return marked.replace(/\n/g, '  \n');
}

export const DISCORD_ITEM = 'discord-';

/** The threads that need the owner and are not quiet yet, as Needs you items on Home. */
export const discordAttention = (rows: DiscordThread[]) => rows.filter((row) => needsYou(row) && !row.older).map((row) => ({
  id: `${DISCORD_ITEM}${row.id}`,
  type: 'DISCORD',
  message: `${row.why} in ${row.channel === row.title ? 'a followed thread' : `#${row.channel}`}: ${row.title}`,
  ticketKey: row.tickets[0]?.key ?? null,
}));
