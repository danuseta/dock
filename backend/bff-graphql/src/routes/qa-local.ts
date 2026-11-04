import { Router, type Request } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import { qaVideoPath } from '../integrations/qa-local-live';
import { StorageService } from '../storage/service';

export interface QaLocalRouterOptions {
  videoPath?: (key: string, runId: string, file: string) => string | null;
  authorize?: (request: Request) => Promise<boolean>;
}

/** GET /api/qa-local/:key/:runId/videos/:file: a test case's video from a local QA run. */
export function createQaLocalRouter(options: QaLocalRouterOptions = {}): Router {
  const videoPath = options.videoPath ?? qaVideoPath;
  const storage = options.authorize ? null : new StorageService();
  const authorize = options.authorize ?? (async (request: Request) => (
    !shouldRequirePin(request, await (storage as StorageService).hasMasterPin()) || sessionManager.isAuthenticated(request)
  ));
  const router = Router();
  router.get('/:key/:runId/videos/:file', async (request, response) => {
    if (!await authorize(request)) {
      response.status(401).json({ error: 'Unlock DOCK to continue' });
      return;
    }
    const file = videoPath(request.params.key, request.params.runId, `videos/${request.params.file}`);
    if (!file) {
      response.status(404).json({ error: 'No such video' });
      return;
    }
    response.type('video/webm').sendFile(file);
  });
  return router;
}
