import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import { AVATAR_MAX_BYTES, AvatarRefusal, agentLooks, type AgentLooks } from '../integrations/agent-looks';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { StorageService } from '../storage/service';

export interface AgentLookRouterOptions {
  looks?: Pick<AgentLooks, 'setAvatar' | 'avatar'>;
  authorize?: (request: Request) => Promise<boolean>;
}

function refuse(response: Response, status: number, message: string) {
  if (response.headersSent) return;
  response.status(status).json({ error: message });
}

/** Agent avatars: a PNG upload per slug and the image behind it, both behind the PIN like chat attachments. */
export function createAgentLookRouter(options: AgentLookRouterOptions = {}): Router {
  const looks = options.looks ?? agentLooks;
  const storage = options.authorize ? null : new StorageService();
  const authorize = options.authorize ?? (async (request: Request) => (
    !shouldRequirePin(request, await (storage as StorageService).hasMasterPin()) || sessionManager.isAuthenticated(request)
  ));
  const router = Router();

  router.use(async (request, response, next) => {
    try {
      if (!await authorize(request)) {
        refuse(response, 401, 'Unlock DOCK to continue');
        return;
      }
      if (request.method !== 'GET' && request.get('x-dock-upload') !== '1') {
        refuse(response, 403, 'Upload header missing');
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.post('/:slug/avatar', express.raw({ type: () => true, limit: AVATAR_MAX_BYTES }), async (request, response) => {
    try {
      const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const look = await looks.setAvatar(request.params.slug, request.get('content-type') ?? '', bytes);
      response.status(200).set('cache-control', 'no-store').json(look);
    } catch (error) {
      if (error instanceof AvatarRefusal) return refuse(response, error.status, error.message);
      if (error instanceof OrchestratorInputError) return refuse(response, 400, error.message);
      console.error('[AgentLooks] upload failed:', error instanceof Error ? error.message : 'unknown error');
      refuse(response, 500, 'Upload failed');
    }
  });

  router.get('/:slug/avatar', async (request, response) => {
    const bytes = await looks.avatar(request.params.slug);
    if (!bytes) return refuse(response, 404, 'No avatar for this agent');
    response.status(200).set({
      'content-type': 'image/png',
      'content-length': String(bytes.length),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=86400',
    }).end(bytes);
  });

  router.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (error && typeof error === 'object' && (error as { type?: unknown }).type === 'entity.too.large') {
      refuse(response, 413, 'The avatar is larger than 512 KB');
      return;
    }
    next(error);
  });

  return router;
}
