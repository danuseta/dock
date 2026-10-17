import { Router, type Request, type Response } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import { demoVideos, type DemoVideos } from '../integrations/demo-videos';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { StorageService } from '../storage/service';

export interface DemoVideoRouterOptions {
  videos?: DemoVideos;
  authorize?: (request: Request) => Promise<boolean>;
}

/** An upload, streamed to the bucket as it arrives. Shared by the browser route and the machine-token route. */
export async function receiveDemoVideo(videos: DemoVideos, key: unknown, request: Request, response: Response) {
  const declared = Number(request.get('content-length'));
  try {
    const video = await videos.upload(String(key ?? ''), request, request.get('content-type') ?? '', Number.isFinite(declared) ? declared : null);
    response.status(200).json({ ok: true, result: video });
  } catch (error) {
    if (error instanceof OrchestratorInputError) {
      response.status(400).set('connection', 'close').json({ error: error.message });
      return;
    }
    if (request.destroyed || request.aborted) return;
    console.error('[DemoVideos] upload failed:', error instanceof Error ? error.message : 'unknown error');
    response.status(502).set('connection', 'close').json({ error: 'The bucket refused the upload' });
  }
}

/** POST /api/demo-videos/:key with the MP4 as the body, from the Demo Video page. */
export function createDemoVideoRouter(options: DemoVideoRouterOptions = {}): Router {
  const videos = options.videos ?? demoVideos;
  const storage = options.authorize ? null : new StorageService();
  const authorize = options.authorize ?? (async (request: Request) => (
    !shouldRequirePin(request, await (storage as StorageService).hasMasterPin()) || sessionManager.isAuthenticated(request)
  ));
  const router = Router();
  router.post('/:key', async (request, response) => {
    if (!await authorize(request)) {
      response.status(401).set('connection', 'close').json({ error: 'Unlock DOCK to continue' });
      return;
    }
    if (request.get('x-dock-upload') !== '1') {
      response.status(403).set('connection', 'close').json({ error: 'Upload header missing' });
      return;
    }
    await receiveDemoVideo(videos, request.params.key, request, response);
  });
  return router;
}
