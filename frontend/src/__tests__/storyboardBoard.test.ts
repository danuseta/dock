import assert from 'node:assert/strict';
import test from 'node:test';
import type { DraftTicket, StoryboardFlow, StoryboardScenario, StoryboardState } from '../agents/planning';
import { changedFlowCount, flowTickets, versionLabel, visibleGroups } from '../agents/storyboardLogic';

const flow = (id: string, tickets: string[], changed = false): StoryboardFlow => ({ id, title: `Flow ${id}`, tickets, info: [], frames: [{ index: 0, title: 'One', step: null, changed }], changed });
const scenario: StoryboardScenario = {
  n: 1, title: 'Organise',
  groups: [
    { title: 'Folder', flows: [flow('F1.1', ['QRD-1279'], true), flow('F1.1b', ['QRD-9999'])] },
    { title: 'Share', flows: [flow('F1.4g', [], true)] },
  ],
};
const ticket = (key: string, frames: string[] = []): DraftTicket => ({
  key, summary: key, dev: 'Danu', jiraDev: 'Danu', sp: 3, wave: 1, waveSet: false, status: 'To Do', ac: [], dependsOn: [], start: 0, dur: 1, end: 1, inSprint: true, split: null,
  prediction: null, qaDecision: null, epic: 'QRD-1233', frames, storyboard: frames.length ? { version: 2, frames, held: true, checked: null } : null,
  tcs: [], tcStale: false, tcPending: false, merge: 'open', pulls: [], jiraAhead: false,
});

test('a flow holds the tickets it lists and the sprint tickets its change flagged from their AC', () => {
  const tickets = [ticket('QRD-1279'), ticket('QRD-1300', ['F1.4g'])];
  assert.deepEqual(flowTickets(scenario.groups[0].flows[0], tickets), ['QRD-1279']);
  assert.deepEqual(flowTickets(scenario.groups[1].flows[0], tickets), ['QRD-1300']);
});

test('"only flows with this sprint\'s tickets" keeps flows holding an open ticket and drops empty groups', () => {
  const tickets = [ticket('QRD-1279')];
  assert.deepEqual(visibleGroups(scenario, tickets, false).map((group) => group.flows.map((item) => item.id)), [['F1.1', 'F1.1b'], ['F1.4g']]);
  assert.deepEqual(visibleGroups(scenario, tickets, true).map((group) => [group.title, group.flows.map((item) => item.id)]), [['Folder', ['F1.1']]]);
  assert.deepEqual(visibleGroups(undefined, tickets, true), []);
});

test('changed flows are counted across scenarios, and an upload version reads with its date', () => {
  const board = { epic: 'QRD-1233', scenarios: [scenario, { ...scenario, n: 2 }] } as StoryboardState;
  assert.equal(changedFlowCount(board), 4);
  assert.equal(changedFlowCount(undefined), 0);
  assert.equal(versionLabel(8), 'v8');
  assert.match(versionLabel(1762761600), /^v1762761600 · /);
  assert.equal(versionLabel(null), 'no version');
});
