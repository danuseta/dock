import express, { type Request, type Response, Router } from 'express';
import http from 'node:http';
import { PinRateLimiter } from '../auth/session';
import { OrchestratorService, orchestratorService } from '../integrations/orchestrator';
import { ingestAuth } from './orchestrator';

const OPERATIONS = new Set(['retrieve', 'search', 'read', 'save', 'ingest', 'status']);
const MAX_BODY = '64kb';
const UPSTREAM_STATUS_MESSAGES = new Map<number, string>([
  [400, 'Brain rejected the request'],
  [403, 'Brain access denied'],
  [404, 'Note not found'],
  [409, 'Brain could not accept the note title'],
  [413, 'Brain rejected the request size'],
  [429, 'Brain rate limit reached'],
  [503, 'Brain is busy'],
  [507, 'Brain storage is full'],
]);
const RETRY_AFTER_STATUSES = new Set([429, 503]);

export interface BrainProxyLimits {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxConcurrentPerMachine?: number;
}

type Outcome =
  | { kind: 'ok'; body: unknown }
  | { kind: 'status'; status: number; retryAfter: string | null }
  | { kind: 'unreachable' | 'timeout' | 'invalid' };

function parseUpstream(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export function createBrainProxyRouter(
  service: OrchestratorService = orchestratorService,
  limiter = new PinRateLimiter(10, 15 * 60 * 1000),
  upstream: string | undefined = process.env.BRAIN_SERVICE_URL,
  secret: string | undefined = process.env.BRAIN_INTERNAL_SECRET,
  limits: BrainProxyLimits = {},
): Router {
  const timeoutMs = limits.timeoutMs ?? 15_000;
  const maxResponseBytes = limits.maxResponseBytes ?? 256 * 1024;
  const maxConcurrent = limits.maxConcurrentPerMachine ?? 4;
  const target = parseUpstream(upstream);
  const running = new Map<string, number>();
  const router = Router();

  router.use(ingestAuth(service, limiter));

  const forward = (op: string, machine: string, payload: string, onHangup: (abort: () => void) => void) => new Promise<Outcome>((resolve) => {
    let settled = false;
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const request = http.request({
      hostname: target!.hostname,
      port: target!.port || 80,
      path: `/v1/${op}`,
      method: 'POST',
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-brain-machine': machine,
        'x-brain-secret': secret!,
      },
    }, (reply) => {
      const declared = Number(reply.headers['content-length']);
      if (declared > maxResponseBytes) {
        request.destroy();
        finish({ kind: 'invalid' });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      reply.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxResponseBytes) {
          request.destroy();
          finish({ kind: 'invalid' });
          return;
        }
        chunks.push(chunk);
      });
      reply.on('error', () => finish({ kind: 'unreachable' }));
      reply.on('end', () => {
        const status = reply.statusCode ?? 0;
        if (status !== 200) {
          const retryAfter = String(reply.headers['retry-after'] ?? '');
          finish({ kind: 'status', status, retryAfter: /^\d{1,6}$/.test(retryAfter) ? retryAfter : null });
          return;
        }
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.includes(secret!)) {
          finish({ kind: 'invalid' });
          return;
        }
        try {
          finish({ kind: 'ok', body: JSON.parse(text) });
        } catch {
          finish({ kind: 'invalid' });
        }
      });
    });
    const timer = setTimeout(() => {
      request.destroy();
      finish({ kind: 'timeout' });
    }, timeoutMs);
    onHangup(() => {
      request.destroy();
      finish({ kind: 'unreachable' });
    });
    request.on('error', () => finish({ kind: 'unreachable' }));
    request.end(payload);
  });

  const small = express.json({ limit: MAX_BODY });
  router.post('/:op', (request: Request, response: Response, next) => {
    if (!OPERATIONS.has(request.params.op)) {
      response.status(404).json({ error: 'Unknown Brain operation' });
      return;
    }
    if (!target || !secret) {
      response.status(503).json({ error: 'Brain is not configured' });
      return;
    }
    const machine: string = response.locals.machine;
    const active = running.get(machine) ?? 0;
    if (active >= maxConcurrent) {
      response.status(429).json({ error: 'Too many concurrent Brain requests' });
      return;
    }
    running.set(machine, active + 1);
    let released = false;
    response.on('close', () => {
      if (released) return;
      released = true;
      const left = (running.get(machine) ?? 1) - 1;
      if (left > 0) running.set(machine, left);
      else running.delete(machine);
    });
    small(request, response, next);
  }, async (request: Request, response: Response) => {
    const op = request.params.op;
    const machine: string = response.locals.machine;
    let abort = () => {};
    let hungUp = false;
    response.on('close', () => {
      hungUp = true;
      abort();
    });
    const body = request.body;
    const payload = JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { ...body, machine: undefined } : body ?? {});
    const outcome = await forward(op, machine, payload, (hangup) => { abort = hangup; }).catch((): Outcome => ({ kind: 'unreachable' }));
    if (hungUp) return;
    if (outcome.kind === 'ok') {
      response.status(200).json(outcome.body);
      return;
    }
    if (outcome.kind === 'status') {
      const message = UPSTREAM_STATUS_MESSAGES.get(outcome.status);
      if (message) {
        if (RETRY_AFTER_STATUSES.has(outcome.status) && outcome.retryAfter) response.set('retry-after', outcome.retryAfter);
        response.status(outcome.status).json({ error: message });
        return;
      }
      console.warn(`[Brain] upstream answered an unexpected status (op=${op})`);
      response.status(502).json({ error: 'Brain returned an invalid response' });
      return;
    }
    console.warn(`[Brain] upstream ${outcome.kind} (op=${op})`);
    if (outcome.kind === 'timeout') {
      response.status(504).json({ error: 'Brain timed out' });
      return;
    }
    if (outcome.kind === 'unreachable') {
      response.status(503).json({ error: 'Brain is unavailable' });
      return;
    }
    response.status(502).json({ error: 'Brain returned an invalid response' });
  });

  router.use((_request: Request, response: Response) => {
    response.status(404).json({ error: 'Unknown Brain operation' });
  });

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
    console.error('[Brain] request failed:', error instanceof Error ? error.message : 'unknown error');
    response.status(500).json({ error: 'Brain request failed' });
  });

  return router;
}
