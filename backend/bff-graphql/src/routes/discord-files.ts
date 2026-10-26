import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Router, type Request, type Response } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import { StorageService } from '../storage/service';

export interface DiscordFilesRouterOptions {
  fetchFile?: (url: string) => Promise<globalThis.Response>;
  authorize?: (request: Request) => Promise<boolean>;
}

const HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const MAX_BYTES = 50 * 1024 * 1024;
/** Text is always served as plain text, so a file that holds HTML or script is shown, never run. */
const TEXT = /^(text\/|application\/json)/;
const SHOWN = /^(application\/pdf|image\/(png|jpeg|gif|webp)|video\/(mp4|webm))$/;

const refuse = (response: Response, status: number, message: string) => {
  if (!response.headersSent) response.status(status).json({ error: message });
};

/** A Discord attachment link, or null when it points anywhere else. */
export function attachmentUrl(input: unknown): URL | null {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && HOSTS.has(url.hostname) && url.pathname.startsWith('/attachments/') ? url : null;
  } catch {
    return null;
  }
}

/** The type DOCK serves a Discord file as, or null for a type it does not open. */
export function servedType(type: string | null): string | null {
  const base = (type ?? '').split(';')[0].trim().toLowerCase();
  if (TEXT.test(base)) return 'text/plain; charset=utf-8';
  return SHOWN.test(base) ? base : null;
}

/** Read-only: one file of a Discord thread, fetched by DOCK so the page can show text and open a PDF. Behind the PIN. */
export function createDiscordFilesRouter(options: DiscordFilesRouterOptions = {}): Router {
  const fetchFile = options.fetchFile ?? ((url: string) => fetch(url, { redirect: 'error' }));
  const storage = options.authorize ? null : new StorageService();
  const authorize = options.authorize ?? (async (request: Request) => (
    !shouldRequirePin(request, await (storage as StorageService).hasMasterPin()) || sessionManager.isAuthenticated(request)
  ));
  const router = Router();

  router.get('/file', async (request, response) => {
    try {
      if (!await authorize(request)) return refuse(response, 401, 'Unlock DOCK to continue');
      const url = attachmentUrl(request.query.url);
      if (!url) return refuse(response, 400, 'Only a Discord attachment link can be opened');
      const upstream = await fetchFile(url.toString());
      if (!upstream.ok || !upstream.body) return refuse(response, upstream.status === 404 ? 404 : 502, 'Discord did not send the file; the link may have expired, refresh the thread');
      const type = servedType(upstream.headers.get('content-type'));
      if (!type) return refuse(response, 415, 'This type of file is not opened in DOCK; use Download in Discord');
      const size = Number(upstream.headers.get('content-length'));
      if (size > MAX_BYTES) return refuse(response, 413, 'The file is larger than 50 MB');
      const name = typeof request.query.name === 'string' && request.query.name ? request.query.name : decodeURIComponent(url.pathname.split('/').pop() ?? 'file');
      response.status(200).set({
        'content-type': type,
        ...(size > 0 ? { 'content-length': String(size) } : {}),
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'content-disposition': `${request.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      });
      await pipeline(Readable.fromWeb(upstream.body as WebReadableStream), response);
    } catch {
      refuse(response, 502, 'The file could not be read from Discord');
    }
  });

  router.use((_request, response) => refuse(response, 405, 'Only GET /file is served here'));
  return router;
}
