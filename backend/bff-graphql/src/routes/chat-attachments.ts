import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import {
  AttachmentRefusal,
  chatAttachmentService,
  isInlineImage,
  type ChatAttachmentService,
} from '../integrations/chat-attachments';
import { StorageService } from '../storage/service';

export interface ChatAttachmentRouterOptions {
  service?: ChatAttachmentService;
  authorize?: (request: Request) => Promise<boolean>;
}

const queryText = (value: unknown) => (typeof value === 'string' ? value : '');

function refuse(response: Response, status: number, message: string) {
  if (response.headersSent) return;
  response.status(status).set('connection', 'close').json({ error: message });
}

export function createChatAttachmentRouter(options: ChatAttachmentRouterOptions = {}): Router {
  const service = options.service ?? chatAttachmentService;
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

  router.post('/', async (request, response) => {
    const declared = Number(request.get('content-length'));
    try {
      const view = await service.receive({
        sessionId: queryText(request.query.sessionId),
        name: queryText(request.query.name),
        contentType: request.get('content-type') ?? '',
        contentLength: request.get('content-length') !== undefined && Number.isFinite(declared) ? declared : null,
      }, request);
      response.status(200).set('cache-control', 'no-store').json({ id: view.id, name: view.name, mime: view.mime, size: view.size });
    } catch (error) {
      if (error instanceof AttachmentRefusal) {
        refuse(response, error.status, error.message);
        return;
      }
      if (request.destroyed || request.aborted) return;
      console.error('[ChatAttachments] upload failed:', error instanceof Error ? error.message : 'unknown error');
      refuse(response, 500, 'Upload failed');
    }
  });

  router.get('/:id', async (request, response) => {
    try {
      const found = await service.get(request.params.id);
      if (!found) {
        response.status(404).json({ error: 'Unknown attachment' });
        return;
      }
      response.status(200);
      response.set({
        'content-type': found.row.mime,
        'content-length': String(found.row.size),
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=3600',
      });
      if (!isInlineImage(found.row.mime)) {
        response.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(found.row.name)}`);
      }
      await pipeline(createReadStream(found.path), response);
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      console.error('[ChatAttachments] read failed:', error instanceof Error ? error.message : 'unknown error');
      refuse(response, 500, 'Attachment is unavailable');
    }
  });

  router.delete('/:id', async (request, response) => {
    try {
      const outcome = await service.discard(request.params.id);
      if (outcome === 'missing') {
        response.status(404).json({ error: 'Unknown attachment' });
        return;
      }
      if (outcome === 'sent') {
        response.status(409).json({ error: 'This file was already sent' });
        return;
      }
      response.status(200).json({ ok: true });
    } catch (error) {
      console.error('[ChatAttachments] delete failed:', error instanceof Error ? error.message : 'unknown error');
      refuse(response, 500, 'Delete failed');
    }
  });

  return router;
}
