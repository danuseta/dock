import assert from 'node:assert';
import test from 'node:test';
import { hasUi, inUat, isLongDescription, jiraAcLines, needsYou, readinessOnBoard, readinessRefs, runState, splitChoices, stepIndex, ticketLinks, ticketReadiness } from '../lib/ticketDetail';

const run = { waiting: null, stalled: false, finished: false, stage: 'code', ac: [], reviewSignal: null };

test('the step of a stage folds evidence and commit into Verify, and an unknown stage is off the steps', () => {
  assert.strictEqual(stepIndex('plan'), 1);
  assert.strictEqual(stepIndex('evidence'), stepIndex('verify'));
  assert.strictEqual(stepIndex('commit'), stepIndex('verify'));
  assert.strictEqual(stepIndex('blocked'), -1);
  assert.strictEqual(stepIndex(null), -1);
});

test('the run label reads none, waiting, stalled, running or finished', () => {
  assert.strictEqual(runState(null), 'none');
  assert.strictEqual(runState(run), 'running');
  assert.strictEqual(runState({ ...run, stalled: true }), 'stalled');
  assert.strictEqual(runState({ ...run, waiting: 'Keep tags?' }), 'waiting');
  assert.strictEqual(runState({ ...run, waiting: 'Keep tags?', finished: true }), 'finished');
  assert.strictEqual(runState({ ...run, stage: 'pr' }), 'pr', 'an open PR waits for review, it is not running');
  assert.strictEqual(runState({ ...run, stage: 'pr', stalled: true }), 'pr');
  assert.strictEqual(runState({ ...run, stage: 'pr', waiting: 'Keep tags?' }), 'waiting');
});

test('needs you is empty when nothing waits on the owner', () => {
  assert.deepStrictEqual(needsYou({ run: null, pullRequests: [] }), []);
  assert.deepStrictEqual(needsYou({ run, pullRequests: [{ id: '1', repo: 'web', number: 3, status: 'OPEN' }] }), []);
});

test('needs you lists the question first, then failing AC, review and conflicts', () => {
  const items = needsYou({
    run: { ...run, stage: 'pr', waiting: 'Keep the tag filter?', reviewSignal: 'checks_failing', ac: [{ n: 1, state: 'PASS', text: 'Folder' }, { n: 2, state: 'FAIL', text: 'Tags filter' }] },
    pullRequests: [{ id: 'p1', repo: 'web', pullNumber: 12, status: 'CONFLICT' }],
  });
  assert.deepStrictEqual(items.map((item) => item.kind), ['question', 'ac', 'review', 'conflict']);
  assert.strictEqual(items[1].text, 'Tags filter');
  assert.strictEqual(items[3].text, 'web#12 has a merge conflict');
});

test('a finished run asks nothing', () => {
  assert.deepStrictEqual(needsYou({ run: { ...run, stage: 'done', finished: true, waiting: 'old' } }), []);
});

test('a description folds when it runs past eight lines', () => {
  assert.strictEqual(isLongDescription('one\ntwo'), false);
  assert.strictEqual(isLongDescription(Array.from({ length: 9 }, () => 'line').join('\n')), true);
  assert.strictEqual(isLongDescription('x'.repeat(2000)), true);
  assert.strictEqual(isLongDescription(null), false);
});

test('answers in brackets at the end of the question become buttons', () => {
  assert.deepStrictEqual(splitChoices('Keep the tag filter? [Keep|Drop]'), { question: 'Keep the tag filter?', choices: ['Keep', 'Drop'] });
  assert.deepStrictEqual(splitChoices('Which base? [ develop | feat/V1-Playbook | main ]'), { question: 'Which base?', choices: ['develop', 'feat/V1-Playbook', 'main'] });
  assert.deepStrictEqual(splitChoices('Approve the plan?'), { question: 'Approve the plan?', choices: [] });
  assert.deepStrictEqual(splitChoices('See [this link] first'), { question: 'See [this link] first', choices: [] });
  assert.deepStrictEqual(needsYou({ run: { ...run, waiting: 'Keep it? [Keep|Drop]' } })[0], { id: 'question', kind: 'question', text: 'Keep it?', choices: ['Keep', 'Drop'] });
});

test('the Jira Acceptance Criteria field reads as one criterion per line without its marker', () => {
  assert.deepStrictEqual(jiraAcLines('- User can rename a folder\n\n* Rename is saved\n[ ] Empty name shows an error\n2) Works with search'), [
    'User can rename a folder', 'Rename is saved', 'Empty name shows an error', 'Works with search',
  ]);
  assert.deepStrictEqual(jiraAcLines(null), []);
  assert.deepStrictEqual(jiraAcLines('  \n '), []);
});

