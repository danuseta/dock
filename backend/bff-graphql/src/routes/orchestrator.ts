import express, { type Request, type Response, Router } from 'express';
import { bearerToken } from '../auth/ingest-token';
import { PinRateLimiter, sessionManager, shouldRequirePin } from '../auth/session';
import { ChatService, chatService } from '../integrations/chat';
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
  chat: ChatService = chatService,
): Router {
  const router = Router();

  router.use(async (request, response, next) => {
    try {
      const token = bearerToken(request);
      const machine = token ? await service.authenticateMachine(token) : null;
      if (machine) {
        response.locals.machine = machine;
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

  const handle = (work: (body: unknown, signal: AbortSignal, machine: string) => Promise<unknown>) => async (request: Request, response: Response) => {
    // A long poll stops when the laptop hangs up, so it cannot take a message nobody is waiting for.
    const hangup = new AbortController();
    response.on('close', () => hangup.abort());
    try {
      const result = await work(request.body, hangup.signal, response.locals.machine);
      if (hangup.signal.aborted) return;
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
  router.post('/', small, handle(async (body, _signal, machine) => {
    const run = await service.ingestLedger(body, new Date(), machine);
    return run.ignored ? { key: run.key, ignored: true, owner: run.machine } : { key: run.key, stage: run.stage };
  }));
  router.post('/ledger/list', small, handle((_body, _signal, machine) => service.ledgerList(machine)));
  router.post('/ledger/get', small, handle((body, _signal, machine) => service.ledgerGet(body, machine)));
  router.post('/ledger/handover', small, handle((body, _signal, machine) => service.ledgerHandover(body, machine)));
  router.post('/ledger/accept', small, handle((body, _signal, machine) => service.ledgerAccept(body, machine)));
  router.post('/event', small, handle(async (body, _signal, machine) => {
    const run = await service.ingestHookEvent(body, new Date(), machine);
    return run && { key: run.key, activity: run.activity, ...(run.ignored ? { ignored: true, owner: run.machine } : {}) };
  }));
  router.post('/events', small, handle(async (body, _signal, machine) => {
    const run = await service.ingestEventBatch(body, new Date(), machine);
    return run && { key: run.key, activity: run.activity, ...(run.ignored ? { ignored: true, owner: run.machine } : {}) };
  }));
  router.post('/transcript', express.json({ limit: MAX_TRANSCRIPT_BYTES + 1024 * 1024 }), handle((body, _signal, machine) => service.saveTranscript(body, new Date(), machine)));
  router.post('/sessions', express.json({ limit: '2mb' }), handle((body, _signal, machine) => chat.syncSession(body, machine)));
  router.post('/chat/claim', small, handle((body, signal, machine) => chat.claim(body, signal, machine)));
  router.post('/chat/delta', small, handle((body, _signal, machine) => chat.delta(body, machine)));
  router.post('/chat/activity', small, handle((body, _signal, machine) => chat.activity(body, machine)));
  router.post('/chat/status', small, handle(async (body, _signal, machine) => chat.ingestStatus(body, machine)));

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
