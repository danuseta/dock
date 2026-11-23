import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { CHECKPOINT_KIND, OrchestratorService, checkpointText, parseCheckpoint } from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import type { StorageService } from '../storage/service';

function eventStorage() {
  const events: Array<{ id: string; ticketKey: string; kind: string; detail: string | null; createdAt: Date }> = [];
  let clock = Date.parse('2026-11-13T09:00:00.000Z');
  const storage = {
    addOrchestratorEvent: async (ticketKey: string, kind: string, detail: string | null) => {
      const event = { id: `e${events.length + 1}`, ticketKey, kind, detail, createdAt: new Date(clock += 60_000) };
      events.push(event);
      return event;
    },
    getOrchestratorEvents: async (ticketKey: string, take?: number, kinds?: string[]) => events
      .filter((event) => event.ticketKey === ticketKey && (!kinds || kinds.includes(event.kind)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take),
  };
  return { storage: storage as unknown as StorageService, events };
}

class TokenlessService extends OrchestratorService {
  override async authenticateMachine(token: string) { return token === 'dock_ing_good' ? 'workspace' : null; }
}

async function serve(t: { after: (fn: () => Promise<void>) => void }, service: OrchestratorService, on: () => Promise<boolean>) {
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(
    service, new PinRateLimiter(5, 60_000), undefined, undefined, undefined, undefined, undefined, null, undefined, null, undefined, undefined, undefined, undefined, on,
  ));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return async (body: unknown, bearer = 'dock_ing_good') => {
    const response = await fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/checkpoint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
}

test('a checkpoint is recorded on the ticket and answers recorded with its id', async (t) => {
  const { storage, events } = eventStorage();
  const service = new TokenlessService(storage);
  const post = await serve(t, service, async () => true);
  const answer = await post({ key: 'qrd-1534', step: 'plan', agentId: 'a1', agent: 'sous-planner', text: 'Planned 3 tasks.' });
  assert.strictEqual(answer.status, 200);
  assert.strictEqual(answer.body.recorded, true);
  assert.strictEqual(answer.body.id, 'e1');
  assert.deepStrictEqual(answer.body.result, { recorded: true, id: 'e1' });
  assert.strictEqual(events[0].kind, CHECKPOINT_KIND);
  assert.strictEqual(events[0].ticketKey, 'QRD-1534');
  assert.deepStrictEqual(JSON.parse(events[0].detail!), { key: 'QRD-1534', step: 'plan', agentId: 'a1', agent: 'sous-planner', text: 'Planned 3 tasks.', notes: { untestable: [], missingData: [] } });
});

test('with checkpoints off the route answers 200 not recorded, reason off, and stores nothing', async (t) => {
  const { storage, events } = eventStorage();
  const post = await serve(t, new TokenlessService(storage), async () => false);
  const answer = await post({ key: 'QRD-1534', step: 'plan', text: 'Planned.' });
  assert.strictEqual(answer.status, 200);
  assert.strictEqual(answer.body.recorded, false);
  assert.strictEqual(answer.body.reason, 'off');
  assert.deepStrictEqual(answer.body.result, { recorded: false, reason: 'off' });
  assert.strictEqual(events.length, 0);
});

test('the route needs the ingest token and a key, a step and a text', async (t) => {
  const { storage } = eventStorage();
  const post = await serve(t, new TokenlessService(storage), async () => true);
  assert.strictEqual((await post({ key: 'QRD-1', step: 'plan', text: 'x' }, 'dock_ing_bad')).status, 401);
  assert.strictEqual((await post({ key: 'nope', step: 'plan', text: 'x' })).status, 400);
  assert.strictEqual((await post({ key: 'QRD-1', step: '', text: 'x' })).status, 400);
  assert.strictEqual((await post({ key: 'QRD-1', step: 'plan', text: '   ' })).status, 400);
});

test('a long report is trimmed to two sentences and 400 characters, never refused', () => {
  assert.strictEqual(checkpointText('  First one.  Second one!   Third one. '), 'First one. Second one!');
  assert.strictEqual(checkpointText('No stop at the end'), 'No stop at the end');
  assert.strictEqual(checkpointText('Version 1.2 is out. Next.'), 'Version 1.2 is out. Next.', 'a dot inside a number is not a sentence end');
  const long = checkpointText(`${'a'.repeat(600)}.`);
  assert.strictEqual(long.length, 400);
  assert.ok(long.endsWith('…'));
  const parsed = parseCheckpoint({ key: 'QRD-1', step: 'final', text: 'One. Two. Three.', notes: { untestable: ['AC 3 needs QRD-1307 in UAT', 7, ''], missingData: ['a workspace with 2 agents'] } });
  assert.strictEqual(parsed.text, 'One. Two.');
  assert.deepStrictEqual(parsed.notes, { untestable: ['AC 3 needs QRD-1307 in UAT'], missingData: ['a workspace with 2 agents'] });
  assert.strictEqual(parsed.agentId, null);
});

test('checkpoints(key) lists the ticket\'s checkpoints oldest first with the final review notes', async () => {
  const { storage } = eventStorage();
  const service = new OrchestratorService(storage);
  await service.recordCheckpoint({ key: 'QRD-1534', step: 'plan', agent: 'sous-planner', text: 'Planned.' });
  await service.recordEvent('QRD-1534', 'JIRA', 'something else');
  await service.recordCheckpoint({ key: 'QRD-9', step: 'plan', text: 'Other ticket.' });
  await service.recordCheckpoint({ key: 'QRD-1534', step: 'final', agentId: 'r1', agent: 'sous-reviewer', text: 'All AC traced.', notes: { untestable: ['AC 5'], missingData: ['seed user'] } });
  const list = await service.checkpoints('qrd-1534');
  assert.deepStrictEqual(list.map((item) => item.step), ['plan', 'final']);
  assert.deepStrictEqual(list[1].notes, { untestable: ['AC 5'], missingData: ['seed user'] });
  assert.strictEqual(list[1].agent, 'sous-reviewer');
  assert.strictEqual(list[1].key, 'QRD-1534');
  assert.match(list[1].at, /^2026-11-13T/);
  assert.deepStrictEqual(await service.checkpoints('not a key'), []);
});
