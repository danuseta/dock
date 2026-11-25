import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LessonsBoard, type LessonActions } from '../agents/lessons/LessonsBoard';
import { canMakeCode, filterLessons, lessonCounts, sourceLabel, statusChips, targetLabel, targetProblem, type Lesson, type LessonsData } from '../agents/lessons/lessonsLogic';
import { agentsRoute } from '../agents/plan';
import { PhoneTabs } from '../agents/PhoneTabs';

const lesson = (id: string, over: Partial<Lesson> = {}): Lesson => ({
  id, targetKind: 'skill', targetName: 'demo-video', text: 'Walk the whole ElevenLabs rotation before using edge.', textId: null, cause: 'self-inflicted-rework', count: 1, ignored: 0,
  ticketKeys: ['QRD-1639'], sessionIds: ['4e75771b'], status: 'active', cardKey: null, cardState: null, cardSessionId: null, writtenTo: 'skills/demo-video/lessons.md',
  createdAt: '2026-11-24T14:00:00.000Z', updatedAt: '2026-11-24T14:00:00.000Z',
  sources: [{ id: 's1', kind: 'judge-session', ref: 'judge:4e75771b:x', sessionId: '4e75771b-aaaa', messageId: 76050, ticketKey: 'QRD-1639', text: 't', cause: 'self-inflicted-rework', status: 'lesson', createdAt: '2026-11-24T14:00:00.000Z' }],
  ...over,
});

const data = (lessons: Lesson[], unprocessed = 0): LessonsData => ({
  unprocessed, sources: 9, byStatus: [{ status: 'pending', count: unprocessed }, { status: 'lesson', count: 3 }, { status: 'merged', count: 2 }, { status: 'code', count: 1 }, { status: 'environment', count: 3 }],
  environment: [{ id: 'e1', kind: 'judge-session', ticketKey: 'QRD-1700', text: 'All seven ElevenLabs keys were quota_exceeded.', createdAt: '2026-11-25T01:00:00.000Z' }], failed: [], lessons,
});

const noop: LessonActions = { edit: async () => null, retarget: async () => null, remove: async () => null, approve: async () => null };

test('the Lessons tab is a route of the Agents page and a phone tab next to Library', () => {
  assert.equal(agentsRoute('?tab=lessons'), 'lessons');
  assert.equal(agentsRoute('?tab=library'), 'library');
  assert.equal(agentsRoute('?tab=nope'), 'office');
  const tabs = renderToStaticMarkup(<PhoneTabs current="lessons" library onPick={() => undefined} />);
  assert.match(tabs, /aria-selected="true"[^>]*>Lessons</);
  assert.doesNotMatch(renderToStaticMarkup(<PhoneTabs current="runs" library={false} onPick={() => undefined} />), /Lessons/);
});

test('lesson logic: filters and counts by target, chips per state, the code button until the card runs, source labels', () => {
  const rows = [lesson('a'), lesson('b', { targetKind: 'flow', targetName: 'sous' }), lesson('c', { targetKind: 'repo', targetName: 'ms-admin-worker-backend', status: 'coded', cardState: 'done' })];
  assert.deepEqual(lessonCounts(rows), { all: 3, skill: 1, agent: 0, flow: 1, repo: 1, fact: 0, code: 0 });
  assert.deepEqual(filterLessons(rows, 'flow').map((row) => row.id), ['b']);
  assert.equal(targetLabel(rows[0]), 'Skill · demo-video');
  assert.equal(targetLabel(rows[1]), 'Sous flow');
  assert.deepEqual(statusChips(rows[0]), [{ label: 'Active', variant: 'neutral' }]);
  assert.deepEqual(statusChips({ status: 'code-card', cardState: 'pending', cardKey: 'CARD-lesson-x', ignored: 1 }).map((chip) => chip.label), ['Make it code? Waiting for you', 'Broken 1× after reading']);
  assert.equal(statusChips({ status: 'code-card', cardState: 'started', cardKey: 'CARD-lesson-x', ignored: 0 })[0].label, 'CARD-lesson-x running');
  assert.equal(statusChips(rows[2])[0].label, 'Guarded by code');
  assert.equal(canMakeCode(rows[0]), true);
  assert.equal(canMakeCode({ status: 'code-card', cardState: 'pending' }), true, 'a pending card waits for this button');
  assert.equal(canMakeCode({ status: 'code-card', cardState: 'started' }), false);
  assert.equal(canMakeCode(rows[2]), false);
  assert.equal(sourceLabel(rows[0].sources[0]), 'Judge 4e75771b (QRD-1639)');
  assert.equal(sourceLabel({ kind: 'ledger', sessionId: null, ticketKey: 'QRD-1646', ref: 'ledger:QRD-1646:rounds' }), 'Ledger QRD-1646');
  assert.equal(sourceLabel({ kind: 'judge-sprint', sessionId: null, ticketKey: null, ref: 'judge-sprint:QRD Sprint 28:try:ab' }), 'Judge sprint QRD Sprint 28');
  assert.equal(targetProblem('skill', 'demo-video'), null);
  assert.match(targetProblem('skill', 'Demo Video!') ?? '', /plain name/);
  assert.match(targetProblem('team', 'x') ?? '', /kind/);
  assert.equal(targetProblem('flow', ''), null);
});

