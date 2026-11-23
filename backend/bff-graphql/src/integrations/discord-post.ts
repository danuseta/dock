import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';

/** Images from one evidence folder, by file name only. */
export interface DiscordPostFiles { root: string; names: string[] }
/** `users`: the only user ids the post may ping; none pings nobody. */
export interface DiscordPostOptions { threadId: string; username?: string; files?: DiscordPostFiles; users?: string[] }
export interface DiscordPostResult { id: string; skipped: string[] }
/** A message a session wrote for DOCK to post: the body and the image names of its `GAMBAR:` lines. */
export interface DiscordBlock { body: string; images: string[] }

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
const USER_ID = /^\d{5,25}$/;
export const DISCORD_OPEN = '<<<DISCORD';
export const DISCORD_CLOSE = '<<<AKHIR DISCORD>>>';
const IMAGE_LINE = /^\s*GAMBAR:\s*(.+?)\s*$/i;

/** Only the listed users can be pinged, and only real user ids; no list pings nobody. */
const allowedMentions = (users: string[] = []) => {
  const ids = [...new Set(users.filter((id) => USER_ID.test(id)))].slice(0, 100);
  return ids.length ? { parse: [], users: ids } : { parse: [] };
};

/** The last `<<<DISCORD` … `<<<AKHIR DISCORD>>>` block of a session reply, its `GAMBAR:` lines taken out as images; null when there is none or it is empty. */
export function parseDiscordBlock(text: string | null | undefined): DiscordBlock | null {
  const end = text ? text.lastIndexOf(DISCORD_CLOSE) : -1;
  const start = end > 0 ? text!.lastIndexOf(DISCORD_OPEN, end - 1) : -1;
  if (start < 0) return null;
  const lines = text!.slice(start + DISCORD_OPEN.length, end).replace(/^(>>>)?[ \t]*/, '').split(/\r?\n/);
  const images: string[] = [];
  const body: string[] = [];
  for (const line of lines) {
    const image = IMAGE_LINE.exec(line);
    if (!image) body.push(line);
    else if (!images.includes(image[1]) && images.length < MAX_FILES) images.push(image[1]);
  }
  const trimmed = body.join('\n').trim();
  return trimmed ? { body: trimmed, images } : null;
}

/** The webhook link with `thread_id`, and `wait=true` when posting so Discord answers with the message. */
export function webhookTarget(webhookUrl: string, threadId: string, messageId?: string, wait = false): string {
  const url = new URL(messageId ? `${webhookUrl.replace(/\/+$/, '')}/messages/${encodeURIComponent(messageId)}` : webhookUrl);
  if (wait) url.searchParams.set('wait', 'true');
  url.searchParams.set('thread_id', threadId);
  return url.toString();
}

/** The thread id at the end of a `https://discord.com/channels/<guild>/<thread>` link. */
export const threadIdOf = (threadUrl: string) => /\/channels\/[^/]+\/(\d+)/.exec(threadUrl)?.[1] ?? null;

/** A PNG, JPEG, GIF or WebP by its first bytes, whatever its name says. */
export const isImage = (data: Buffer) =>
  data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  || data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  || ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('latin1'))
  || (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP');

/**
 * The images that may go up: a plain image name, a real file inside the folder after links are followed, not hard-linked to a
 * file elsewhere, an image by its bytes, 8 MB at most, ten at most.
 */
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
    if (!real || !info?.isFile() || info.size > MAX_FILE_BYTES || info.nlink > 1) {
      skipped.push(name);
      continue;
    }
    const data = await readFile(real);
    if (!isImage(data)) {
      skipped.push(name);
      continue;
    }
    kept.push({ name, data });
  }
  return { files: kept, skipped };
}

/** Posts, edits and deletes messages in a thread through the owner's webhook, so they carry the owner's name. */
export class DiscordPoster {
  constructor(private readonly http: DiscordPostHttp = axios) {}

  /** Posts one message and returns its id, with the image names that were left out. */
  async post(webhookUrl: string, content: string, options: DiscordPostOptions): Promise<DiscordPostResult> {
    const { files, skipped } = await postableFiles(options.files);
    const payload: Record<string, unknown> = { content, allowed_mentions: allowedMentions(options.users), flags: SUPPRESS_EMBEDS };
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
