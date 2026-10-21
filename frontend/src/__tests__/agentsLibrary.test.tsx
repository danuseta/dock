import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentLook } from '../chat/activity/transcript';
import { AgentAvatar } from '../chat/activity/TranscriptParts';
import { useAgentLooksStore } from '../stores/useAgentLooksStore';
import { LookAvatar } from '../agents/library/LookAvatar';
import { agentInput, diffCounts, filterAgents, filterCounts, formProblem, newForm, saveState, type LibraryAgent } from '../agents/library/libraryLogic';

const agent = (slug: string, over: Partial<LibraryAgent> = {}): LibraryAgent => ({
  slug, source: 'kit', description: `${slug} description`, model: 'sonnet', tools: ['Read'], guardProfile: null, hasHooks: true, dispatchable: true,
  locked: { slug: true, tools: true, hooks: true }, ...over,
});

test('agentLook takes a saved look first and fills what it leaves out from LOOK', () => {
  assert.deepEqual(agentLook('sous-verifier'), { initials: 'V', color: '#62cf9f' }, 'no saved look: the LOOK map');
  assert.deepEqual(agentLook('sous-verifier', { 'sous-verifier': { initials: 'Vf', color: '#123456', avatarUrl: 'https://dock.test/a.png' } }), { initials: 'Vf', color: '#123456', avatarUrl: 'https://dock.test/a.png' });
  assert.deepEqual(agentLook('oh-my-claudecode:sous-verifier', { 'sous-verifier': { initials: null, color: null, avatarUrl: null } }), { initials: 'V', color: '#62cf9f' }, 'empty fields fall back');
  assert.deepEqual(agentLook('toString', {}), agentLook('toString'), 'object keys are not looks');
});

test('saved looks reach agentLook with the avatar on the API origin, and an avatar shows the image', () => {
  useAgentLooksStore.getState().setRows([{ slug: 'qonflo-copy-checker', displayName: 'Copy checker', initials: 'Cc', color: '#c39cf2', avatarUrl: '/api/agent-looks/qonflo-copy-checker/avatar?v=1' }], 'https://dock.test');
  const look = agentLook('qonflo-copy-checker', useAgentLooksStore.getState().looks);
  assert.deepEqual(look, { initials: 'Cc', color: '#c39cf2', avatarUrl: 'https://dock.test/api/agent-looks/qonflo-copy-checker/avatar?v=1' });
  assert.match(renderToStaticMarkup(<LookAvatar initials={look.initials} color={look.color} src={look.avatarUrl} size="md" />), /<img src="https:\/\/dock\.test\/api\/agent-looks\/qonflo-copy-checker\/avatar\?v=1"/);
  assert.match(renderToStaticMarkup(<AgentAvatar name="sous-verifier" />), />V</, 'without a saved look the initials stay');
  useAgentLooksStore.getState().setRows([], 'https://dock.test');
});

test('an agent without a guard profile is saved as a draft runners cannot dispatch', () => {
  const form = { ...newForm(), slug: 'qonflo-seed-helper', description: 'Seeds test data.', body: 'You seed data.', dispatchable: true };
  assert.equal(formProblem(form), null);
  assert.equal(agentInput(form).dispatchable, false, 'no profile: never dispatchable');
  assert.equal(saveState(form).draft, true);
  const guarded = { ...form, guardProfile: 'read' as const };
  assert.equal(agentInput(guarded).dispatchable, true);
  assert.equal(saveState(guarded).draft, false);
  assert.equal(agentInput({ ...guarded, dispatchable: false }).dispatchable, false);
});

test('the editor sends nothing without a valid slug, a body and a description', () => {
  const form = { ...newForm(), slug: 'ok-slug', description: 'Does a thing.', body: 'Body' };
  assert.match(formProblem({ ...form, slug: 'Bad Slug' }) ?? '', /slug/);
  assert.match(formProblem({ ...form, body: '  ' }) ?? '', /body/);
  assert.match(formProblem({ ...form, description: '' }) ?? '', /description/);
  assert.equal(formProblem({ ...form, source: 'kit', description: '' }), null, 'a kit agent keeps its own description');
});

test('the library filters by source, missing guard and search text', () => {
  const agents = [agent('sous-verifier'), agent('browser-verifier', { hasHooks: false }), agent('qonflo-copy-checker', { source: 'custom', locked: { slug: true, tools: false, hooks: true } })];
  assert.deepEqual(filterCounts(agents), { all: 3, kit: 2, custom: 1, guard: 1 });
  assert.deepEqual(filterAgents(agents, 'guard', '').map((item) => item.slug), ['browser-verifier']);
  assert.deepEqual(filterAgents(agents, 'all', 'copy').map((item) => item.slug), ['qonflo-copy-checker']);
  assert.deepEqual(diffCounts('--- a\n+++ b\n@@ -1 +1 @@\n-model: sonnet\n+model: haiku\n+hooks:\n'), { added: 2, removed: 1 });
});
