import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLOW_TEMPLATES, applyTemplate, defaultFlow, parseFlow, skippedStages, updateStage } from '../agents/planningFlow';

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('no saved flow runs all eight stages, as Planning did before the setting', () => {
  for (const raw of [null, undefined, '', '{', '{"stages":"x"}']) {
    const flow = parseFlow(raw);
    assert.deepEqual(flow.stages.map((stage) => stage.id), ['load', 'scope', 'ac', 'qa', 'tc', 'storyboard', 'contract', 'publish']);
    assert.equal(skippedStages(flow).size, 0, String(raw));
  }
  assert.equal(skippedStages(null).size, 0);
});

test('a saved flow keeps its owners and skips, but Load and Publish always run', () => {
  const flow = parseFlow(JSON.stringify({ template: 'Tanpa QA', stages: [{ id: 'qa', skip: true, approve: true }, { id: 'load', skip: true }, { id: 'scope', owner: 'PO', approve: true }, { id: 'tc', owner: 'Someone' }] }));
  assert.equal(flow.template, 'Tanpa QA');
  assert.deepEqual([...skippedStages(flow)], ['qa']);
  assert.deepEqual(flow.stages.find((stage) => stage.id === 'qa'), { id: 'qa', skip: true, owner: 'QA', approve: false });
  assert.deepEqual(flow.stages.find((stage) => stage.id === 'scope'), { id: 'scope', skip: false, owner: 'PO', approve: true });
  assert.equal(flow.stages.find((stage) => stage.id === 'tc')!.owner, 'QA', 'an unknown role falls back to the default owner');
});

test('three templates; a template keeps the owners, a change by hand leaves the template', () => {
  assert.deepEqual(FLOW_TEMPLATES.map((template) => template.name), ['Lengkap', 'Tanpa QA', 'Cuma scope + publish']);
  const owned = updateStage(defaultFlow(), 'scope', { owner: 'PO' });
  const short = applyTemplate(owned, 'Cuma scope + publish');
  assert.deepEqual([...skippedStages(short)], ['ac', 'qa', 'tc', 'storyboard', 'contract']);
  assert.equal(short.stages.find((stage) => stage.id === 'scope')!.owner, 'PO');
  assert.equal(short.template, 'Cuma scope + publish');
  const edited = updateStage(short, 'publish', { skip: true, approve: true });
  assert.equal(edited.template, null);
  assert.deepEqual(edited.stages.find((stage) => stage.id === 'publish'), { id: 'publish', skip: false, owner: 'Planner', approve: true });
  assert.equal(updateStage(edited, 'scope', { skip: true }).stages.find((stage) => stage.id === 'scope')!.approve, false, 'a skipped stage needs no approval');
});

test('Planning Draft hides the panel of a skipped stage and the settings page renders Planning flow', () => {
  assert.match(source('../agents/PlanningTab.tsx'), /const panels = PANELS\.filter\(\(\[id\]\) => id === 'team' \|\| id === 'mine' \|\| !skipped\.has\(id\)\);/);
  assert.match(source('../pages/SettingsPage.tsx'), /\{active === 'planflow' && <PlanningFlowSection \/>\}/);
});
