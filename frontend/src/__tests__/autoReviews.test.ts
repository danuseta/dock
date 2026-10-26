import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AUTO_REVIEW_LABEL, latestByTicket, prLabel, type AutoReviewRow } from '../agents/autoReviews';
import { savedValues, sectionInput } from '../settings/sections';

const row = (id: string, ticketKey: string, status: string): AutoReviewRow => ({
  id, ticketKey, status, prUrl: 'https://github.com/qonekid/ms-admin-worker-backend/pull/412', headSha: 'abc1234def', threadUrl: 'https://discord.com/channels/g/t', sessionId: null, detail: null, startedAt: '2026-10-27T03:00:00Z', finishedAt: null,
});

test('the newest auto review of a ticket gives its badge; every status has a label', () => {
  const latest = latestByTicket([row('b', 'QRD-1', 'lgtm'), row('a', 'QRD-1', 'blockers'), row('c', 'QRD-2', 'running')]);
  assert.equal(latest.get('QRD-1')?.id, 'b');
  assert.equal(latest.get('QRD-2')?.status, 'running');
  assert.equal(prLabel('https://github.com/qonekid/ms-admin-worker-backend/pull/412'), 'qonekid/ms-admin-worker-backend#412');
  for (const status of ['running', 'deciding', 'lgtm', 'clean', 'blockers', 'failed']) assert.ok(AUTO_REVIEW_LABEL[status], status);
});

test('both auto review settings are off until turned on, and the Discord save sends them as true or false', () => {
  const off = savedValues({}).discord;
  assert.deepEqual([off.autoReviewOnIt, off.autoLgtm], ['false', 'false']);
  const on = sectionInput('discord', { ...savedValues({ autoReviewOnIt: true, autoLgtm: true }).discord });
  assert.deepEqual([on.autoReviewOnIt, on.autoLgtm], ['true', 'true']);
  const section = readFileSync(new URL('../settings/sections/DiscordSection.tsx', import.meta.url), 'utf8');
  assert.match(section, /Review when I say on it/);
  assert.match(section, /disabled=\{values\.autoReviewOnIt !== 'true'\}/, 'auto LGTM only with auto review on');
  const agents = readFileSync(new URL('../pages/AgentsPage.tsx', import.meta.url), 'utf8');
  assert.match(agents, /<AutoReviewList rows=\{autoReviews\}/);
  assert.match(agents, /<AutoReviewBadge row=\{autoByTicket\.get\(run\.key\)\}/);
});
