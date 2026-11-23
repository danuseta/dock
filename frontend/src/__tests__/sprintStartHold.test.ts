import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { holdSteps, type PlanSignal } from '../agents/planning';
import { orderSourceLabel, suggestionDiffers, type SprintPlan } from '../agents/plan';
import { readHoldNewSprint } from '../lib/opsRules';
import { orderSourceText, orderText, previewSummary, waitsText, type SprintStartPreview } from '../lib/sprintStart';
import { breakdown, gb, memoryPercent, memoryTight, newOomKills, sparkline } from '../lib/workspaceResources';

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const signal = (stage: PlanSignal['stage']) => ({ stage });
const preview = (over: Partial<SprintStartPreview> = {}): SprintStartPreview => ({ slots: 3, parallel: 3, parked: [], first: [{ key: 'QRD-1579', title: 'a', order: 1, orderSource: 'jira', waitsOn: null }], blocked: [], next: [], ...over });

test('the hold rule reads on by default and off only when saved off', () => {
  assert.deepEqual(readHoldNewSprint(null), { enabled: true });
  assert.deepEqual(readHoldNewSprint('{"enabled":false}'), { enabled: false });
  assert.deepEqual(readHoldNewSprint('bad'), { enabled: true });
});

test('the stepper: with the hold on a running sprint waits for start until started; off, it stays Draft > Published > Running', () => {
  assert.deepEqual(holdSteps(signal('running'), { holdOn: false, held: false }), { steps: ['Draft', 'Published', 'Running'], current: 2 });
  assert.deepEqual(holdSteps(signal('running'), { holdOn: true, held: true }), { steps: ['Draft', 'Published', 'Waiting for start', 'Running'], current: 2 });
  assert.equal(holdSteps(signal('running'), { holdOn: true, held: false }).current, 3);
  assert.equal(holdSteps(signal('published'), { holdOn: true, held: true }).current, 1);
  assert.equal(holdSteps(null, null).current, 0);
});

test('the start preview texts: slots and where the order comes from, what a blocked ticket waits on', () => {
  assert.equal(previewSummary(preview()), '3 slots · order from Jira #N');
  assert.equal(previewSummary(preview({ slots: 1, first: [{ key: 'QRD-1', title: '', order: 2, orderSource: 'owner', waitsOn: null }] })), '1 slot · order: yours');
  assert.equal(orderSourceText(preview({ first: [], next: [{ key: 'QRD-9', title: '', order: null, orderSource: null, waitsOn: null }] })), 'order: ticket number');
  assert.equal(orderText({ order: 14 }), '#14');
  assert.equal(orderText({ order: null }), '');
  assert.equal(waitsText({ waitsOn: 'QRD-1579' }), 'waits on QRD-1579');
  assert.equal(waitsText({ waitsOn: 'pending' }), 'waits for your call on a proposed dependency');
});

test('the Order tab: a suggestion only counts when it differs from the order now, and each row says where its number comes from', () => {
  const ticket = (key: string, position: number) => ({ key, title: key, status: 'To Do', position, order: position, orderSource: 'jira', suggestedPosition: null, held: false, edges: [] });
  const plan = (suggestedOrder: string[]): Pick<SprintPlan, 'suggestedOrder' | 'tickets'> => ({ suggestedOrder, tickets: [ticket('QRD-1', 1), ticket('QRD-2', 2)] });
  assert.equal(suggestionDiffers(plan([])), false);
  assert.equal(suggestionDiffers(plan(['QRD-1', 'QRD-2'])), false);
  assert.equal(suggestionDiffers(plan(['QRD-2', 'QRD-1'])), true);
  assert.equal(orderSourceLabel({ order: 14, orderSource: 'jira' }), 'Jira #14');
  assert.equal(orderSourceLabel({ order: 2, orderSource: 'owner' }), 'Yours #2');
  assert.equal(orderSourceLabel({ order: null, orderSource: null }), '');
});

test('workspace resources: gigabytes, the memory share and tone, the per-kind breakdown and the sparkline scale', () => {
  const GB = 1024 ** 3;
  const memory = { current: 11.5 * GB, max: 12 * GB, anon: null, samples: [{ at: 'a', bytes: 6 * GB }, { at: 'b', bytes: 12 * GB }] };
  assert.equal(gb(10.3 * GB), '10.3');
  assert.equal(memoryPercent(memory), 96);
  assert.equal(memoryTight(memory), true);
  assert.equal(memoryPercent({ ...memory, max: null }), null);
  assert.equal(breakdown({ kinds: [{ kind: 'claude', bytes: 0.4 * GB, count: 1 }, { kind: 'mcp', bytes: 0.6 * GB, count: 8 }] }), 'Claude 0.4 · MCP 0.6');
  const line = sparkline(memory);
  assert.equal(line.points, '0.0,36.0 200.0,2.0');
  assert.equal(line.limitY, 2);
  assert.equal(line.low, 6 * GB);
});

test('an OOM kill is announced once per increase; the first look only remembers', () => {
  assert.deepEqual(newOomKills(null, 9).events, []);
  assert.deepEqual(newOomKills(9, 9).events, []);
  const { seen, events } = newOomKills(9, 10);
  assert.equal(seen, 10);
  assert.deepEqual(events.map((event) => [event.event, event.title]), [['needsYou', 'Workspace ran out of memory']]);
});

test('Home: the resources card on the workspace DOCK only, polling every 5 s while visible; the start card with the Start button', () => {
  const home = source('../pages/HomePage.tsx');
  assert.match(home, /\{mode === 'workspace' && <WorkspaceResourcesCard /);
  assert.match(home, /<SprintStartCard /);
  const card = source('../components/WorkspaceResourcesCard.tsx');
  assert.match(card, /pollInterval: visible \? RESOURCES_POLL_MS : 0, skip: !visible/);
  assert.match(card, /Left running for a ticket not in progress/);
  const start = source('../components/SprintStart.tsx');
  assert.match(start, /is ready to start/);
  assert.match(start, /if \(!view\?\.held\) return null;/);
  assert.match(source('../settings/sections/RulesCard.tsx'), /Hold a new sprint until I start it/);
  assert.match(source('../agents/PlanningTab.tsx'), /<SprintHoldBar view=\{sprintStart\.view\}/);
});
