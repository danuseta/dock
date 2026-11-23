import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { SplitBox, SplitRow } from '../agents/SplitBox';
import type { DraftSplit } from '../agents/planning';

const noop = () => undefined;
const split = (over: Partial<DraftSplit> = {}): DraftSplit => ({
  page: 'Sprint 28 split', version: 3, readAt: '2026-11-17T09:02:00Z', error: null, rows: 4, kept: 0,
  diffs: [{ key: 'QRD-1550', draftWeek: 1, splitWeek: 2, note: 'waits on BE' }, { key: 'QRD-1552', draftWeek: 2, splitWeek: 1, note: null }], ...over,
});

test('the split box lists each ticket in another week with Use split page and Keep', () => {
  const html = renderToStaticMarkup(<SplitBox split={split()} busy={false} onUse={noop} onKeep={noop} />);
  assert.match(html, /2 tickets sit in a different week than the split page says/);
  assert.match(html, /QRD-1550[\s\S]*draft <b>Week 1<\/b>[\s\S]*split page <b>Week 2<\/b>[\s\S]*waits on BE/);
  assert.equal((html.match(/Use split page/g) ?? []).length, 2);
  assert.equal((html.match(/>Keep</g) ?? []).length, 2);
});

test('the split box says so when nothing differs, and disables the buttons while busy', () => {
  assert.match(renderToStaticMarkup(<SplitBox split={split({ diffs: [] })} busy={false} onUse={noop} onKeep={noop} />), /Every ticket the split page lists sits in its week/);
  assert.match(renderToStaticMarkup(<SplitBox split={split()} busy onUse={noop} onKeep={noop} />), /disabled=""[^>]*>[\s\S]*Use split page/);
});

test('a missing page or a page in another format shows an info line and no buttons', () => {
  const html = renderToStaticMarkup(<SplitBox split={split({ error: 'Split page "Gone" was not found', diffs: [], rows: 0, version: null })} busy={false} onUse={noop} onKeep={noop} />);
  assert.match(html, /was not found\. Planning works as before; nothing is blocked/);
  assert.doesNotMatch(html, /Use split page|Keep/);
});

test('the Team map split row shows only while a ticket sits in another week, and names the tickets', () => {
  const html = renderToStaticMarkup(<SplitRow split={split()} busy={false} onUse={noop} onKeep={noop} />);
  assert.match(html, /Split page &quot;Sprint 28 split&quot; v3: <b[^>]*>QRD-1550 and QRD-1552<\/b> sit in a different week than the draft\./);
  assert.match(html, /Use split page[\s\S]*Keep[\s\S]*Details/);
  assert.doesNotMatch(html, /waits on BE/, 'the per-ticket rows open with Details');
  assert.equal(renderToStaticMarkup(<SplitRow split={split({ diffs: [] })} busy={false} onUse={noop} onKeep={noop} />), '');
  assert.equal(renderToStaticMarkup(<SplitRow split={split({ error: 'Split page "Gone" was not found', diffs: [] })} busy={false} onUse={noop} onKeep={noop} />), '');
});

test('Settings › Planning flow has the Split page field with Test, and Planning shows the row from the draft in Team map', () => {
  const section = readFileSync(new URL('../settings/sections/PlanningFlowSection.tsx', import.meta.url), 'utf8');
  assert.match(section, /title="Split page"/);
  assert.match(section, /TEST_PLANNING_SPLIT_PAGE/);
  assert.match(section, /<Zap size=\{16\} aria-hidden="true" \/>Test</);
  const tab = readFileSync(new URL('../agents/PlanningTab.tsx', import.meta.url), 'utf8');
  assert.match(tab, /\{draft\.split && <SplitRow split=\{draft\.split\}/);
});
