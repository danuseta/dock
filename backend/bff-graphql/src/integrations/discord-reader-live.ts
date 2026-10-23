import { StorageService } from '../storage/service';
import { DiscordReader } from './discord-reader';
import type { SyncStatus } from './discord-threads';
import { channelStore, threadService } from './discord-threads';

const storage = new StorageService();
const API = 'https://discord.com/api/v10';
const CACHE = 'discord';
const EMPTY: SyncStatus = { syncedAt: null, error: null, requests: 0 };

/** The reader wired to Discord, the settings and the thread store. */
export const discordReader = new DiscordReader({
  now: () => new Date(),
  setting: async (key) => (await storage.getSettings()).find((setting) => setting.key === key)?.value || null,
  ownerId: async () => (await storage.getSettings()).find((setting) => setting.key === 'discordUserId')?.value || '',
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
  status: async () => ((await storage.getCache(CACHE, 'status')) as SyncStatus | null) ?? EMPTY,
  saveStatus: async (status) => { await storage.upsertCache(CACHE, 'status', status, 0); },
});
