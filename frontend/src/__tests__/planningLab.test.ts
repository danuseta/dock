import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redoVisualPrompt, visualTime } from '../agents/planning';
import { chartPrompt, rewritePrompt, sheetPrompt, timelinePrompt, chatSuggestions } from '../chat/suggestions';
import { prefillStore } from '../chat/store';

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('a Planning chat shows the six chips on an empty session, and no Run sprint-planner once it has messages', () => {
  assert.deepStrictEqual(chatSuggestions('Planning-QRD Sprint 27', 0).map((item) => item.label), ['Run sprint-planner', 'Draft tickets from a sheet', 'Rewrite a ticket', 'Humanize a ticket', 'Chart SP per dev', 'Timeline per dev']);
  assert.deepStrictEqual(chatSuggestions('Planning-QRD Sprint 27', 4).map((item) => item.label), ['Draft tickets from a sheet', 'Rewrite a ticket', 'Humanize a ticket', 'Chart SP per dev', 'Timeline per dev']);
  assert.strictEqual(chatSuggestions('Planning-QRD Sprint 27', 4)[0].text, sheetPrompt('QRD Sprint 27'));
  assert.strictEqual(sheetPrompt('QRD Sprint 27'), 'Draft tickets for sprint "QRD Sprint 27" from this sheet: <paste the sheet link>', 'the chip only fills the prompt; the planner pastes the link');
  assert.strictEqual(chatSuggestions('Planning-QRD Sprint 27', 0)[0].text, null, 'the planner prompt comes from DOCK, with the epics of the draft');
  assert.strictEqual(chatSuggestions('Planning-QRD Sprint 27', 0)[2].text, rewritePrompt('QRD Sprint 27'));
  assert.strictEqual(rewritePrompt('QRD Sprint 27'), 'Rewrite <paste ticket keys> for sprint "QRD Sprint 27": read the ticket, its Discord thread and the code, and save a revision for me to review.', 'the chip only fills the prompt; the planner pastes the keys');
  assert.strictEqual(chatSuggestions('Planning-QRD Sprint 27', 0)[4].text, chartPrompt('QRD Sprint 27'));
  assert.strictEqual(chatSuggestions('Planning-QRD Sprint 27', 0)[5].text, timelinePrompt('QRD Sprint 27'));
  assert.match(chartPrompt('QRD Sprint 27'), /sprint "QRD Sprint 27"/, 'the agent knows the sprint without reading the session title');
  assert.match(timelinePrompt('QRD Sprint 27'), /sprint "QRD Sprint 27"/);
});

test('any other chat gets no chips', () => {
  for (const title of ['Retro-QRD Sprint 27', 'Plan-QRD Sprint 27', 'planning-x', '', null, undefined, 'Planning-']) {
    assert.deepStrictEqual(chatSuggestions(title, 0), [], String(title));
  }
});

test('a chip fills the message box and never sends', () => {
  const chips = source('../chat/PlanningSuggestions.tsx');
  assert.doesNotMatch(chips, /sendMessage|SEND_CHAT|onSend|useMutation/, 'the chips cannot send');
  assert.match(chips, /onPick\(suggestion\.text\)/);
  assert.match(chips, /GET_PLANNING_CHAT_PROMPT/);
  const thread = source('../chat/ChatThread.tsx');
  assert.match(thread, /<PlanningSuggestions title=\{session\?\.title\} messageCount=\{messages\.length\} onPick=\{\(text\) => setSeed\(\{ text \}\)\} \/>\}\s*<Composer/, 'the chips sit right above the message box');
  const composer = source('../chat/composer/Composer.tsx');
  assert.match(composer, /setDraft\(seed\.text\);\s*textarea\.current\?\.focus\(\);/, 'a seed fills the box and focuses it');
});