test('the board shows the unprocessed count, the target filter, each lesson with its count, sources and actions', () => {
  const html = renderToStaticMarkup(<LessonsBoard data={data([lesson('a', { count: 2, ticketKeys: ['QRD-1639', 'QRD-1592'], status: 'code-card', cardState: 'pending', cardKey: 'CARD-lesson-demo-video-abc123' }), lesson('c', { targetKind: 'repo', targetName: 'ms-admin-worker-backend', status: 'coded', cardState: 'done', text: 'Run tsc on scripts.' })])} actions={noop} />);
  assert.match(html, /aria-label="0 sources not processed"[^>]*>0</);
  assert.match(html, /target 0 · 9 sources/);
  assert.match(html, />All<span[^>]*>2</);
  assert.match(html, />Skill<span[^>]*>1</);
  assert.match(html, /Skill · demo-video/);
  assert.match(html, />2×</);
  assert.match(html, /QRD-1639, QRD-1592/);
  assert.match(html, /Make it code\? Waiting for you/);
  assert.match(html, /Guarded by code/);
  assert.match(html, /From Judge 4e75771b \(QRD-1639\)/);
  assert.match(html, /skills\/demo-video\/lessons\.md/);
  assert.equal((html.match(/Jadikan aturan di kode/g) ?? []).length, 1, 'only the lesson not guarded by code offers it');
  assert.equal((html.match(/aria-label="Lesson for /g) ?? []).length, 2, 'one card per lesson');
  assert.equal((html.match(/Change target/g) ?? []).length, 1, 'a coded lesson is not moved');
  assert.match(html, /Environment notices[\s\S]*quota_exceeded/);
  assert.match(html, /Merged 2/);

  const waiting = renderToStaticMarkup(<LessonsBoard data={data([], 4)} actions={noop} />);
  assert.match(waiting, /aria-label="4 sources not processed"/);
  assert.match(waiting, /No lessons yet/);
  assert.match(renderToStaticMarkup(<LessonsBoard data={data([lesson('a')])} actions={noop} initialFilter="agent" />), /No lesson for this target/);
});

test('a lesson shows its Indonesian translation grey under the English text, and nothing when there is none', () => {
  const html = renderToStaticMarkup(<LessonsBoard data={data([lesson('a', { textId: 'Coba semua key ElevenLabs dulu sebelum pakai edge.' })])} actions={noop} />);
  assert.match(html, /Walk the whole ElevenLabs rotation before using edge\.<\/p><p class="mt-1 text-pretty text-sm text-muted-foreground" lang="id">Coba semua key ElevenLabs dulu sebelum pakai edge\.<\/p>/);
  const none = renderToStaticMarkup(<LessonsBoard data={data([lesson('a')])} actions={noop} />);
  assert.doesNotMatch(none, /lang="id"/);
});
