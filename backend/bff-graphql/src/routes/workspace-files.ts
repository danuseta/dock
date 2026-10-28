import express, { Router, type Request } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import { MAX_WRITE_BYTES, WorkspaceFilesError, workspaceFiles, type WorkspaceFiles } from '../integrations/workspace-files';
import { StorageService } from '../storage/service';

export interface WorkspaceFilesRouterOptions {
  files?: WorkspaceFiles;
  authorize?: (request: Request) => Promise<boolean>;
}

/** PUT /api/workspace/file?path=…, the file's bytes as the body: a new file, an upload, or with replace=1 a save from the editor. */
export function createWorkspaceFilesRouter(options: WorkspaceFilesRouterOptions = {}): Router {
  const files = options.files ?? workspaceFiles;
  const storage = options.authorize ? null : new StorageService();
  const authorize = options.authorize ?? (async (request: Request) => (
    !shouldRequirePin(request, await (storage as StorageService).hasMasterPin()) || sessionManager.isAuthenticated(request)
  ));
  const router = Router();
  router.put('/file', async (request, response, next) => {
    if (!await authorize(request)) {
      response.status(401).set('connection', 'close').json({ error: 'Unlock DOCK to continue' });
      return;
    }
    if (request.get('x-dock-upload') !== '1') {
      response.status(403).set('connection', 'close').json({ error: 'Upload header missing' });
      return;
    }
    next();
  }, express.raw({ type: () => true, limit: MAX_WRITE_BYTES }), async (request, response) => {
    const query = request.query as Record<string, string | undefined>;
    try {
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const entry = await files.write(String(query.path ?? ''), body, { replace: query.replace === '1', expected: query.expected ?? null });
      response.status(200).json({ ok: true, entry });
    } catch (error) {
      if (error instanceof WorkspaceFilesError) {
        response.status(400).json({ error: error.message });
        return;
      }
      console.error('[WorkspaceFiles] write failed:', error instanceof Error ? error.message : 'unknown error');
      response.status(500).json({ error: 'The file could not be written' });
    }
  });
  router.use(((error, _request, response, _next) => {
    const tooLarge = (error as { type?: string })?.type === 'entity.too.large';
    response.status(tooLarge ? 413 : 400).set('connection', 'close').json({ error: tooLarge ? `A file can be at most ${MAX_WRITE_BYTES / 1024 / 1024} MB` : 'The upload could not be read' });
  }) as express.ErrorRequestHandler);
  return router;
}
