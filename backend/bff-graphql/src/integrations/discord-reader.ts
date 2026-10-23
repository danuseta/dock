import { channelIdOf, type Channel, type ChannelKind, type SyncStatus, type ThreadClaim, type ThreadMessage, type ThreadRow, type ThreadState } from './discord-threads';

/**
 * Reads the channels the owner follows with the DOCK bot token and sorts each thread the way the board-threads branch
 * of shovian/dock does. In a bug or UAT channel every thread counts; in a PR review channel only the owner's own
 * threads and the ones that ask the owner; in a followed channel only what mentions or involves the owner, and a
 * followed thread always. "on it" marks who took a thread.
 */

export const ON_IT = /\bon\s?it\b/i;
export const NEEDS_YOU = new Set<ThreadState>(['FLOW_1', 'FLOW_2', 'FLOW_3', 'FLOW_4', 'YOUR_TURN', 'FLOW_5', 'REVIEW_ASKED']);
export const SETTING_KEYS = { token: 'discordBotToken', guild: 'discordGuildId' } as const;
/** Bumped when ThreadRow gains a field, so the next sync builds every stored row again. */
export const ROW_VERSION = 2;
/** Discord channel types that are threads. */
const THREAD_TYPES = new Set([10, 11, 12]);

const ARCHIVED_DAYS = 14;
const KEPT_MESSAGES = 10;
const MAX_TEXT = 2000;
const MAX_TRIES = 3;
const DAY_MS = 24 * 3600 * 1000;
const DISCORD_EPOCH = 1420070400000;
const TICKET = /\b[A-Z][A-Z0-9_]{1,31}-[1-9]\d{0,9}\b/g;
const PULL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const USER_MENTION = /<@!?(\d+)>/g;
const ROLE_MENTION = /<@&(\d+)>/g;
const CHANNEL_MENTION = /<#(\d+)>/g;
const CDN = 'https://cdn.discordapp.com';
/** Signed CDN links Discord refreshes in one call at most. */
const REFRESH_BATCH = 50;
/** A link is refreshed this long before it expires. */
const EXPIRY_MARGIN_MS = 3600 * 1000;

export interface RawUser { id: string; username: string; global_name?: string | null; avatar?: string | null }
export interface RawMessage {
  id: string;
  content: string;
  timestamp: string;
  author: RawUser;
  mentions: RawUser[];
  mention_roles?: string[];
  attachments: Array<{ filename: string; size: number; content_type?: string | null; url: string; width?: number | null; height?: number | null }>;
}
export interface RawThread {
  id: string;
  type?: number;
  guild_id?: string;
  parent_id: string;
  name: string;
  owner_id?: string;
  last_message_id?: string | null;
  message_count?: number;
  applied_tags?: string[];
  thread_metadata?: { archived?: boolean; locked?: boolean; archive_timestamp?: string; create_timestamp?: string };
}
export interface DiscordResponse { status: number; body: unknown }
/** Role and channel names of the server, for the mentions in a message. */
export interface ServerNames { roles: Map<string, string>; channels: Map<string, string> }
const NO_NAMES: ServerNames = { roles: new Map(), channels: new Map() };

export class DiscordReaderError extends Error {}

const nameOf = (user: RawUser) => user.global_name || user.username;
/** The user's avatar, or the default Discord gives an account without one. */
export const avatarOf = (user: RawUser) => (user.avatar
  ? `${CDN}/avatars/${user.id}/${user.avatar}.png?size=64`
  : `${CDN}/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`);
const createdAtOf = (thread: RawThread) => thread.thread_metadata?.create_timestamp ?? new Date(Number(BigInt(thread.id) >> 22n) + DISCORD_EPOCH).toISOString();
const closed = (thread: RawThread) => Boolean(thread.thread_metadata?.archived || thread.thread_metadata?.locked);
const matches = (text: string, pattern: RegExp) => [...new Set(text.match(pattern) ?? [])];

