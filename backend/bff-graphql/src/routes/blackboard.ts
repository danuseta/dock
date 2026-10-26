import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import { Blackboard, BlackboardRefusal, blackboard } from '../integrations/blackboard';
import { StorageService } from '../storage/service';

export interface BlackboardRouterOptions {
  board?: Blackboard;
  authorize?: (request: Request) => Promise<boolean>;
}

const refuse = (response: Response, status: number, message: string) => {
  if (!response.headersSent) response.status(status).json({ error: message });
};

/** Read-only: the ticket folders, their files, and one file at a time. Behind the same PIN as the dashboard. */
export function createBlackboardRouter(options: BlackboardRouterOptions = {}): Router {
  const board = options.board ?? blackboard;
  const storage = options.authorize ? null : new StorageService();
  const authorize = options.authorize ?? (async (request: Request) => (
    !shouldRequirePin(request, await (storage as StorageService).hasMasterPin()) || sessionManager.isAuthenticated(request)
  ));
  const router = Router();

  router.use(async (request, response, next) => {
    try {
      if (request.method !== 'GET') return refuse(response, 405, 'The blackboard is read-only');
      if (!await authorize(request)) return refuse(response, 401, 'Unlock DOCK to continue');
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/tickets', async (_request, response) => {
    response.set('cache-control', 'no-store').json({ tickets: await board.tickets() });
  });

  router.get('/:key/files', async (request, response) => {
    const files = await board.files(request.params.key);
    if (!files) return refuse(response, 404, 'No blackboard for this ticket');
    response.set('cache-control', 'no-store').json({ files });
  });

  router.get('/:key/file', async (request, response) => {
    try {
      const opened = await board.open(request.params.key, typeof request.query.path === 'string' ? request.query.path : '');
      response.status(200).set({
        'content-type': opened.mime,
        'content-length': String(opened.size),
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'content-disposition': `${request.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(opened.name)}`,
      });
      await pipeline(createReadStream(opened.file), response);
    } catch (error) {
      if (error instanceof BlackboardRefusal) return refuse(response, error.status, error.message);
      if (!response.headersSent) refuse(response, 500, 'The file could not be read');
    }
  });

  return router;
}
