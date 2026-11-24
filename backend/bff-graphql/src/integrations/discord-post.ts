import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { stampImage, type ImageStamper, type PostImage } from './image-label';

export type { PostImage } from './image-label';
/** Images from one evidence folder, by file name only, with the number and caption each is labelled with. */
export interface DiscordPostFiles { root: string; images: PostImage[] }
/** `users`: the only user ids the post may ping; none pings nobody. */
export interface DiscordPostOptions { threadId: string; username?: string; files?: DiscordPostFiles; users?: string[] }
/** `skipped`: the image files left out; `unlabelled`: the files sent without the GAMBAR label. */
export interface DiscordPostResult { id: string; skipped: string[]; unlabelled?: string[] }
/** A message a session wrote for DOCK to post: the body and the images of its `GAMBAR` lines, in number order. */
export interface DiscordBlock { body: string; images: PostImage[] }

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
const IMAGE_LINE = /^\s*GAMBAR(?:\s+(\d{1,2}))?\s*:\s*([^\s|]+\.[A-Za-z0-9]{2,5})\s*(?:\|\s*(.*?))?\s*$/i;

/** Only the listed users can be pinged, and only real user ids; no list pings nobody. */
const allowedMentions = (users: string[] = []) => {
  const ids = [...new Set(users.filter((id) => USER_ID.test(id)))].slice(0, 100);
  return ids.length ? { parse: [], users: ids } : { parse: [] };
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Images by their number: a written number is kept unless taken, any other image gets the lowest free one; ten at most, one per file. */
function numberImages(lines: Array<{ n: number | null; file: string; caption: string }>): PostImage[] {
  const kept = lines.filter((line, index) => lines.findIndex((other) => other.file === line.file) === index).slice(0, MAX_FILES);
  const taken = new Set<number>();
  const images: PostImage[] = [];
  for (const line of kept) {
    if (line.n !== null && line.n > 0 && !taken.has(line.n)) {
      taken.add(line.n);
      images.push({ n: line.n, file: line.file, caption: line.caption });
    }
  }
  for (const line of kept) {
    if (images.some((image) => image.file === line.file)) continue;
    let n = 1;
    while (taken.has(n)) n += 1;
    taken.add(n);
    images.push({ n, file: line.file, caption: line.caption });
  }
  return images.sort((a, b) => a.n - b.n);
}

/** A file name left in the text, with or without its extension and a "gambar" before it, read as "gambar N". */
export function replaceImageNames(body: string, images: PostImage[]): string {
  let text = body;
  for (const image of [...images].sort((a, b) => b.file.length - a.file.length)) {
    const stem = image.file.replace(/\.[A-Za-z0-9]+$/, '');
    const names = [escapeRegExp(image.file), ...(stem !== image.file && /[\d_-]/.test(stem) ? [escapeRegExp(stem)] : [])];
    text = text.replace(new RegExp(`(?<![\\w.-])(?:gambar\\s+)?(?:${names.join('|')})(?![\\w-]|\\.\\w)`, 'gi'), `gambar ${image.n}`);
  }
  return text;
}

/** The images saved with a post: `[{ n, file, caption }]`, or the older list of file names numbered in order. */
export function readImageList(json: string | null | undefined): PostImage[] {
  let raw: unknown = null;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const images: PostImage[] = [];
  raw.forEach((item: unknown, index) => {
    const entry = typeof item === 'string' ? { n: index + 1, file: item, caption: '' }
      : item && typeof item === 'object' ? { n: Number((item as PostImage).n), file: String((item as PostImage).file ?? ''), caption: typeof (item as PostImage).caption === 'string' ? (item as PostImage).caption : '' }
        : null;
    if (entry && Number.isInteger(entry.n) && entry.n > 0 && entry.file && !images.some((image) => image.n === entry.n || image.file === entry.file)) images.push(entry);
  });
  return images.sort((a, b) => a.n - b.n);
}

/**
 * The last `<<<DISCORD` … `<<<AKHIR DISCORD>>>` block of a session reply, its `GAMBAR N: <file> | <caption>` lines (or the older
 * `GAMBAR: <file>`) taken out as images and a file name still in the text read as "gambar N"; null when there is none or it is empty.
 */
export function parseDiscordBlock(text: string | null | undefined): DiscordBlock | null {
  const end = text ? text.lastIndexOf(DISCORD_CLOSE) : -1;
  const start = end > 0 ? text!.lastIndexOf(DISCORD_OPEN, end - 1) : -1;
  if (start < 0) return null;
  const lines = text!.slice(start + DISCORD_OPEN.length, end).replace(/^(>>>)?[ \t]*/, '').split(/\r?\n/);
  const found: Array<{ n: number | null; file: string; caption: string }> = [];
  const body: string[] = [];
  for (const line of lines) {
    const image = IMAGE_LINE.exec(line);
    if (!image) body.push(line);
    else found.push({ n: image[1] ? Number(image[1]) : null, file: image[2], caption: image[3]?.trim() ?? '' });
  }
  const images = numberImages(found);
  const trimmed = replaceImageNames(body.join('\n'), images).trim();
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
export async function postableFiles(files: DiscordPostFiles | undefined): Promise<{ files: Array<{ image: PostImage; path: string; data: Buffer }>; skipped: string[] }> {
  const kept: Array<{ image: PostImage; path: string; data: Buffer }> = [];
  const skipped: string[] = [];
  if (!files) return { files: kept, skipped };
  const root = await realpath(files.root).catch(() => null);
  for (const image of [...files.images].sort((a, b) => a.n - b.n)) {
    const name = image.file;
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
    kept.push({ image, path: real, data });
  }
  return { files: kept, skipped };
}

/** Posts, edits and deletes messages in a thread through the owner's webhook, so they carry the owner's name. */
export class DiscordPoster {
  constructor(private readonly http: DiscordPostHttp = axios, private readonly stamp: ImageStamper = stampImage) {}

  /**
   * Posts one message and returns its id, with the image names that were left out and those sent without a label. Each image
   * goes up as `gambar-N` in number order, as a labelled copy made in a temp folder; the original is never changed.
   */
  async post(webhookUrl: string, content: string, options: DiscordPostOptions): Promise<DiscordPostResult> {
    const { files, skipped } = await postableFiles(options.files);
    const dir = files.length ? await mkdtemp(path.join(tmpdir(), 'dock-label-')) : null;
    try {
      const unlabelled: string[] = [];
      const uploads: Array<{ name: string; data: Buffer }> = [];
      for (const file of files) {
        const name = `gambar-${file.image.n}${path.extname(file.image.file).toLowerCase()}`;
        const stamped = dir ? await this.labelled(file, path.join(dir, name)) : null;
        if (!stamped) unlabelled.push(file.image.file);
        uploads.push({ name, data: stamped ?? file.data });
      }
      const payload: Record<string, unknown> = { content, allowed_mentions: allowedMentions(options.users), flags: SUPPRESS_EMBEDS };
      if (options.username?.trim()) payload.username = options.username.trim().slice(0, 80);
      const target = webhookTarget(webhookUrl, options.threadId, undefined, true);
      let body: unknown = payload;
      if (uploads.length) {
        payload.attachments = uploads.map((file, index) => ({ id: index, filename: file.name }));
        const form = new FormData();
        form.append('payload_json', JSON.stringify(payload));
        for (const [index, file] of uploads.entries()) form.append(`files[${index}]`, new Blob([new Uint8Array(file.data)]), file.name);
        body = form;
      }
      const response = await this.http.post(target, body, { timeout: TIMEOUT_MS });
      const id = response.data?.id;
      if (!id) throw new Error('Discord did not return the message');
      return { id: String(id), skipped, unlabelled };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** The labelled copy of one image, or null when stamping failed or gave no image that may go up. */
  private async labelled(file: { image: PostImage; path: string; data: Buffer }, output: string): Promise<Buffer | null> {
    try {
      await this.stamp(file.path, output, file.image, file.data);
      const data = await readFile(output);
      return data.length <= MAX_FILE_BYTES && isImage(data) ? data : null;
    } catch (error) {
      console.warn('[DiscordPoster] image label failed:', error instanceof Error ? error.message.slice(0, 300) : 'unknown error');
      return null;
    }
  }

  async edit(webhookUrl: string, messageId: string, content: string, threadId: string): Promise<void> {
    await this.http.patch(webhookTarget(webhookUrl, threadId, messageId), { content, allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS }, { timeout: TIMEOUT_MS });
  }

  async remove(webhookUrl: string, messageId: string, threadId: string): Promise<void> {
    await this.http.delete(webhookTarget(webhookUrl, threadId, messageId), { timeout: TIMEOUT_MS });
  }
}
