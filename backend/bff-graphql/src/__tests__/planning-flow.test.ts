import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAN_STAGE_IDS, defaultPlanningFlow, parsePlanningFlow, storedPlanningFlow } from '../integrations/planning-flow';

test('no saved flow runs every stage with its usual owner, as before the setting', () => {
  const flow = defaultPlanningFlow();
  assert.deepEqual(flow.stages.map((stage) => stage.id), [...PLAN_STAGE_IDS]);
  assert.ok(flow.stages.every((stage) => !stage.skip && !stage.approve));
  assert.deepEqual(flow.stages.map((stage) => stage.owner), ['DOCK', 'Planner', 'Planner', 'QA', 'QA', 'PO', 'PO', 'Planner']);
  assert.equal(storedPlanningFlow(null), null);
  assert.equal(storedPlanningFlow(''), null);
  assert.equal(storedPlanningFlow('{'), null, 'a flow that no longer reads counts as none');
});

test('a saved flow keeps the stage order, fills stages it leaves out and drops approve on a skipped stage', () => {
  const flow = parsePlanningFlow(JSON.stringify({
    template: ' Tanpa QA ',
    stages: [{ id: 'tc', skip: true, approve: true }, { id: 'qa', skip: true }, { id: 'publish', owner: 'PO', approve: true }],
  }));
  assert.equal(flow.template, 'Tanpa QA');
  assert.deepEqual(flow.stages.map((stage) => [stage.id, stage.skip, stage.owner, stage.approve]), [
    ['load', false, 'DOCK', false], ['scope', false, 'Planner', false], ['ac', false, 'Planner', false], ['qa', true, 'QA', false],
    ['tc', true, 'QA', false], ['storyboard', false, 'PO', false], ['contract', false, 'PO', false], ['publish', false, 'PO', true],
  ]);
  assert.equal(JSON.parse(storedPlanningFlow(JSON.stringify(flow))!).stages.length, 8);
});

test('load and publish cannot be skipped, and a wrong value is refused', () => {
  assert.throws(() => parsePlanningFlow(JSON.stringify({ stages: [{ id: 'load', skip: true }] })), /load cannot be skipped/);
  assert.throws(() => parsePlanningFlow(JSON.stringify({ stages: [{ id: 'publish', skip: true }] })), /publish cannot be skipped/);
  for (const [raw, error] of [
    ['{', /not valid JSON/], ['[]', /must be an object/], ['{}', /stages must be a list/], ['{"stages":[{"id":"deploy"}]}', /Unknown stage deploy/],
    ['{"stages":[{"id":"qa"},{"id":"qa"}]}', /listed twice/], ['{"stages":[{"id":"qa","skip":"yes"}]}', /qa.skip/],
    ['{"stages":[{"id":"qa","owner":"Alvin"}]}', /qa.owner must be one of DOCK, Planner, QA, PO/], ['{"template":3,"stages":[]}', /template must be text/],
  ] as Array<[string, RegExp]>) {
    assert.throws(() => parsePlanningFlow(raw), error, raw);
  }
});