/** One message with its mentions written as names; a role or channel the server does not list keeps its token. */
export function toMessage(raw: RawMessage, me: string, server: ServerNames = NO_NAMES): ThreadMessage {
  const names = new Map(raw.mentions.map((user) => [user.id, nameOf(user)]));
  const roles = (raw.mention_roles ?? []).filter((id) => server.roles.has(id));
  return {
    id: raw.id,
    authorId: raw.author.id,
    author: nameOf(raw.author),
    avatar: avatarOf(raw.author),
    mine: raw.author.id === me,
    at: new Date(raw.timestamp).toISOString(),
    text: raw.content
      .replace(USER_MENTION, (token, id: string) => (names.has(id) ? `@${names.get(id)}` : token))
      .replace(ROLE_MENTION, (token, id: string) => (server.roles.has(id) ? `@${server.roles.get(id)}` : token))
      .replace(CHANNEL_MENTION, (token, id: string) => (server.channels.has(id) ? `#${server.channels.get(id)}` : token))
      .slice(0, MAX_TEXT),
    mentions: [
      ...raw.mentions.map((user) => ({ id: user.id, name: nameOf(user), me: user.id === me, role: false })),
      ...roles.map((id) => ({ id, name: server.roles.get(id) as string, me: false, role: true })),
    ],
    attachments: raw.attachments.map((file) => ({ name: file.filename, size: file.size, type: file.content_type ?? null, url: file.url, width: file.width ?? null, height: file.height ?? null })),
  };
}

/** When a signed CDN link stops working: its `ex` parameter, seconds in hex. NaN for a link without one. */
export const expiresAt = (url: string) => parseInt(new URL(url).searchParams.get('ex') ?? '', 16) * 1000;

export interface Sorted { state: ThreadState; why: string; claim: ThreadClaim | null; claimerRepliedAt: string | null; mentionedAt: string | null; repliedAt: string | null }

/** Where a thread stands for the owner. `messages` are oldest first. */
export function sortThread(kind: ChannelKind, followed: boolean, threadOwnerId: string | null, isClosed: boolean, messages: ThreadMessage[], me: string): Sorted {
  const last = <T>(items: T[]) => items[items.length - 1];
  const mine = last(messages.filter((message) => message.mine));
  const mention = last(messages.filter((message) => !message.mine && message.mentions.some((user) => user.me)));
  const claimMessage = last(messages.filter((message) => ON_IT.test(message.text)));
  const claim = claimMessage ? { messageId: claimMessage.id, authorId: claimMessage.authorId, author: claimMessage.author, mine: claimMessage.mine, at: claimMessage.at } : null;
  const claimerReply = claimMessage ? messages.find((message) => message.at > claimMessage.at && message.authorId === claimMessage.authorId) : undefined;
  const othersAfterMine = mine ? last(messages.filter((message) => !message.mine && message.at > mine.at)) : undefined;
  const unanswered = mention && (!mine || mention.at > mine.at) ? mention : undefined;
  const base = { claim, claimerRepliedAt: claimerReply?.at ?? null, mentionedAt: mention?.at ?? null, repliedAt: mine?.at ?? null };
  const result = (state: ThreadState, why: string): Sorted => ({ state, why, ...base });

  if (isClosed) return result('CLOSED', 'Archived in Discord');
  if (kind === 'follow') {
    if (unanswered) return result('YOUR_TURN', `${unanswered.author} mentioned you`);
    if (claim?.mine) return result('YOURS_IN_PROGRESS', 'You said on it');
    if (mine) return result('WAITING_ON_REPORTER', 'You replied last');
    return followed ? result('FOLLOWING', 'You follow this thread') : result('NOT_YOURS', 'Not about you');
  }
  if (kind === 'pr') {
    const lastMessage = last(messages);
    if (threadOwnerId === me) {
      return lastMessage && !lastMessage.mine ? result('FLOW_5', `${lastMessage.author} commented on your pull request`) : result('WAITING_ON_REPORTER', 'You wrote last; waiting for reviewers');
    }
    if (unanswered) return result('REVIEW_ASKED', `${unanswered.author} asked you`);
    if (claim?.mine) return result('YOURS_IN_PROGRESS', 'You said on it');
    if (mine) return result('WAITING_ON_REPORTER', 'You replied last');
    return result('NOT_YOURS', 'Not about you');
  }
  const uat = kind === 'uat';
  if (unanswered) return mine ? result('YOUR_TURN', `${unanswered.author} mentioned you after your last reply`) : result(uat ? 'FLOW_4' : 'FLOW_2', `${unanswered.author} mentioned you`);
  if (claim && !claim.mine) return result('TAKEN', `${claim.author} said on it`);
  if (claim?.mine) return othersAfterMine ? result('YOUR_TURN', `${othersAfterMine.author} wrote after your last reply`) : result('YOURS_IN_PROGRESS', 'You said on it');
  if (mine) return othersAfterMine ? result('YOUR_TURN', `${othersAfterMine.author} wrote after your last reply`) : result('WAITING_ON_REPORTER', 'You replied last');
  return result(uat ? 'FLOW_3' : 'FLOW_1', uat ? 'New UAT bug; nobody said on it' : 'New bug; nobody said on it');
}

