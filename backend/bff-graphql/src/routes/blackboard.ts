import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import { sessionManager, shouldRequirePin } from '../auth/session';
import { Blackboard, BlackboardRefusal, blackboard } from '../integrations/blackboard';
import { loadAcTrace, type AcTraceLedger } from '../integrations/ac-trace';
import { parseLedger } from '../integrations/orchestrator';
import { StorageService } from '../storage/service';

export interface BlackboardRouterOptions {
  board?: Blackboard;
  authorize?: (request: Request) => Promise<boolean>;
  /** The ticket's ledger as status.cjs last pushed it; null when this DOCK has no run for it. */
  ledger?: (key: string) => Promise<AcTraceLedger | null>;
}

/** The AC, pull requests and evidence of the run DOCK keeps for the ticket; null when there is none or it cannot be read. */
async function storedLedger(key: string): Promise<AcTraceLedger | null> {
  const row = await new StorageService().getOrchestratorRunWithLedger(key.trim().toUpperCase()).catch(() => null);
  if (!row) return null;
  try {
    const ledger = parseLedger(JSON.parse(row.ledgerRaw || row.payload));
    return { ac: ledger.ac, prBe: ledger.prBe, prFe: ledger.prFe };
  } catch {
    return null;
  }
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

  router.get('/root/:file', async (request, response) => {
    const opened = await board.rootFile(request.params.file);
    if (!opened) return refuse(response, 404, 'No such file');
    response.status(200).set({ 'content-type': opened.mime, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
    await pipeline(createReadStream(opened.file), response).catch(() => undefined);
  });

  router.get('/tickets', async (_request, response) => {
    response.set('cache-control', 'no-store').json({ tickets: await board.tickets() });
  });

  router.get('/:key/files', async (request, response) => {
    const files = await board.files(request.params.key);
    if (!files) return refuse(response, 404, 'No blackboard for this ticket');
    response.set('cache-control', 'no-store').json({ files });
  });

  router.get('/:key/ac-trace', async (request, response) => {
    const ledger = await (options.ledger ?? storedLedger)(request.params.key).catch(() => null);
    const trace = await loadAcTrace(board, request.params.key, ledger);
    if (!trace) return refuse(response, 404, 'No blackboard for this ticket');
    response.set('cache-control', 'no-store').json({ trace });
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
