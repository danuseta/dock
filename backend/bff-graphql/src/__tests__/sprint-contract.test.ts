import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfluenceClient, type ConfluencePage } from '../integrations/confluence';
import { contractStorage, contractTitle, writeContract, type ContractClient } from '../integrations/sprint-contract';
import type { DraftView } from '../integrations/sprint-draft';

const view = (): DraftView => ({
  sprint: 'QRD Sprint 27', sprintId: 27, status: 'draft', sprintDays: 10, startDate: null, spPerDay: 2, createdBy: 'Alvin', loadedAt: '2026-11-09T00:00:00.000Z',
  publishedAt: null, qaReason: null, devs: ['Aken', 'Danu'], blockers: [], canPublish: true, landed: 0,
  tickets: [
    { key: 'QRD-1489', summary: 'Edit share <b>', dev: 'Aken', jiraDev: 'Aken', sp: 4, wave: 1, waveSet: false, status: 'To Do', ac: [], dependsOn: [], start: 0, dur: 2, end: 2, inSprint: true, split: null, prediction: null, qaDecision: null },
    {
      key: 'QRD-1511', summary: 'Cursor', dev: 'Danu', jiraDev: 'Danu', sp: 2, wave: 2, waveSet: false, status: 'To Do', ac: [], dependsOn: ['QRD-1489'], start: 2, dur: 1, end: 3, inSprint: true, split: null,
      prediction: { prediction: 'ESCALATED', reasons: ['two accounts'], fix: null }, qaDecision: { action: 'accept', note: null, by: 'Alvin', at: '2026-11-09T03:00:00.000Z' },
    },
  ],
  findings: [{ id: 'ac|QRD-1511|QRD-1489|edit client', key: 'QRD-1511', line: 4, text: 'Edit client', refKey: 'QRD-1489', kind: 'after-it', refEnd: 2, ownEnd: 3, decision: { action: 'move', note: null, by: 'Alvin', at: '2026-11-09T02:00:00.000Z' } }],
} as unknown as DraftView);

class FakeConfluence implements ContractClient {
  pages = new Map<string, ConfluencePage>([['900', { id: '900', title: 'Sprint 27', version: 3, spaceKey: 'QRD' }]]);
  writes: Array<[string, string, string]> = [];
  async page(id: string) { return this.pages.get(id) ?? null; }
  async findPage(space: string, title: string) { return [...this.pages.values()].find((page) => page.spaceKey === space && page.title === title) ?? null; }
  async createPage(space: string, parent: string, title: string, storage: string) {
    const page = { id: '901', title, version: 1, spaceKey: space };
    this.pages.set(page.id, page);
    this.writes.push(['create', `${parent}/${title}`, storage]);
    return page;
  }
  async updatePage(page: ConfluencePage, storage: string) {
    const next = { ...page, version: page.version + 1 };
    this.pages.set(page.id, next);
    this.writes.push(['update', page.id, storage]);
    return next;
  }
}

test('the contract page holds the release order by wave, the AC rules, the decisions with who and when, and the changes without PO', () => {
  const body = contractStorage(view(), 'Alvin', new Date('2026-11-09T05:00:00Z'));
  assert.match(body, /<h3>Wave 1 · closes D2<\/h3>.*QRD-1489.*Edit share &lt;b&gt;/);
  assert.match(body, /<h3>Wave 2 · closes D3<\/h3>.*QRD-1511/);
  assert.match(body, /<h2>AC rules<\/h2>/);
  assert.match(body, /QRD-1511 AC 4.*move to QRD-1489: Edit client.*Alvin.*2026-11-09 02:00/);
  assert.match(body, /QRD-1511 QA ESCALATED.*risk accepted/);
  assert.match(body, /<h2>Changes without the PO<\/h2>.*ac-move-pending/);
});

test('the contract page is skipped without a parent, created under it, then rewritten with the next version', async () => {
  const confluence = new FakeConfluence();
  const now = new Date('2026-11-09T05:00:00Z');
  assert.equal((await writeContract(confluence, null, view(), 'Alvin', now)).status, 'skipped');
  assert.equal((await writeContract(confluence, '404', view(), 'Alvin', now)).status, 'failed');
  const created = await writeContract(confluence, '900', view(), 'Alvin', now);
  assert.deepEqual(created, { status: 'updated', detail: `Created "${contractTitle('QRD Sprint 27')}" (page 901, v1) in QRD` });
  assert.equal(confluence.writes[0][1], '900/Sprint contract QRD Sprint 27');
  const updated = await writeContract(confluence, '900', view(), 'Alvin', now);
  assert.match(updated.detail, /Updated .* \(page 901, v2\)/);
  assert.deepEqual(confluence.writes.map(([kind]) => kind), ['create', 'update']);
});

test('the Confluence client reads the parent space, writes pages with the next version and downloads under /wiki', async () => {
  const calls: Array<[string, string, unknown]> = [];
  const http = {
    get: async (url: string, params?: Record<string, unknown>) => {
      calls.push(['get', url, params]);
      if (url.endsWith('/content/900')) return { id: '900', title: 'Sprint 27', version: { number: 3 }, space: { key: 'QRD' } };
      if (url === '/wiki/download/attachments/1/v2.html') return '<html>F1.1</html>';
      return { results: [] };
    },
    post: async (url: string, body: unknown) => { calls.push(['post', url, body]); return { id: '901', title: 'T', version: { number: 1 }, space: { key: 'QRD' } }; },
    put: async (url: string, body: unknown) => { calls.push(['put', url, body]); return { id: '901', title: 'T', version: { number: 2 } }; },
  };
  const client = new ConfluenceClient(http);
  assert.deepEqual(await client.page('900'), { id: '900', title: 'Sprint 27', version: 3, spaceKey: 'QRD' });
  assert.equal(await client.findPage('QRD', 'T'), null);
  await client.createPage('QRD', '900', 'T', '<p/>');
  await client.updatePage({ id: '901', title: 'T', version: 1, spaceKey: 'QRD' }, '<p/>');
  assert.equal(await client.download('/download/attachments/1/v2.html'), '<html>F1.1</html>');
  assert.deepEqual((calls.find(([kind]) => kind === 'post')![2] as any).ancestors, [{ id: '900' }]);
  assert.deepEqual((calls.find(([kind]) => kind === 'put')![2] as any).version, { number: 2 });
});