test('the chat store hands a prefill to its session once and keeps it out of the saved state', () => {
  const seen: Array<string | null> = [];
  const stop = prefillStore.subscribe(() => seen.push(prefillStore.getSnapshot()?.text ?? null));
  prefillStore.set('s1', 'Redo the visual');
  assert.deepStrictEqual(prefillStore.getSnapshot(), { sessionId: 's1', text: 'Redo the visual' });
  prefillStore.clear('other');
  assert.strictEqual(prefillStore.getSnapshot()?.text, 'Redo the visual', 'another session cannot clear it');
  prefillStore.clear('s1');
  assert.strictEqual(prefillStore.getSnapshot(), null);
  stop();
  assert.deepStrictEqual(seen, ['Redo the visual', null]);
  assert.doesNotMatch(source('../chat/store.ts').split('export function parseChatState')[1].split('const read =')[0], /prefill/, 'the prefill is not persisted');
});

test('Planning has no Test cases tab, and the backend test case support is still there', () => {
  const tab = source('../agents/PlanningTab.tsx');
  assert.doesNotMatch(tab, /Test cases|TcPanel|TcTicket|onSaveTcs|SET_SPRINT_DRAFT_TCS/);
  assert.match(tab, /\['ac', 'AC check'\], \['storyboard', 'Storyboard'\], \['order', 'Order'\], \['new', 'Tickets'\]\];/);
  assert.doesNotMatch(tab, /QaPanel|QA check|onRefreshQa|ESCALATED/);
  assert.match(source('../agents/planning.ts'), /export type PlanningPanel = 'mine' \| 'team' \| 'scope' \| 'ac' \| 'qa' \| 'tc' \| 'storyboard' \| 'order' \| 'new';/);
  assert.match(source('../graphql/queries.ts'), /setSprintDraftTcs/);
});

test('each visual is a tab after Storyboard, polled with the draft, in a sandboxed frame with Save, Discard and a redo button', () => {
  const tab = source('../agents/PlanningTab.tsx');
  assert.match(tab, /GET_SPRINT_DRAFT_VISUALS[\s\S]{0,200}pollInterval: 10000/);
  assert.ok(tab.indexOf("['storyboard', 'Storyboard']") < tab.indexOf('{visuals.map((visual) => ('), 'visual tabs come after the fixed tabs');
  assert.match(tab, /\{visual\.title\}/);
  assert.match(tab, /openChat\(redoVisualPrompt\(openVisual\.title\)\)/);
  const frame = source('../agents/PlanningVisual.tsx');
  assert.match(frame, /sandbox="allow-scripts"/);
  assert.doesNotMatch(frame, /allow-same-origin/);
  assert.match(frame, /The draft changed after this was made\. The numbers may be out of date\./);
  assert.match(frame, /Ask the agent to redo it/);
  assert.match(frame, /Snapshot \{visualTime\(visual\.createdAt\)\} · from chat/);
  assert.match(frame, /Save/);
  assert.match(frame, /Discard/);
  assert.match(frame, /visual\.stale &&/);
});

test('the redo prompt names the visual, and the snapshot time reads as a clock time today', () => {
  assert.strictEqual(redoVisualPrompt('SP per dev'), "Redo the visual 'SP per dev' with the current draft.");
  const now = new Date(2026, 10, 18, 15, 0);
  assert.strictEqual(visualTime(new Date(2026, 10, 18, 12, 41).toISOString(), now), '12:41');
  assert.match(visualTime(new Date(2026, 10, 17, 12, 41).toISOString(), now), /^17 Nov, 12:41$/);
  assert.strictEqual(visualTime('nope', now), '');
});

test('the Planning chat only fills its message box: the redo button and the chips go through the store and never send', () => {
  const hook = source('../agents/usePlanningChat.ts');
  assert.match(hook, /open = async \(prefill\?: string\)/);
  assert.match(hook, /chatStore\.prefill\(target, prefill\)/);
  assert.doesNotMatch(hook, /sendMessage/);
});
