import assert from 'node:assert';
import test from 'node:test';
import {
  DEFAULT_PROFILE, SOUS_STAGE_IDS, SousFlowError, allRunProfile, defaultSousFlow, flowLines, parseProfile, parseSousFlow, profileFor, readSousFlow,
} from '../integrations/sous-flow';
import { sousConfirmedPrompt, sousStartPrompt } from '../integrations/orchestrator-cron';

const TODAY_START = 'Pakai skill sous: kerjakan QRD-7. Cron run: no GATE 1; work through to an opened pull request (draft when the ledger has draft=true) and make the demo video before the pull request. Follow rules/ticket-contract.md: find and read the Confluence contract for this ticket before writing code; if a contract is found but cannot be read, stop and report why. Before you finish, save a session note with brain.py save. Do not end your turn while a subagent you started is still running: run members in the foreground, or wait for the result of every member you started in the background before you end the turn. Write chat replies, reports and summaries in Bahasa Indonesia; code, comments, commit messages and pull request text stay in English.';
const TODAY_CONFIRMED = 'Pakai skill sous: kerjakan QRD-7. Follow rules/ticket-contract.md: find and read the Confluence contract for this ticket before writing code; if a contract is found but cannot be read, stop and report why. Before you finish, save a session note with brain.py save. Do not end your turn while a subagent you started is still running: run members in the foreground, or wait for the result of every member you started in the background before you end the turn. Write chat replies, reports and summaries in Bahasa Indonesia; code, comments, commit messages and pull request text stay in English.';

test('the stage list follows the kit from picking the ticket to the Jira status, Decisions between Publish and Discord', () => {
  assert.deepStrictEqual([...SOUS_STAGE_IDS], ['jira', 'block', 'park', 'plan', 'code', 'loop', 'verify', 'final', 'video', 'publish', 'decide', 'discord', 'qa', 'review', 'status']);
});

test('with nothing saved every stage runs and goes on, checkpoints are on and the QA guide is off', () => {
  const flow = readSousFlow(null);
  assert.deepStrictEqual(flow, defaultSousFlow());
  assert.deepStrictEqual(flow.profiles[DEFAULT_PROFILE], { skip: [], ask: [], stop: 'status' });
  assert.strictEqual(flow.checkpoint, true);
  assert.strictEqual(flow.qaGuide, false);
  assert.strictEqual(flow.qaGuideField, 'customfield_10340');
  assert.deepStrictEqual(readSousFlow('{not json'), defaultSousFlow(), 'an unreadable setting falls back to the defaults');
});

test('the default flow adds no line, so the sous prompts are byte for byte as today', () => {
  assert.deepStrictEqual(flowLines(allRunProfile()), []);
  const lines = flowLines(profileFor(defaultSousFlow(), null).profile);
  assert.strictEqual(sousStartPrompt('QRD-7', null, lines), TODAY_START);
  assert.strictEqual(sousConfirmedPrompt('QRD-7', null, lines), TODAY_CONFIRMED);
  assert.strictEqual(sousStartPrompt('QRD-7'), TODAY_START);
});

test('Decisions and the other required stages cannot be skipped; the stop point must run', () => {
  for (const id of ['decide', 'jira', 'plan', 'code', 'loop']) {
    assert.throws(() => parseProfile({ skip: [id] }, 'p'), SousFlowError, `${id} is required`);
  }
  assert.throws(() => parseProfile({ skip: ['video'], stop: 'video' }, 'p'), /cannot be skipped/);
  assert.throws(() => parseProfile({ stop: 'nowhere' }, 'p'), /Unknown stop stage/);
  assert.throws(() => parseProfile({ ask: ['later'] }, 'p'), /Unknown stage/);
  assert.deepStrictEqual(parseProfile({ stop: 'decide' }, 'p'), { skip: [], ask: [], stop: 'decide' }, 'Decisions can be the stop point');
  assert.deepStrictEqual(parseProfile({ skip: ['qa', 'video'], ask: ['video', 'plan', 'plan'] }, 'p'), { skip: ['video', 'qa'], ask: ['plan'], stop: 'status' }, 'a skipped stage is not asked about');
});

test('settings parse every field and keep the Default profile', () => {
  const flow = parseSousFlow(JSON.stringify({ profiles: { 'Sampai video demo': { skip: ['qa'], ask: ['plan'], stop: 'video' } }, mine: 'Sampai video demo', checkpoint: false, qaGuide: true, qaGuideField: 'customfield_10999' }));
  assert.deepStrictEqual(Object.keys(flow.profiles).sort(), [DEFAULT_PROFILE, 'Sampai video demo']);
  assert.strictEqual(flow.mine, 'Sampai video demo');
  assert.strictEqual(flow.checkpoint, false);
  assert.strictEqual(flow.qaGuide, true);
  assert.strictEqual(flow.qaGuideField, 'customfield_10999');
  assert.strictEqual(parseSousFlow(JSON.stringify({ mine: 'Gone' })).mine, DEFAULT_PROFILE, 'a profile that does not exist falls back to Default');
  assert.throws(() => parseSousFlow(JSON.stringify({ checkpoint: 'yes' })), /checkpoint must be true or false/);
  assert.throws(() => parseSousFlow(JSON.stringify({ qaGuideField: 'description' })), /qaGuideField/);
  assert.throws(() => parseSousFlow('[]'), /must be an object/);
});

test('a ticket runs its own profile, else the person\'s own one', () => {
  const flow = parseSousFlow(JSON.stringify({ profiles: { Mine: { stop: 'publish' }, Plan: { stop: 'plan' } }, mine: 'Mine' }));
  assert.strictEqual(profileFor(flow, 'Plan').name, 'Plan');
  assert.strictEqual(profileFor(flow, null).name, 'Mine');
  assert.strictEqual(profileFor(flow, 'Deleted').name, 'Mine');
});

test('skip, ask first and stop become plain prompt lines', () => {
  const lines = flowLines({ skip: ['video', 'qa'], ask: ['plan'], stop: 'publish' });
  assert.deepStrictEqual(lines, [
    'Sous flow: skip make the demo video (instead record a GUESS "no video").',
    'Sous flow: after "plan the tasks (sous-planner)", write a checkpoint and wait for the owner to say go on before the next stage.',
    'Sous flow: stop after "commit, push and open the pull request (sous-publisher)": write the last checkpoint and end the run. Do not mark the PR ready; do not post the summary to Discord; do not run local QA on the PR; do not review the PR; do not move the Jira status after merge.',
  ]);
  assert.match(sousStartPrompt('QRD-7', null, lines), /stay in English\. Sous flow: skip make the demo video/, 'the lines come after the usual prompt');
  assert.deepStrictEqual(flowLines({ skip: ['qa'], ask: [], stop: 'status' }), ['Sous flow: skip run local QA on the PR.']);
});
