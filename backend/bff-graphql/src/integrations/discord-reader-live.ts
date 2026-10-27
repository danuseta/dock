import { StorageService } from '../storage/service';
import WebSocket from 'ws';
import { DiscordGateway } from './discord-gateway';
import { DiscordReader } from './discord-reader';
import type { SyncStatus } from './discord-threads';
import { channelStore, threadService } from './discord-threads';
import { eventPush } from './push';
import { discordPostNotice } from './push-notices';
import { workspaceDiscordSetting } from './discord-team';

const storage = new StorageService();
const API = 'https://discord.com/api/v10';
const CACHE = 'discord';
const EMPTY: SyncStatus = { syncedAt: null, error: null, requests: 0 };

/** The reader wired to Discord, the settings and the thread store. */
export const discordReader = new DiscordReader({
  now: () => new Date(),
  // A setting left empty falls back to what the workspace brings: the template's bot token, the team file's server.
  setting: async (key) => (await storage.getSettings()).find((setting) => setting.key === key)?.value || workspaceDiscordSetting(key),
  ownerId: async () => (await storage.getSettingValues(['discordUserId']))[0]?.value || '',
  request: async (path, token, body) => {
    const response = await fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bot ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  channels: () => channelStore.list(),
  saveChannel: (channel) => channelStore.save(channel),
  stored: () => threadService.stored(),
  save: (rows) => threadService.save(rows),
  saveOne: (row) => threadService.saveOne(row),
  removeOne: (id) => threadService.removeOne(id),
  status: async () => ((await storage.getCache(CACHE, 'status')) as SyncStatus | null) ?? EMPTY,
  saveStatus: async (status) => { await storage.upsertCache(CACHE, 'status', status, 0); },
  posted: (post) => { void eventPush.send('discordPost', discordPostNotice(post)).catch(() => undefined); },
});

/** The bot's Gateway connection; a new session reads everything once, since events may have been missed. */
export const discordGateway = new DiscordGateway({
  connect: (url, onMessage, onClose) => {
    const socket = new WebSocket(url);
    socket.on('message', (data) => onMessage(data.toString()));
    socket.on('close', (code) => onClose(code));
    // An error is followed by close, which reconnects.
    socket.on('error', (error) => console.warn('[Discord] Gateway error:', error.message));
    return { send: (data) => { if (socket.readyState === WebSocket.OPEN) socket.send(data); }, close: (code) => socket.close(code) };
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  onEvent: (type, data) => { void discordReader.onEvent(type, data); },
  onReady: (resumed) => { if (!resumed) void discordReader.sync(); },
});
