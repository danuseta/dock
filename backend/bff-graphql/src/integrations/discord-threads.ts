import type { PrismaClient } from '@prisma/client';
import { prisma } from '../storage/client';

/**
 * The Discord channels the owner follows and the threads DOCK keeps from them for the Discord page. The reader sends
 * the full set on each sync: a thread that is no longer sent is taken off. A dismissal holds only while the thread's
 * lastActivity is unchanged, so a new message brings the thread back. Shaped after board-threads.ts on the
 * board-threads branch of shovian/dock.
 */

/** How a channel's threads are sorted: the bug, UAT and PR review rules, or only what mentions the owner. */
export const CHANNEL_KINDS = ['bug', 'uat', 'pr', 'follow'] as const;
export type ChannelKind = typeof CHANNEL_KINDS[number];

/** A forum or text channel whose threads DOCK reads, or one thread followed on its own. */
export interface Channel { id: string; name: string | null; kind: ChannelKind; thread: boolean; enabled: boolean }

export const THREAD_STATES = [
  'FLOW_1', 'FLOW_2', 'FLOW_3', 'FLOW_4', 'YOUR_TURN', 'FLOW_5', 'REVIEW_ASKED',
  'YOURS_IN_PROGRESS', 'TAKEN', 'WAITING_ON_REPORTER', 'FOLLOWING', 'FIXED', 'TICKET_MADE', 'HANDLED', 'CLOSED', 'NOT_YOURS',
] as const;
export type ThreadState = typeof THREAD_STATES[number];

/** `url` is Discord's signed CDN link; it expires, so the page gets it through DiscordReader.freshen. */
export interface ThreadAttachment { name: string; size: number; type: string | null; url: string; width: number | null; height: number | null }
/** A user or, with `role`, a server role named in the message. */
export interface ThreadMention { id: string; name: string; me: boolean; role: boolean }
export interface ThreadMessage {
  id: string;
  authorId: string;
  author: string;
  /** The author's Discord avatar, or Discord's default one. */
  avatar: string;
  mine: boolean;
  at: string;
  text: string;
  mentions: ThreadMention[];
  attachments: ThreadAttachment[];
}
export interface ThreadClaim { messageId: string; authorId: string; author: string; mine: boolean; at: string }

export interface ThreadRow {
  /** The shape the row was built with; a row of an older shape is built again on the next sync. */
  version: number;
  id: string;
  channelId: string;
  channel: string;
  kind: ChannelKind;
  title: string;
  url: string;
  state: ThreadState;
  why: string;
  needsYou: boolean;
  createdBy: string | null;
  createdAt: string;
  lastActivity: string;
  lastMessageId: string | null;
  messageCount: number;
  tags: string[];
  tickets: string[];
  prs: string[];
  /** The last "on it" in the thread. */
  claim: ThreadClaim | null;
  /** Everyone who said on it, first one first; in a PR thread the author of the pull request is left out. */
  onIt: string[];
  /** When the claimer wrote again after the claim. */
  claimerRepliedAt: string | null;
  mentionedAt: string | null;
  repliedAt: string | null;
  /** The last messages, oldest first. */
  messages: ThreadMessage[];
}
export interface ThreadView extends ThreadRow { dismissed: boolean }

export interface SyncStatus { syncedAt: string | null; error: string | null; requests: number }

export interface ThreadRecord { id: string; payload: string; lastActivity: Date; lastMessageId: string | null; removedAt: Date | null }

export interface ThreadStore {
  /** Open rows only. */
  rows(): Promise<ThreadRecord[]>;
  upsertRow(row: ThreadRow, now: Date): Promise<void>;
  removeRows(ids: string[], now: Date): Promise<void>;
  /** threadId -> the lastActivity that was dismissed. */
  dismissed(): Promise<Map<string, Date>>;
  addDismissal(threadId: string, lastActivity: Date, now: Date): Promise<void>;
}

const byNewest = (a: ThreadView, b: ThreadView) => Number(b.needsYou) - Number(a.needsYou) || b.lastActivity.localeCompare(a.lastActivity) || a.id.localeCompare(b.id);

export class ThreadService {
  constructor(private readonly store: ThreadStore) {}

  /** Stored rows by id, for the reader to skip threads whose last message did not change. */
  async stored(): Promise<Map<string, ThreadRow>> {
    return new Map((await this.store.rows()).map((row) => [row.id, JSON.parse(row.payload) as ThreadRow]));
  }

  /** The full set from one sync: the open threads missing from it get removedAt. */
  async save(rows: ThreadRow[], now = new Date()) {
    const ids = new Set(rows.map((row) => row.id));
    for (const row of rows) await this.store.upsertRow(row, now);
    const gone = (await this.store.rows()).filter((row) => !ids.has(row.id)).map((row) => row.id);
    if (gone.length) await this.store.removeRows(gone, now);
    return { rows: rows.length, removed: gone.length };
  }

  /** One thread an event changed; the others stay as they are. */
  async saveOne(row: ThreadRow, now = new Date()) {
    await this.store.upsertRow(row, now);
  }

  async removeOne(id: string, now = new Date()) {
    await this.store.removeRows([id], now);
  }

  async list(): Promise<ThreadView[]> {
    const [records, dismissed] = await Promise.all([this.store.rows(), this.store.dismissed()]);
    return records.map((record): ThreadView => {
      const at = dismissed.get(record.id);
      return { ...(JSON.parse(record.payload) as ThreadRow), dismissed: at !== undefined && at.getTime() === record.lastActivity.getTime() };
    }).sort(byNewest);
  }