const base = {
  key: 'QRD-1510', title: '[FE] Expose Playbook folders', url: 'https://jira/browse/QRD-1510',
  acceptanceCriteria: '- Owner sees the rule\n- Allow is grey on the consent page (QRD-1307)\n- The MCP drawer greys its button (QRD-1312)',
  blockedBy: ['QRD-1307'], openToConfirm: null, figmaUrl: 'https://figma.com/file/x',
  summary: { current: true, testData: 'member tanpa rule', ui: true },
  decisions: [{ refKey: 'QRD-1312', action: 'reference' }], tcApproved: true, statuses: { 'QRD-1307': 'UAT CHECK' },
};

test('Siap dikerjain is 7 of 7 when every ticket the AC names is decided, nothing is open, and summary, data, TC and design are there', () => {
  const ready = ticketReadiness(base);
  assert.deepStrictEqual([ready.done, ready.total, ready.missing], [7, 7, []]);
  assert.deepStrictEqual(ready.items.map((item) => item.id), ['refs', 'open', 'summary', 'alone', 'data', 'tc', 'design']);
});

test('each missing readiness item says what is missing and links to where it gets fixed', () => {
  const ready = ticketReadiness({
    ...base, blockedBy: [], decisions: [], openToConfirm: 'Default rule off?', figmaUrl: null, tcApproved: false,
    summary: { current: true, testData: null, ui: false }, statuses: { 'QRD-1307': 'In Progress' },
  });
  assert.deepStrictEqual(ready.missing.map((item) => [item.id, item.text, item.href]), [
    ['refs', '2 rujukan tiket lain belum diputusin', '/planning?tab=draft&panel=ac'],
    ['open', 'Open to confirm masih ada isinya', 'https://jira/browse/QRD-1510'],
    ['alone', '2 tiket yang ditunggu AC belum di UAT', '#acceptance-criteria'],
    ['data', 'Data uji belum disebut', 'https://jira/browse/QRD-1510'],
    ['tc', 'Test case belum disetujui QA', '/planning?tab=draft&panel=tc'],
    ['design', 'Tiket UI tanpa link desain', 'https://jira/browse/QRD-1510'],
  ]);
  assert.strictEqual(ready.missing[2].detail, 'QRD-1307 (In Progress), QRD-1312 (status belum kebaca)');
  assert.strictEqual(ready.done, 1);
});

test('without a summary the summary item is missing and test data and UI say there is no summary yet; [FE] still means UI', () => {
  const none = ticketReadiness({ ...base, title: 'Expose Playbook folders', summary: null });
  assert.deepStrictEqual(none.missing.map((item) => [item.id, item.text]), [
    ['summary', 'Belum ada ringkasan'], ['data', 'Data uji: belum ada ringkasan'], ['design', 'Desain: belum ada ringkasan'],
  ]);
  assert.strictEqual(ticketReadiness({ ...base, summary: null }).items.find((item) => item.id === 'design')!.ok, true, '[FE] with a Figma link');
  assert.strictEqual(ticketReadiness({ ...base, summary: { ...base.summary, current: false } }).items[2].text, 'Ringkasan basi: AC berubah sesudah ringkasan ditulis');
  assert.strictEqual(hasUi('[BE] API'), false);
});

test('the board shows the readiness chip only in the TODO column, and reads every ref once', () => {
  const ready = ticketReadiness(base);
  assert.strictEqual(readinessOnBoard('TODO', ready), ready);
  assert.strictEqual(readinessOnBoard('IN PROGRESS', ready), null);
  assert.deepStrictEqual(readinessRefs([base, { key: 'QRD-1307', acceptanceCriteria: '- Needs QRD-1510 and QRD-1500' }]), ['QRD-1307', 'QRD-1312', 'QRD-1500', 'QRD-1510']);
  assert.strictEqual(inUat('UAT MERGED'), false);
  assert.strictEqual(inUat('Done / MERGED'), true);
});

test('Nyambung ke: Blocks links, mentions moved to Reference and undecided mentions', () => {
  const links = ticketLinks({ ...base, acceptanceCriteria: `${base.acceptanceCriteria}\n- Token rotates (QRD-1500)`, reference: '- QRD-1305: serve a folder over MCP' });
  assert.deepStrictEqual(links.map((link) => [link.key, link.kind]), [['QRD-1307', 'blocks'], ['QRD-1312', 'reference'], ['QRD-1500', 'open'], ['QRD-1305', 'reference']]);
  assert.strictEqual(ticketLinks({ key: 'QRD-1', acceptanceCriteria: '- x (QRD-2)', decisions: [{ refKey: 'QRD-2', action: 'dependency' }] })[0].kind, 'blocks');
});
