import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoutCell } from '../agents/ScoutCell';
import type { DraftTicket } from '../agents/planning';

const ticket = (extra: Partial<DraftTicket>) => ({ key: 'QRD-1551', ...extra }) as DraftTicket;
const render = (extra: Partial<DraftTicket>) => renderToStaticMarkup(<ScoutCell ticket={ticket(extra)} busy={false} onScout={() => undefined} />);

test('scout cell: a light line is highlighted, a full line is muted', () => {
  const light = render({ scout: { line: 'Scout: FE · ~3 files · no contract change → light', mode: 'light', files: 3, repos: 'FE', contractChange: false, at: '2026-11-18T08:00:00.000Z' } });
  assert.match(light, /FE · ~3 files · no contract change → light/);
  assert.match(light, /font-bold/);
  const full = render({ scout: { line: 'x', mode: 'full', files: 1, repos: 'BE + FE', contractChange: true, at: '2026-11-18T08:00:00.000Z' } });
  assert.match(full, /BE \+ FE · ~1 file · contract change → full/);
  assert.doesNotMatch(full, /font-bold/);
});

test('scout cell: Run scout when missing, running state while a scout works', () => {
  assert.match(render({ scout: null, scoutRunning: false }), /Run scout/);
  const running = render({ scout: null, scoutRunning: true });
  assert.match(running, /Scout running/);
  assert.doesNotMatch(running, /Run scout/);
});
