import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PROFILE, SOUS_STAGES, afterOf, allRun, continueText, defaultSettings, newProfileName, parseSettings, removeProfile, renameProfile, setAfter, setRuns, stageAfterStop, startsSous, withProfile,
} from '../lib/sousFlow';
import { sessionProfileName, withFlowLines } from '../chat/composer/sessionFlow';

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('the editor lists the 15 sous stages from the ticket to the Jira status, Decisions required', () => {
  assert.deepEqual(SOUS_STAGES.map((stage) => stage.id), ['jira', 'block', 'park', 'plan', 'code', 'loop', 'verify', 'final', 'video', 'publish', 'decide', 'discord', 'qa', 'review', 'status']);
  assert.equal(SOUS_STAGES.find((stage) => stage.id === 'decide')?.required, true);
});

test('nothing saved means every stage runs and goes on, checkpoints on, QA guide off', () => {
  for (const raw of [null, '', '{', '[]']) assert.deepEqual(parseSettings(raw), defaultSettings(), String(raw));
  const settings = parseSettings(null);
  assert.equal(settings.checkpoint, true);
  assert.equal(settings.qaGuide, false);
  assert.deepEqual(settings.profiles[DEFAULT_PROFILE], allRun());
});

test('Decisions cannot be skipped, but it can be the stop point; ask first and stop are one choice per stage', () => {
  const profile = allRun();
  assert.deepEqual(setRuns(profile, 'decide', false), profile, 'Decisions stays');
  assert.deepEqual(setRuns(profile, 'video', false).skip, ['video']);
  const stopped = setAfter(profile, 'decide', 'stop');
  assert.equal(stopped.stop, 'decide');
  assert.equal(afterOf(stopped, 'decide'), 'stop');
  const asked = setAfter(stopped, 'plan', 'ask');
  assert.deepEqual(asked.ask, ['plan']);
  assert.equal(setAfter(asked, 'decide', 'go').stop, 'status', 'taking the stop off a stage runs to the end');
  assert.deepEqual(setRuns(asked, 'plan', false), asked, 'a required stage cannot be skipped');
  assert.deepEqual(setRuns(setAfter(profile, 'video', 'ask'), 'video', false).ask, [], 'a skipped stage is not asked about');
});

test('Lanjut after a stop sends "Lanjut dari <tahap>" for the next stage that runs', () => {
  const next = stageAfterStop({ skip: ['publish'], ask: [], stop: 'video' });
  assert.equal(next?.id, 'decide');
  assert.equal(continueText(next!), 'Lanjut dari Decisions');
  assert.equal(stageAfterStop(allRun()), null);
});

test('profiles can be added, renamed and removed; Default stays', () => {
  const settings = withProfile(defaultSettings(), 'Sampai video demo', { skip: [], ask: [], stop: 'video' });
  assert.equal(newProfileName(settings), 'Profil baru 1');
  const renamed = renameProfile({ ...settings, mine: 'Sampai video demo' }, 'Sampai video demo', 'Video');
  assert.ok(renamed?.profiles.Video);
  assert.equal(renamed?.mine, 'Video');
  assert.equal(renameProfile(settings, DEFAULT_PROFILE, 'Other'), null);
  assert.equal(renameProfile(settings, 'Sampai video demo', DEFAULT_PROFILE), null);
  const removed = removeProfile({ ...settings, mine: 'Sampai video demo' }, 'Sampai video demo');
  assert.equal(removed.mine, DEFAULT_PROFILE);
  assert.deepEqual(removeProfile(settings, DEFAULT_PROFILE), settings);
});

test('a session runs its picked profile, else the ticket\'s, else the person\'s own; only a sous start gets the lines', () => {
  const settings = { ...withProfile(withProfile(defaultSettings(), 'Plan', { skip: [], ask: [], stop: 'plan' }), 'Video', { skip: [], ask: [], stop: 'video' }), mine: 'Video' };
  assert.equal(sessionProfileName(settings, 'Plan', null), 'Plan');
  assert.equal(sessionProfileName(settings, null, 'Plan'), 'Plan');
  assert.equal(sessionProfileName(settings, 'Gone', null), 'Video');
  assert.ok(startsSous('Pakai skill sous: kerjakan QRD-1534'));
  assert.ok(!startsSous('Lanjut dari Publish'));
  assert.equal(withFlowLines('Pakai skill sous: kerjakan QRD-1', settings.profiles.Plan, ['Sous flow: stop after plan.']), 'Pakai skill sous: kerjakan QRD-1\nSous flow: stop after plan.');
  assert.equal(withFlowLines('Pakai skill sous: kerjakan QRD-1', allRun(), ['x']), 'Pakai skill sous: kerjakan QRD-1', 'a flow where every stage runs adds nothing');
  assert.equal(withFlowLines('Explain this repo', settings.profiles.Plan, ['x']), 'Explain this repo');
});

test('the section has the checkpoint switch, the QA guide switch under Video demo and the prompt preview', () => {
  const section = source('../settings/sections/SousFlowSection.tsx');
  assert.match(section, /Kirim checkpoint/);
  assert.match(section, /selected === 'video'[\s\S]*Tulis QA guide ke Developer Context/);
  assert.match(section, /GET_SOUS_FLOW_PROMPT/);
  assert.match(source('../pages/SettingsPage.tsx'), /active === 'sousflow' && <SousFlowSection \/>/);
});