/** One thread as a row; `channel` is the followed channel it belongs to, or the followed thread itself. */
export function buildRow(channel: Channel, guildId: string, thread: RawThread, tagNames: Map<string, string>, raw: RawMessage[], me: string, server: ServerNames = NO_NAMES): ThreadRow {
  const messages = [...raw].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map((message) => toMessage(message, me, server));
  const sorted = sortThread(channel.kind, channel.thread, thread.owner_id ?? null, closed(thread), messages, me);
  const tags = (thread.applied_tags ?? []).map((id) => tagNames.get(id)).filter((name): name is string => Boolean(name));
  const createdBy = messages.find((message) => message.authorId === thread.owner_id)?.author ?? null;
  const lastActivity = messages.length ? messages[messages.length - 1].at : createdAtOf(thread);
  return {
    version: ROW_VERSION,
    id: thread.id,
    channelId: channel.id,
    channel: channel.thread ? thread.name : channel.name ?? channel.id,
    kind: channel.kind,
    title: thread.name,
    url: `https://discord.com/channels/${guildId}/${thread.id}`,
    ...sorted,
    needsYou: NEEDS_YOU.has(sorted.state),
    createdBy,
    createdAt: createdAtOf(thread),
    lastActivity,
    lastMessageId: thread.last_message_id ?? null,
    messageCount: thread.message_count ?? messages.length,
    tags,
    tickets: matches([thread.name, ...tags].join(' ').toUpperCase(), TICKET),
    prs: matches(messages.map((message) => message.text).join(' '), PULL),
    messages: messages.slice(-KEPT_MESSAGES),
  };
}

export interface ReaderDeps {
  now(): Date;
  setting(key: string): Promise<string | null>;
  /** The owner's Discord user id, kept in Settings > Discord. */
  ownerId(): Promise<string>;
  /** A GET, or a POST of `body` when one is given. */
  request(path: string, token: string, body?: unknown): Promise<DiscordResponse>;
  sleep(ms: number): Promise<void>;
  channels(): Promise<Channel[]>;
  saveChannel(channel: Channel): Promise<void>;
  stored(): Promise<Map<string, ThreadRow>>;
  save(rows: ThreadRow[]): Promise<unknown>;
  status(): Promise<SyncStatus>;
  saveStatus(status: SyncStatus): Promise<void>;
}

interface Config { token: string; guild: string }
interface RawChannel extends RawThread { available_tags?: Array<{ id: string; name: string }> }

export class DiscordReader {
  private running: Promise<SyncStatus> | null = null;
  private requests = 0;
  /** Refreshed attachment links by the link stored in the row. */
  private readonly fresh = new Map<string, string>();

  constructor(private readonly deps: ReaderDeps) {}

  /** The token and the server id, or null when one is missing. */
  async config(): Promise<Config | null> {
    const [token, guild] = await Promise.all([this.deps.setting(SETTING_KEYS.token), this.deps.setting(SETTING_KEYS.guild)]);
    return token && guild ? { token, guild } : null;
  }