  /**
   * Hides a thread until its lastActivity changes. `lastActivity` is the one the owner saw on the page, so a sync that
   * lands between the page's fetch and the click does not dismiss a message nobody read. False when the thread is not open.
   */
  async dismiss(id: string, lastActivity: string, now = new Date()) {
    const seen = new Date(lastActivity);
    if (Number.isNaN(seen.getTime())) return false;
    if (!(await this.store.rows()).some((row) => row.id === id)) return false;
    await this.store.addDismissal(id, seen, now);
    return true;
  }
}

/** `sprint` is null when the ticket is in no sprint. */
export interface JiraFacts { status: string | null; assignee: string | null; sprint: string | null; sprintActive: boolean; labels: string[] }
export interface PageThread extends Omit<ThreadView, 'tickets'> {
  older: boolean;
  tickets: Array<{ key: string } & Omit<JiraFacts, 'labels'>>;
  /** The Jira Pass labels of the thread's tickets, such as alvinPass. */
  passes: string[];
}

/** A label that names who approved the ticket, such as alvinPass; the Discord page reads them like lib/ticketApprovals.ts. */
const PASS_LABEL = /^.+pass$/i;

const QUIET_MS = 3 * 24 * 3600 * 1000;

/**
 * Adds what Jira says to each thread. A thread whose tickets Jira has all settled is HANDLED and no longer needs the
 * owner; one that still needs the owner but has been quiet for three days is `older`.
 */
export function withJira(rows: ThreadView[], jira: Map<string, JiraFacts>, isSettled: (status: string | null) => boolean, now: Date): PageThread[] {
  return rows.map((row) => {
    const facts = row.tickets.map((key) => ({ key, ...(jira.get(key) ?? { status: null, assignee: null, sprint: null, sprintActive: false, labels: [] }) }));
    const tickets = facts.map(({ labels: _labels, ...ticket }) => ticket);
    const handled = row.state !== 'CLOSED' && tickets.length > 0 && tickets.every((ticket) => isSettled(ticket.status));
    const needsYou = handled ? false : row.needsYou;
    return {
      ...row,
      tickets,
      passes: [...new Set(facts.flatMap((ticket) => ticket.labels.map((label) => label.trim()).filter((label) => PASS_LABEL.test(label))))],
      ...(handled ? { state: 'HANDLED' as const, why: `Jira says ${tickets[0].status}` } : {}),
      needsYou,
      older: needsYou && now.getTime() - Date.parse(row.lastActivity) > QUIET_MS,
    };
  });
}

export function prismaThreadStore(db: PrismaClient): ThreadStore {
  return {
    rows: () => db.discordThread.findMany({ where: { removedAt: null } }),
    upsertRow: async (row, now) => {
      const data = { payload: JSON.stringify(row), lastActivity: new Date(row.lastActivity), lastMessageId: row.lastMessageId, updatedAt: now, removedAt: null };
      await db.discordThread.upsert({ where: { id: row.id }, create: { id: row.id, ...data }, update: data });
    },
    removeRows: async (ids, now) => { await db.discordThread.updateMany({ where: { id: { in: ids } }, data: { removedAt: now } }); },
    dismissed: async () => new Map((await db.discordThreadDismissal.findMany()).map((row) => [row.threadId, row.lastActivity])),
    addDismissal: async (threadId, lastActivity, now) => {
      await db.discordThreadDismissal.upsert({ where: { threadId }, create: { threadId, lastActivity, createdAt: now }, update: { lastActivity, createdAt: now } });
    },
  };
}

export const threadService = new ThreadService(prismaThreadStore(prisma));

export class ChannelInputError extends Error {}

const SNOWFLAKE = /^\d{15,25}$/;
const CHANNEL_LINK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/\d+\/(\d+)(?:\/(\d+))?\/?$/;

/** The channel or thread id in a pasted id or link; a message link points at its channel. */
export function channelIdOf(input: string): string {
  const text = input.trim();
  if (SNOWFLAKE.test(text)) return text;
  const link = CHANNEL_LINK.exec(text);
  if (link) return link[1];
  throw new ChannelInputError('Paste a Discord channel id or a discord.com/channels/... link');
}

export const isChannelKind = (value: string): value is ChannelKind => (CHANNEL_KINDS as readonly string[]).includes(value);

export interface ChannelStore {
  list(): Promise<Channel[]>;
  save(channel: Channel): Promise<void>;
  remove(id: string): Promise<void>;
}

export function prismaChannelStore(db: PrismaClient): ChannelStore {
  return {
    list: async () => (await db.discordChannel.findMany({ orderBy: { addedAt: 'asc' } })).map((row) => ({ id: row.id, name: row.name, kind: row.kind as ChannelKind, thread: row.thread, enabled: row.enabled })),
    save: async (channel) => {
      const data = { name: channel.name, kind: channel.kind, thread: channel.thread, enabled: channel.enabled };
      await db.discordChannel.upsert({ where: { id: channel.id }, create: { id: channel.id, ...data, addedAt: new Date() }, update: data });
    },
    remove: async (id) => { await db.discordChannel.deleteMany({ where: { id } }); },
  };
}

export const channelStore = prismaChannelStore(prisma);
