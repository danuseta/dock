import { createReadStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import type { StoryboardReader } from '../integrations/storyboard';
import { storyboardReader } from '../integrations/sprint-draft-live';
import { StorageService } from '../storage/service';

export interface StoryboardRouterOptions {
  reader?: Pick<StoryboardReader, 'file'>;
  authorize?: (request: Request) => Promise<boolean>;
}

// The saved artifact runs its own script in a sandboxed frame; it may not call out or be framed by another site.
export const STORYBOARD_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; connect-src 'none'; frame-ancestors 'self'";

const refuse = (response: Response, status: number, message: string) => {
  if (!response.headersSent) response.status(status).json({ error: message });
};

/** Read-only: one saved storyboard version as HTML, for the Planning board's iframes. Behind the same PIN as the dashboard. */
export function createStoryboardRouter(options: StoryboardRouterOptions = {}): Router {
  const reader = options.reader ?? storyboardReader;
  const storage = options.authorize ? null : new StorageService();
  const authorize = options.authorize ?? (async (request: Request) => (
    !shouldRequirePin(request, await (storage as StorageService).hasMasterPin()) || sessionManager.isAuthenticated(request)
  ));
  const router = Router();

  router.use(async (request, response, next) => {
    try {
      if (request.method !== 'GET') return refuse(response, 405, 'Storyboards are read-only');
      if (!await authorize(request)) return refuse(response, 401, 'Unlock DOCK to continue');
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/:epic/:file', async (request, response) => {
    const file = reader.file(request.params.epic, request.params.file);
    if (!file) return refuse(response, 400, 'Not a storyboard version');
    try {
      const stat = await fs.stat(file);
      response.status(200).set({
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(stat.size),
        'content-security-policy': STORYBOARD_CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=3600',
      });
      await pipeline(createReadStream(file), response);
    } catch {
      refuse(response, 404, 'No such storyboard version');
    }
  });

  return router;
}
