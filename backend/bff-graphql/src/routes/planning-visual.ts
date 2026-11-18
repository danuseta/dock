import { createReadStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import type { PlanningVisualService } from '../integrations/planning-visual';
import { planningVisuals } from '../integrations/sprint-draft-live';
import { StorageService } from '../storage/service';

export interface PlanningVisualRouterOptions {
  reader?: Pick<PlanningVisualService, 'file'>;
  authorize?: (request: Request) => Promise<boolean>;
}

// The agent's page runs its own script in a sandboxed frame; it may not call out, load fonts, post forms or be framed by another site.
export const PLANNING_VISUAL_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

const refuse = (response: Response, status: number, message: string) => {
  if (!response.headersSent) response.status(status).json({ error: message });
};

/** Read-only: one HTML visual the planning agent made, for the Planning tab's sandboxed frame. Behind the same PIN as the dashboard, under its own CSP. */
export function createPlanningVisualRouter(options: PlanningVisualRouterOptions = {}): Router {
  const reader = options.reader ?? planningVisuals;
  const storage = options.authorize ? null : new StorageService();
  const authorize = options.authorize ?? (async (request: Request) => (
    !shouldRequirePin(request, await (storage as StorageService).hasMasterPin()) || sessionManager.isAuthenticated(request)
  ));
  const router = Router();

  router.use(async (request, response, next) => {
    try {
      if (request.method !== 'GET') return refuse(response, 405, 'Visuals are read-only');
      if (!await authorize(request)) return refuse(response, 401, 'Unlock DOCK to continue');
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/:sprint/:file', async (request, response) => {
    const file = reader.file(request.params.sprint, request.params.file);
    if (!file) return refuse(response, 400, 'Not a visual');
    try {
      const stat = await fs.stat(file);
      response.status(200).set({
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(stat.size),
        'content-security-policy': PLANNING_VISUAL_CSP,
        'referrer-policy': 'no-referrer',
        'cross-origin-opener-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-cache',
      });
      await pipeline(createReadStream(file), response);
    } catch {
      refuse(response, 404, 'No such visual');
    }
  });

  return router;
}