  status(): Promise<SyncStatus> {
    return this.deps.status();
  }

  private async get<T>(path: string, token: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.deps.request(path, token, body);
      this.requests += 1;
      if (response.status === 429 && attempt < MAX_TRIES) {
        const wait = Number((response.body as { retry_after?: number } | null)?.retry_after ?? 1);
        await this.deps.sleep(Math.ceil(wait * 1000));
        continue;
      }
      if (response.status === 401) throw new DiscordReaderError('Discord refused the bot token');
      if (response.status === 403) throw new DiscordReaderError(`The bot cannot read ${path.split('?')[0]}`);
      if (response.status === 404) throw new DiscordReaderError(`Discord has no ${path.split('?')[0]}`);
      if (response.status < 200 || response.status >= 300) throw new DiscordReaderError(`Discord answered ${response.status} for ${path.split('?')[0]}`);
      return response.body as T;
    }
  }

  /** Keeps the name and the kind of channel Discord reports, so the page shows #name instead of an id. */
  private async remember(channel: Channel, found: RawChannel): Promise<Channel> {
    const thread = THREAD_TYPES.has(found.type ?? -1);
    const next = { ...channel, name: found.name, thread };
    if (channel.name !== next.name || channel.thread !== thread) await this.deps.saveChannel(next);
    return next;
  }

  /**
   * Follows a channel or a thread from a pasted id or link. With the bot set up, Discord is asked for its name and
   * whether it is a thread; without it, the next sync fills them in.
   */
  async addChannel(input: string, kind: ChannelKind): Promise<Channel> {
    const id = channelIdOf(input);
    const config = await this.config();
    let channel: Channel = { id, name: null, kind, thread: false, enabled: true };
    if (config) {
      const found = await this.get<RawChannel>(`/channels/${id}`, config.token);
      if (found.guild_id && found.guild_id !== config.guild) throw new DiscordReaderError('That channel is on another Discord server');
      channel = { ...channel, name: found.name, thread: THREAD_TYPES.has(found.type ?? -1) };
    }
    await this.deps.saveChannel(channel);
    return channel;
  }

  /** One sync; a second call while one runs waits for it. */
  sync(): Promise<SyncStatus> {
    this.running ??= this.syncOnce().finally(() => { this.running = null; });
    return this.running;
  }

  private async syncOnce(): Promise<SyncStatus> {
    this.requests = 0;
    const previous = await this.deps.status();
    try {
      const config = await this.config();
      if (!config) throw new DiscordReaderError('Discord reader is not set up');
      const me = await this.deps.ownerId();
      if (!me) throw new DiscordReaderError('Set your Discord user id in Settings > Discord');
      const now = this.deps.now();
      const tagNames = new Map<string, string>();
      const containers = new Map<string, Channel>();
      const threads = new Map<string, { thread: RawThread; channel: Channel }>();
      for (const entry of (await this.deps.channels()).filter((channel) => channel.enabled)) {
        const found = await this.get<RawChannel>(`/channels/${entry.id}`, config.token);
        const channel = await this.remember(entry, found);
        if (channel.thread) threads.set(found.id, { thread: found, channel });
        else containers.set(channel.id, channel);
        for (const tag of found.available_tags ?? []) tagNames.set(tag.id, tag.name);
      }
      if (containers.size) {
        const active = await this.get<{ threads: RawThread[] }>(`/guilds/${config.guild}/threads/active`, config.token);
        for (const thread of active.threads) {
          const channel = containers.get(thread.parent_id);
          if (channel && !threads.has(thread.id)) threads.set(thread.id, { thread, channel });
        }
      }
      const since = now.getTime() - ARCHIVED_DAYS * DAY_MS;
      for (const channel of containers.values()) {
        const archived = await this.get<{ threads: RawThread[] }>(`/channels/${channel.id}/threads/archived/public?limit=50`, config.token);
        for (const thread of archived.threads) {
          if (!threads.has(thread.id) && Date.parse(thread.thread_metadata?.archive_timestamp ?? '') >= since) threads.set(thread.id, { thread, channel });
        }
      }
      const stored = await this.deps.stored();
      const rows: ThreadRow[] = [];
      let server: ServerNames | null = null;
      for (const { thread, channel } of threads.values()) {
        const kept = stored.get(thread.id);
        const unchanged = kept && kept.version === ROW_VERSION && kept.kind === channel.kind && kept.lastMessageId === (thread.last_message_id ?? null) && (kept.state === 'CLOSED') === closed(thread);
        if (!unchanged) server ??= await this.serverNames(config);
        const row = unchanged ? kept : buildRow(channel, config.guild, thread, tagNames, await this.get<RawMessage[]>(`/channels/${thread.id}/messages?limit=50`, config.token), me, server ?? NO_NAMES);
        if (row.state !== 'NOT_YOURS') rows.push(row);
      }
      await this.deps.save(rows);
      const status = { syncedAt: now.toISOString(), error: null, requests: this.requests };
      await this.deps.saveStatus(status);
      return status;
    } catch (error) {
      const status = { syncedAt: previous.syncedAt, error: error instanceof Error ? error.message : 'Discord sync failed', requests: this.requests };
      await this.deps.saveStatus(status);
      return status;
    }
  }

  /** The server's role and channel names; read only when a thread is built again. */
  private async serverNames(config: Config): Promise<ServerNames> {
    const roles = await this.get<Array<{ id: string; name: string }>>(`/guilds/${config.guild}/roles`, config.token);
    const channels = await this.get<Array<{ id: string; name: string }>>(`/guilds/${config.guild}/channels`, config.token);
    return { roles: new Map(roles.map((role) => [role.id, role.name])), channels: new Map(channels.map((channel) => [channel.id, channel.name])) };
  }

  /**
   * The rows with attachment links that still work. A stored link expires about a day after the sync that read it, so
   * the ones expiring within the hour are refreshed, 50 per call, and remembered until the new link expires.
   * When Discord refuses, the rows keep the old links and the page shows the file name.
   */
  async freshen<T extends ThreadRow>(rows: T[]): Promise<T[]> {
    const soon = this.deps.now().getTime() + EXPIRY_MARGIN_MS;
    const usable = (url: string) => !(expiresAt(url) < soon);
    for (const [old, url] of this.fresh) if (!usable(url)) this.fresh.delete(old);
    const stale = [...new Set(rows.flatMap((row) => row.messages.flatMap((message) => message.attachments.map((file) => file.url))))]
      .filter((url) => !usable(url) && !this.fresh.has(url));
    const config = stale.length ? await this.config() : null;
    if (config) {
      try {
        for (let start = 0; start < stale.length; start += REFRESH_BATCH) {
          const answer = await this.get<{ refreshed_urls: Array<{ original: string; refreshed: string }> }>('/attachments/refresh-urls', config.token, { attachment_urls: stale.slice(start, start + REFRESH_BATCH) });
          for (const pair of answer.refreshed_urls) this.fresh.set(pair.original, pair.refreshed);
        }
      } catch {
        // The links stay as they are; an expired one shows as a file name.
      }
    }
    if (!this.fresh.size) return rows;
    const link = (url: string) => this.fresh.get(url) ?? url;
    return rows.map((row) => ({ ...row, messages: row.messages.map((message) => ({ ...message, attachments: message.attachments.map((file) => ({ ...file, url: link(file.url) })) })) }));
  }

  /** Checks the token and every followed channel; the message names what Discord answered. */
  async test(): Promise<{ success: boolean; message: string }> {
    const config = await this.config();
    if (!config) return { success: false, message: 'Fill in the bot token and the server id' };
    try {
      const bot = await this.get<RawUser>('/users/@me', config.token);
      const names: string[] = [];
      for (const channel of await this.deps.channels()) names.push(`#${(await this.get<RawChannel>(`/channels/${channel.id}`, config.token)).name}`);
      return { success: true, message: names.length ? `${nameOf(bot)} reads ${names.join(', ')}` : `${nameOf(bot)} is ready; add channels on the Discord page` };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Discord test failed' };
    }
  }
}
