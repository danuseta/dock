import express, { type Request, type Response, Router } from 'express';
import { bearerToken } from '../auth/ingest-token';
import { PinRateLimiter, sessionManager, shouldRequirePin } from '../auth/session';
import { MAX_TRANSCRIPT_BYTES, OrchestratorInputError, OrchestratorService, orchestratorService } from '../integrations/orchestrator';
import { StorageService } from '../storage/service';

const clientKey = (request: Request) => request.ip || request.socket.remoteAddress || 'unknown';

/**
 * Laptop -> DOCK. Every route needs an ingest token: the PIN session and the
 * Tailscale trust that unlock the dashboard do not apply here.
 */
export function createOrchestratorIngestRouter(
  service: OrchestratorService = orchestratorService,
  limiter = new PinRateLimiter(10, 15 * 60 * 1000),
): Router {
  const router = Router();

  router.use(async (request, response, next) => {
    try {
      const token = bearerToken(request);
      if (token && await service.authenticate(token)) {
        next();
        return;
      }
      // Only failures are throttled, so a noisy stranger cannot lock out a valid token.
      const key = clientKey(request);
      const retryAfter = limiter.retryAfterSeconds(key);
      if (retryAfter > 0) {
        response.status(429).set('retry-after', String(retryAfter)).json({ error: 'Too many failed attempts' });
        return;
      }
      limiter.recordFailure(key);
      response.status(401).json({ error: 'A valid ingest token is required' });
    } catch (error) {
      next(error);
    }
  });

  const handle = (work: (body: unknown) => Promise<unknown>) => async (request: Request, response: Response) => {
    try {
      const result = await work(request.body);
      if (result === null) {
        response.status(404).json({ error: 'Unknown ticket. Send its status first.' });
        return;
      }
      response.status(200).json({ ok: true, result });
    } catch (error) {
      if (error instanceof OrchestratorInputError) {
        response.status(400).json({ error: error.message });
        return;
      }
      console.error('[Orchestrator] ingest failed:', error instanceof Error ? error.message : 'unknown error');
      response.status(500).json({ error: 'Ingest failed' });
    }
  };

  const small = express.json({ limit: '256kb' });
  router.post('/', small, handle(async (body) => {
    const run = await service.ingestLedger(body);
    return { key: run.key, stage: run.stage };
  }));
  router.post('/event', small, handle(async (body) => {
    const run = await service.ingestHookEvent(body);
    return run && { key: run.key, activity: run.activity };
  }));
  router.post('/transcript', express.json({ limit: MAX_TRANSCRIPT_BYTES + 1024 * 1024 }), handle((body) => service.saveTranscript(body)));

  router.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    const { status, type } = (error ?? {}) as { status?: number; type?: string };
    if (status === 413) {
      response.status(413).json({ error: 'Payload too large' });
      return;
    }
    if (type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
    console.error('[Orchestrator] ingest failed:', error instanceof Error ? error.message : 'unknown error');
    response.status(500).json({ error: 'Ingest failed' });
  });

  return router;
}

/** DOCK browser -> transcript for the flow graph. Uses the dashboard session. */
export function createOrchestratorApiRouter(
  service: OrchestratorService = orchestratorService,
  storage = new StorageService(),
): Router {
  const router = Router();

  router.get('/transcript/:key', async (request, response) => {
    try {
      if (shouldRequirePin(request, await storage.hasMasterPin()) && !sessionManager.isAuthenticated(request)) {
        response.status(401).json({ error: 'Unlock DOCK to continue' });
        return;
      }
      const transcript = await service.readTranscript(request.params.key);
      if (!transcript) {
        response.status(404).json({ error: 'No transcript for this ticket' });
        return;
      }
      response.status(200).set('cache-control', 'no-store').type('application/json').send(transcript);
    } catch (error) {
      console.error('[Orchestrator] transcript read failed:', error instanceof Error ? error.message : 'unknown error');
      response.status(500).json({ error: 'Transcript is unavailable' });
    }
  });

  return router;
}
