import assert from 'node:assert';
import test from 'node:test';
import { buildThinking, placeAt } from '../integrations/run-thinking';
import { normalizeDecisions } from '../integrations/orchestrator';

const at = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00Z`);
const visits = [
  { stageIndex: 2, round: 2, from: '2026-10-28T15:43:00Z', to: '2026-10-28T15:48:00Z' },
  { stageIndex: 3, round: 2, from: '2026-10-28T15:48:00Z', to: '2026-10-28T15:50:00Z' },
  { stageIndex: 4, round: 2, from: '2026-10-28T15:50:00Z', to: null },
];
const event = (id: string, kind: string, hhmm: string, detail: string | null = null) => ({ id, kind, detail, createdAt: at(hhmm) });

test('decisions read the asking agent, the question and the dropped options; old ledgers keep working', () => {
  const [withQuestion, old] = normalizeDecisions([
    { n: 28, at: '2026-10-28T15:43:50Z', text: 'Check the PR against the storyboard', by: 'sous-ticket-runner', question: 'What does "ok" approve?', rejected: [{ option: 'Mark ready now', why: 'D-20 is open' }, { option: '' }] },
    { n: 2, at: '2026-10-28T05:05:00Z', text: 'Build sandbox optional', by: 'sous', alts: [{ label: 'Hold', effect: 'delays 8 AC rows' }] },
  ]);
  assert.deepStrictEqual([withQuestion.author, withQuestion.by, withQuestion.question, withQuestion.rejected], ['sous-ticket-runner', null, 'What does "ok" approve?', [{ option: 'Mark ready now', why: 'D-20 is open' }]]);
  assert.deepStrictEqual([old.author, old.by, old.question, old.rejected], ['sous', 'sous', null, []]);
  const [stored] = normalizeDecisions(normalizeDecisions([{ n: 1, at: '2026-10-28T15:45:00Z', text: 'x', by: 'sous-ticket-runner' }]));
  assert.strictEqual(stored.author, 'sous-ticket-runner', 'the stored ledger is normalized again and keeps the agent');
});

test('every row names its agent, sits in its stage and round, and a release while sous worked is flagged', () => {
  const decisions = normalizeDecisions([
    { n: 28, at: '2026-10-28T15:43:50Z', text: 'Check the PR against the storyboard', by: 'lead', question: 'What does "ok" approve?', rejected: [{ option: 'Mark ready now', why: 'D-20 is open' }] },
    { n: 30, at: '2026-10-28T15:57:00Z', text: 'Record again', by: 'sous-ticket-runner', effect: 'video matches the PR', alts: [{ label: 'Keep the old video', effect: null }] },
  ]);
  const rows = buildThinking({
    decisions,
    issues: [],
    findings: [{ at: '2026-10-28T15:49:00Z', severity: 'nit', text: 'double tilde', resolvedAt: null, resolvedWhy: null }],
    events: [
      event('1', 'AGENT_ACTIVE', '15:43'),
      event('2', 'PR_READY', '15:44', '#1306 #1080'),
      event('3', 'STAGE', '15:50', 'evidence'),
      event('4', 'AGENT_IDLE', '16:17'),
      event('5', 'BROADCAST', '16:18', 'posted'),
      event('6', 'AGENT_TOOL', '15:45'),
    ],
    tools: [
      { kind: 'spawn', agentId: 'main', agentType: null, name: 'sous-video', detail: 'Re-record demo video', at: at('15:57') },
      { kind: 'stop', agentId: 'a1', agentType: 'sous-ticket-runner:sous-video', name: 'stop', detail: null, at: at('16:15') },
      { kind: 'stop', agentId: 'main', agentType: null, name: 'stop', detail: null, at: at('16:17') },
    ],
    git: [{ at: at('16:16'), agent: 'sous-publisher', text: 'git push origin feat/QRD-1268' }],
    visits,
  });
  assert.deepStrictEqual(rows.map((row) => [row.agent, row.kind, row.stageIndex]), [
    ['DOCK', 'event', 4], ['sous-publisher', 'event', 4], ['sous-video', 'did', 4], ['sous-ticket-runner', 'decide', 4], ['lead', 'did', 4],
    ['DOCK', 'event', 4], ['sous-reviewer', 'did', 3], ['DOCK', 'event', 2], ['lead', 'ask', 2],
  ]);
  const ask = rows.find((row) => row.kind === 'ask')!;
  assert.deepStrictEqual([ask.text, ask.answer, ask.options.map((option) => [option.label, option.chosen])], ['What does "ok" approve?', 'Check the PR against the storyboard', [['Check the PR against the storyboard', true], ['Mark ready now', false]]]);
  assert.strictEqual(rows.find((row) => row.text.startsWith('Marked ready'))?.flag, 'while sous was still working');
  assert.strictEqual(rows.find((row) => row.text.startsWith('Broadcast'))?.flag, null);
  assert.strictEqual(rows.find((row) => row.agent === 'sous-publisher')?.topic, 'git');
  assert.ok(!rows.some((row) => row.text.includes('AGENT_')));
});

test('a moment is placed in the visit it falls in, else the last visit that began before it', () => {
  assert.deepStrictEqual(placeAt('2026-10-28T15:49:00Z', visits), { stageIndex: 3, round: 2 });
  assert.deepStrictEqual(placeAt('2026-10-28T18:00:00Z', visits), { stageIndex: 4, round: 2 });
  assert.deepStrictEqual(placeAt('2026-10-28T10:00:00Z', visits), { stageIndex: 2, round: 2 });
});
