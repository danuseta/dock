import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QA_QUEUE_MAX_ROWS, QA_QUEUE_TTL_MS, QaQueueService, blockedByOpen, buildQaQueue, enteredUatAt, isDoneLabel, qaKind, qaQueueJql } from '../integrations/qa-queue';

const NOW = Date.parse('2026-11-13T10:00:00.000Z');
const entered = (at: string) => ({ histories: [{ created: '2026-11-01T00:00:00.000Z', items: [{ field: 'status', toString: 'PR Review' }] }, { created: at, items: [{ field: 'status', toString: 'UAT CHECK' }] }] });
const blockedBy = (key: string, status?: string) => ({ type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key, ...(status ? { fields: { status: { name: status } } } : {}) } });
const issue = (key: string, at: string | null, fields: Record<string, unknown> = {}) => ({
  key,
  fields: { summary: `Title ${key}`, status: { name: 'UAT CHECK' }, assignee: { displayName: 'M Danu Seta W' }, labels: [], issuelinks: [], ...fields },
  ...(at ? { changelog: entered(at) } : {}),
});

describe('QA queue', () => {
  it('orders by the time each ticket entered UAT CHECK, oldest first, and numbers the rows', () => {
    const queue = buildQaQueue([
      issue('QRD-3', '2026-11-13T09:00:00.000Z'),
      issue('QRD-1', '2026-11-13T07:00:00.000Z'),
      issue('QRD-2', null),
      issue('QRD-4', null, { statuscategorychangedate: '2026-11-13T08:00:00.000+0000' }),
    ], NOW);
    assert.deepEqual(queue.rows.map((row) => [row.position, row.key]), [[1, 'QRD-1'], [2, 'QRD-4'], [3, 'QRD-3'], [4, 'QRD-2']]);
    assert.deepEqual(queue.rows.map((row) => row.waitingMinutes), [180, 120, 60, null]);
  });

  it('a QA-WAIT-DEPENDENCY row names its open blockers and is counted apart from ESCALATED', () => {
    const queue = buildQaQueue([
      issue('QRD-1510', '2026-11-13T08:00:00.000Z', { labels: ['QA-WAIT-DEPENDENCY', 'be'], issuelinks: [blockedBy('QRD-1307', 'UAT MERGED'), blockedBy('QRD-1200', 'UAT CHECK'), { type: { name: 'Relates' }, inwardIssue: { key: 'QRD-9' } }] }),
      issue('QRD-1422', '2026-11-13T09:00:00.000Z', { labels: ['QA-ESCALATED'] }),
      issue('QRD-1423', '2026-11-13T09:30:00.000Z', { labels: ['QA-BLOCKED-ACCESS'] }),
      issue('QRD-1424', '2026-11-13T09:40:00.000Z'),
    ], NOW, 'M Danu Seta W');
    const row = queue.rows.find((item) => item.key === 'QRD-1510')!;
    assert.deepEqual([row.kind, row.waitsOn, row.labels], ['dependency', ['QRD-1307'], ['QA-WAIT-DEPENDENCY']]);
    assert.deepEqual(queue.metrics, { total: 4, queue: 1, dependency: 1, escalated: 2, averageWaitMinutes: 58, oldestWaitMinutes: 120 });
    assert.equal(queue.me, 'M Danu Seta W');
  });

  it('labels: wait-dependency wins over escalated; no QA label is the plain queue', () => {
    assert.equal(qaKind(['QA-ESCALATED', 'QA-WAIT-DEPENDENCY']), 'dependency');
    assert.equal(qaKind(['qa-manual']), 'escalated');
    assert.equal(qaKind(['QA-MENUNGGU']), 'queue');
    assert.deepEqual(blockedByOpen([blockedBy('QRD-1'), blockedBy('QRD-1')]), ['QRD-1'], 'a blocker without a status is kept once');
    assert.equal(enteredUatAt({ fields: {} }), null);
  });

  it('the JQL reads UAT CHECK plus wait-dependency tickets not done, in the configured projects', () => {
    assert.equal(qaQueueJql(['QRD']), 'project in ("QRD") AND (status = "UAT CHECK" OR (labels = "QA-WAIT-DEPENDENCY" AND statusCategory != Done)) ORDER BY updated ASC');
    assert.equal(qaQueueJql([]), '(status = "UAT CHECK" OR (labels = "QA-WAIT-DEPENDENCY" AND statusCategory != Done)) ORDER BY updated ASC');
  });

  it('one search a minute whatever the number of readers; a failed search keeps the last queue with the error', async () => {
    const clock = { t: NOW };
    let searches = 0;
    let fail = false;
    let release: () => void = () => undefined;
    let gate: Promise<void> = Promise.resolve();
    const service = new QaQueueService({
      search: async () => { searches += 1; await gate; if (fail) throw new Error('Jira 503'); return { issues: [issue('QRD-1', '2026-11-13T09:00:00.000Z')] }; },
      projectKeys: async () => ['QRD'],
      me: async () => 'Danu',
      now: () => clock.t,
    });
    gate = new Promise((resolve) => { release = resolve; });
    const readers = Promise.all([service.queue(), service.queue(), service.queue()]);
    release();
    await readers;
    assert.equal(searches, 1, 'reads that arrive together share one search');
    clock.t += QA_QUEUE_TTL_MS - 1;
    await service.queue();
    assert.equal(await service.position('qrd-1'), 1);
    assert.equal(await service.position('QRD-2'), null);
    assert.equal(searches, 1, 'inside the minute the cache answers');
    clock.t += 2;
    fail = true;
    const failed = await service.queue();
    assert.equal(searches, 2);
    assert.deepEqual([failed.error, failed.rows.length], ['Jira 503', 1]);
    await service.queue();
    assert.equal(searches, 2, 'a failure is cached for the minute too');
  });

  it('a ticket the bot already passed (QA-DONE-*) is not in the queue or the metrics; an escalated one stays in its own count', () => {
    const queue = buildQaQueue([
      issue('QRD-1', '2026-11-13T07:00:00.000Z', { labels: ['QA-DONE-PASSED'] }),
      issue('QRD-2', '2026-11-13T08:00:00.000Z', { labels: ['qa-done-not-passed'] }),
      issue('QRD-3', '2026-11-13T09:00:00.000Z', { labels: ['QA-DONE-ESCALATED', 'QA-ESCALATED'] }),
      issue('QRD-4', '2026-11-13T09:30:00.000Z'),
    ], NOW);
    assert.deepEqual(queue.rows.map((row) => [row.position, row.key, row.kind]), [[1, 'QRD-3', 'escalated'], [2, 'QRD-4', 'queue']]);
    assert.deepEqual([queue.metrics.total, queue.metrics.escalated, queue.metrics.queue], [2, 1, 1]);
    assert.deepEqual([isDoneLabel('QA-DONE-PASSED'), isDoneLabel('QA_DONE_UAT_BUG'), isDoneLabel('QA-ESCALATED'), isDoneLabel('QA-DONE-ESCALATED')], [true, true, false, false]);
  });

  it('pages through every result with the next page token, stops at the hard cap and counts the rest', async () => {
    const all = Array.from({ length: 620 }, (_, index) => issue(`QRD-${index + 1}`, null));
    const tokens: Array<string | undefined> = [];
    const read = (total: number, counted?: number | Error) => new QaQueueService({
      search: async (_jql, _fields, size, token) => {
        tokens.push(token);
        const start = Number(token ?? 0);
        const end = start + size;
        return { issues: all.slice(0, total).slice(start, end), nextPageToken: end < total ? String(end) : null };
      },
      ...(counted === undefined ? {} : { count: async () => { if (counted instanceof Error) throw counted; return counted; } }),
      projectKeys: async () => [],
      me: async () => null,
      now: () => NOW,
    }).queue();
    const some = await read(230);
    assert.deepEqual([some.rows.length, some.metrics.total, some.capped, some.more], [230, 230, false, null]);
    assert.deepEqual(tokens, [undefined, '100', '200']);
    const lots = await read(620, 620);
    assert.deepEqual([lots.rows.length, lots.capped, lots.more], [QA_QUEUE_MAX_ROWS, true, 120]);
    assert.equal((await read(620, new Error('no count'))).more, -1);
  });
});
