import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MyTicketsPanel } from '../agents/MyTicketsPanel';
import type { DraftFinding, DraftTicket } from '../agents/planning';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ReadinessCard, ReadinessChip, SummaryBlock } from '../components/ticket/TicketReady';
import { readinessOnBoard, ticketReadiness } from '../lib/ticketDetail';

const ready = ticketReadiness({ key: 'QRD-1498', title: '[FE] Agent Playbook tab', acceptanceCriteria: '- Rows show names (QRD-1289)', figmaUrl: null, summary: null });

test('a TODO card shows "Siap dikerjain n/7" with the missing items on hover; a card in another column shows none', () => {
  const card = (column: string) => { const board = readinessOnBoard(column, ready); return board ? renderToStaticMarkup(<ReadinessChip ready={board} />) : ''; };
  const todo = card('TODO');
  assert.match(todo, new RegExp(`Siap dikerjain ${ready.done}/7`));
  assert.match(todo, /group-hover\/ready:flex/);
  assert.match(todo, /1 rujukan tiket lain belum diputusin/);
  assert.doesNotMatch(card('IN PROGRESS'), /Siap dikerjain/);
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  assert.ok(read('../pages/DashboardPage.tsx').includes('readiness={readinessOnBoard(column.id, readiness.get(ticket.key))}'), 'the board passes readiness only through the TODO check');
  assert.ok(read('../components/TicketCard.tsx').includes('{readiness && <ReadinessChip ready={readiness} />}'));
});

test('the ticket detail lists the seven items, a missing one with the place it is fixed', () => {
  const html = renderToStaticMarkup(<ReadinessCard ready={ready} startOpen onNavigate={() => undefined} />);
  assert.match(html, new RegExp(`${ready.done} dari 7`));
  assert.match(html, /Planning › AC check/);
  assert.match(html, /cuma info, status tetap bisa dipindah/);
});

test('Intinya shows the three lines, when the AC last changed and a link to the original in Jira', () => {
  const summary = {
    key: 'QRD-1510', made: 'Izin baru', checked: 'Izinnya muncul', notHere: 'Drawer MCP', waitsOn: ['QRD-1307'], before: 'Semua bisa', after: 'Cuma yang punya izin', line: 'x',
    testData: null, ui: true, acId: [], titleId: null, writtenAt: '2026-11-13T00:00:00.000Z', current: true, acChangedAt: '2026-11-04T03:00:00.000Z',
  };
  const html = renderToStaticMarkup(<SummaryBlock summary={summary} jiraUrl="https://jira/browse/QRD-1510" />);
  assert.match(html, /Bikin apa.*Izin baru.*Dicek di sini.*Bukan di sini.*Nunggu tiket lain.*QRD-1307/s);
  assert.match(html, /Sebelum \/ sesudah/);
  assert.match(html, /AC terakhir berubah/);
  assert.match(html, /href="https:\/\/jira\/browse\/QRD-1510"/);
});

test('Tiket saya lists the owner tickets with the Indonesian title, and no translation line without a summary', () => {
  const ticket = (key: string, dev: string, summary: string): DraftTicket => ({ key, summary, dev, ac: ['Owner sees the rule'], merged: false } as unknown as DraftTicket);
  const draft = { sprint: 'QRD Sprint 27', tickets: [ticket('QRD-1510', 'Danu', 'Expose Playbook folders'), ticket('QRD-1292', 'Danu', 'Version history'), ticket('QRD-1498', 'Indra', 'Agent tab')], findings: [] as DraftFinding[] };
  const summaries = new Map([['QRD-1510', { key: 'QRD-1510', titleId: 'Izin buka folder Playbook', acId: ['Owner lihat rule-nya'], current: true, testData: null }]]);
  const html = renderToStaticMarkup(<MyTicketsPanel draft={draft} me="Danu" summaries={summaries} onOpenTicket={() => undefined} />);
  assert.match(html, /Danu · 2 tiket/);
  assert.match(html, /Izin buka folder Playbook/);
  assert.match(html, /QRD-1292.*belum ada ringkasan/s);
  assert.doesNotMatch(html, /QRD-1498/);
});
