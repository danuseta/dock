import assert from 'node:assert';
import test from 'node:test';
import { QA_GUIDE_END, QA_GUIDE_START, currentGuide, guideLines, routesFromFiles, withGuide, writeQaGuide, type QaGuideDeps } from '../integrations/qa-guide';

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content });

function fakeJira(value: unknown, enabled = true) {
  const state = { value, writes: [] as Array<{ key: string; field: string; value: unknown }>, events: [] as string[] };
  const deps: QaGuideDeps = {
    settings: async () => ({ enabled, field: 'customfield_10340' }),
    read: async () => state.value,
    write: async (key, field, next) => { state.writes.push({ key, field, value: next }); state.value = next; },
    frontendFiles: async () => ['src/v2/pages/robo/datapoint-detail.tsx', 'src/v2/pages/robo/datapoint-detail.test.tsx', 'src/v2/modules/robo/table.tsx'],
    menu: async () => 'Robo > Datapoint',
    event: async (_key, kind, detail) => { state.events.push(`${kind}: ${detail}`); },
  };
  return { state, deps };
}

test('routes come from the page and route files a pull request changes, tests left out', () => {
  assert.deepStrictEqual(routesFromFiles([
    'src/v2/pages/robo/datapoint-detail.tsx',
    'src/v2/pages/settings/index.tsx',
    'src/v2/pages/contacts/contact-list-page.tsx',
    'src/v2/pages/robo/datapoint-detail.test.tsx',
    'src/app/(dashboard)/inbox/page.tsx',
    'src/v2/modules/robo/table.tsx',
  ]), ['/robo/datapoint-detail', '/settings', '/contacts/contact-list']);
  assert.deepStrictEqual(routesFromFiles(['src/app/(dashboard)/inbox/page.tsx']), ['/inbox']);
  assert.deepStrictEqual(routesFromFiles(['README.md']), []);
});

test('the block has the markers, the route line and the menu line', () => {
  assert.deepStrictEqual(guideLines({ routes: ['/robo'], menu: 'Robo > Datapoint' }), [QA_GUIDE_START, 'URL/route: /robo', 'Jalur menu: Robo > Datapoint', QA_GUIDE_END]);
  assert.deepStrictEqual(guideLines({ routes: [], menu: null }), [QA_GUIDE_START, 'URL/route: -', 'Jalur menu: -', QA_GUIDE_END]);
});

test('the block replaces the marked part only; manual content around it stays', () => {
  const lines = guideLines({ routes: ['/new'], menu: 'New' });
  const before = doc(p('Manual note from the developer'), p(QA_GUIDE_START), p('URL/route: /old'), p('Jalur menu: Old'), p(QA_GUIDE_END), p('Another manual line'));
  const after = withGuide(before, lines) as any;
  assert.deepStrictEqual(after.content.map((block: any) => block.content[0].text), ['Manual note from the developer', ...lines, 'Another manual line']);
  assert.strictEqual(after.version, 1);
  const appended = withGuide(doc(p('Only manual')), lines) as any;
  assert.deepStrictEqual(appended.content.map((block: any) => block.content[0].text), ['Only manual', ...lines]);
  assert.deepStrictEqual(withGuide(null, lines), doc(...lines.map(p)));
  assert.strictEqual(withGuide('Manual\nQA guide (DOCK)\nURL/route: /old\n/QA guide\nTail', lines), ['Manual', ...lines, 'Tail'].join('\n'));
  const noEnd = withGuide(doc(p(QA_GUIDE_START), p('URL/route: /old'), p('Manual after a lost end marker')), lines) as any;
  assert.deepStrictEqual(noEnd.content.map((block: any) => block.content[0].text), [...lines, 'Manual after a lost end marker']);
});

test('writing twice writes once: the same block is not written again', async () => {
  const { state, deps } = fakeJira(doc(p('Manual')));
  const first = await writeQaGuide(deps, 'QRD-1534');
  assert.strictEqual(first.written, true);
  assert.deepStrictEqual(first.lines, [QA_GUIDE_START, 'URL/route: /robo/datapoint-detail', 'Jalur menu: Robo > Datapoint', QA_GUIDE_END]);
  assert.strictEqual(state.writes[0].field, 'customfield_10340');
  assert.deepStrictEqual(currentGuide(state.value), first.lines);
  const second = await writeQaGuide(deps, 'QRD-1534');
  assert.deepStrictEqual({ written: second.written, reason: second.reason }, { written: false, reason: 'unchanged' });
  assert.strictEqual(state.writes.length, 1);
  assert.deepStrictEqual(state.events, ['JIRA: QA guide written to customfield_10340']);
});

test('the move to UAT writes only with the switch on; the manual action writes either way', async () => {
  const off = fakeJira(null, false);
  assert.deepStrictEqual(await writeQaGuide(off.deps, 'QRD-1534'), { written: false, reason: 'off', lines: [] });
  assert.strictEqual(off.state.writes.length, 0);
  assert.strictEqual((await writeQaGuide(off.deps, 'QRD-1534', true)).written, true);
  assert.strictEqual(off.state.writes.length, 1);
});
