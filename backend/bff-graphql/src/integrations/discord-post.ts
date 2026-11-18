import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';

/** Images from one evidence folder, by file name only. */
export interface DiscordPostFiles { root: string; names: string[] }
export interface DiscordPostOptions { threadId: string; username?: string; files?: DiscordPostFiles }
export interface DiscordPostResult { id: string; skipped: string[] }

/** The HTTP calls a webhook post makes; axios in DOCK, a stub in tests. */
export interface DiscordPostHttp {
  post(url: string, body: unknown, config?: { timeout?: number }): Promise<{ data?: { id?: string } }>;
  patch(url: string, body: unknown, config?: { timeout?: number }): Promise<unknown>;
  delete(url: string, config?: { timeout?: number }): Promise<unknown>;
}

const TIMEOUT_MS = 15_000;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_NAME = /^[\w.-]{1,100}\.(png|jpe?g|webp|gif)$/i;
/** Discord's SUPPRESS_EMBEDS: a link in a DOCK post never unfolds into a preview. */
const SUPPRESS_EMBEDS = 4;

/** The webhook link with `thread_id`, and `wait=true` when posting so Discord answers with the message. */
export function webhookTarget(webhookUrl: string, threadId: string, messageId?: string, wait = false): string {
  const url = new URL(messageId ? `${webhookUrl.replace(/\/+$/, '')}/messages/${encodeURIComponent(messageId)}` : webhookUrl);
  if (wait) url.searchParams.set('wait', 'true');
  url.searchParams.set('thread_id', threadId);
  return url.toString();
}

/** The thread id at the end of a `https://discord.com/channels/<guild>/<thread>` link. */
export const threadIdOf = (threadUrl: string) => /\/channels\/[^/]+\/(\d+)/.exec(threadUrl)?.[1] ?? null;

/** The images that may go up: a plain image name, a real file inside the folder after links are followed, 8 MB at most, ten at most. */
export async function postableFiles(files: DiscordPostFiles | undefined): Promise<{ files: Array<{ name: string; data: Buffer }>; skipped: string[] }> {
  const kept: Array<{ name: string; data: Buffer }> = [];
  const skipped: string[] = [];
  if (!files) return { files: kept, skipped };
  const root = await realpath(files.root).catch(() => null);
  for (const name of files.names) {
    if (!root || kept.length >= MAX_FILES || !IMAGE_NAME.test(name)) {
      skipped.push(name);
      continue;
    }
    const real = await realpath(path.join(root, name)).catch(() => null);
    const inside = real ? path.relative(root, real) : '';
    const info = real && inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? await stat(real).catch(() => null) : null;
    if (!real || !info?.isFile() || info.size > MAX_FILE_BYTES) {
      skipped.push(name);
      continue;
    }
    kept.push({ name, data: await readFile(real) });
  }
  return { files: kept, skipped };
}

/** Posts, edits and deletes messages in a thread through the owner's webhook, so they carry the owner's name. */
export class DiscordPoster {
  constructor(private readonly http: DiscordPostHttp = axios) {}

  /** Posts one message and returns its id, with the image names that were left out. */
  async post(webhookUrl: string, content: string, options: DiscordPostOptions): Promise<DiscordPostResult> {
    const { files, skipped } = await postableFiles(options.files);
    const payload: Record<string, unknown> = { content, allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS };
    if (options.username?.trim()) payload.username = options.username.trim().slice(0, 80);
    const target = webhookTarget(webhookUrl, options.threadId, undefined, true);
    let body: unknown = payload;
    if (files.length) {
      payload.attachments = files.map((file, index) => ({ id: index, filename: file.name }));
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      for (const [index, file] of files.entries()) form.append(`files[${index}]`, new Blob([new Uint8Array(file.data)]), file.name);
      body = form;
    }
    const response = await this.http.post(target, body, { timeout: TIMEOUT_MS });
    const id = response.data?.id;
    if (!id) throw new Error('Discord did not return the message');
    return { id: String(id), skipped };
  }

  async edit(webhookUrl: string, messageId: string, content: string, threadId: string): Promise<void> {
    await this.http.patch(webhookTarget(webhookUrl, threadId, messageId), { content, allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS }, { timeout: TIMEOUT_MS });
  }

  async remove(webhookUrl: string, messageId: string, threadId: string): Promise<void> {
    await this.http.delete(webhookTarget(webhookUrl, threadId, messageId), { timeout: TIMEOUT_MS });
  }
}
