import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatActivity } from '../chat/activity/activity';
import { WorkerStrip } from '../chat/activity/WorkerTray';
import type { ChatSession } from '../chat/messages';
import { isReviewSession, offlineLine, plainPreview, sessionStateLine, sessionsLine } from '../chat/phonePanel';
import { SessionRow } from '../chat/SessionRow';

const read = (file: string) => readFileSync(fileURLToPath(new URL(`../chat/${file}`, import.meta.url)), 'utf8');
const now = Date.UTC(2026, 9, 26, 8, 0, 0);

test('the line under the title: needs you, queued, running with the turn time, failed, or idle with the message count', () => {
  const base = { status: 'idle', busy: false, waiting: false, messageCount: 2, turnStartedAt: null, now };
  assert.strictEqual(sessionStateLine(base), 'idle · 2 messages');
  assert.strictEqual(sessionStateLine({ ...base, messageCount: 1 }), 'idle · 1 message');
  assert.strictEqual(sessionStateLine({ ...base, status: 'running', busy: true, turnStartedAt: new Date(now - 372_000).toISOString() }), 'running · 6 m 12 s');
  assert.strictEqual(sessionStateLine({ ...base, status: 'running', busy: true }), 'running');
  assert.strictEqual(sessionStateLine({ ...base, status: 'running', busy: true, waiting: true }), 'needs you');
  assert.strictEqual(sessionStateLine({ ...base, status: 'queued', busy: true }), 'queued');
  assert.strictEqual(sessionStateLine({ ...base, status: 'error' }), 'last turn failed');
});

test('the list header counts sessions and the running ones; the offline strip names the machine', () => {
  assert.strictEqual(sessionsLine([{ status: 'running' }, { status: 'idle' }, { status: 'queued' }]), '3 sessions · 2 running');
  assert.strictEqual(sessionsLine([{ status: 'idle' }]), '1 session');
  assert.strictEqual(offlineLine('workspace'), 'Workspace offline');
});

test('a preview drops markdown marks; a session titled Review- is a review', () => {
  assert.strictEqual(plainPreview('PR #418 sudah dicek.\n\n1. **Blocker:** kolom `Size` belum punya [tooltip](https://x.y).'), 'PR #418 sudah dicek. Blocker: kolom Size belum punya tooltip.');
  assert.strictEqual(plainPreview('# Done\n- item _one_'), 'Done item one');
  assert.strictEqual(isReviewSession({ title: 'Review-QRD-1473' }), true);
  assert.strictEqual(isReviewSession({ title: 'Task-QRD-1230' }), false);
});

const session = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: 's1', source: 'dock', title: 'Review-QRD-1473', ticketKey: 'QRD-1473', status: 'idle', messageCount: 2,
  startedAt: new Date(now - 9e5).toISOString(), lastMessageAt: new Date(now - 6e4).toISOString(), lastText: '**Blocker:** kolom `Size`', ...overrides,
});

test('on a phone a session row shows plain text and a Review chip; elsewhere it stays as it was', () => {
  const phone = renderToStaticMarkup(<SessionRow session={session()} selected={false} now={now} phone onSelect={() => undefined} />);
  assert.match(phone, />Blocker: kolom Size</);
  assert.match(phone, />Review</);
  const desktop = renderToStaticMarkup(<SessionRow session={session()} selected={false} now={now} onSelect={() => undefined} />);
  assert.match(desktop, /\*\*Blocker:\*\* kolom `Size`/);
  assert.doesNotMatch(desktop, />Review</);
});

let nextId = 1;
const agent = (name: string, overrides: Partial<ChatActivity> = {}): ChatActivity => {
  const id = nextId++;
  return {
    id, sessionId: 's1', turnId: 10, eventId: `e${id}`, parentId: null, kind: 'agent', agent: 'main', name, label: `Agent ${name}: task ${id}`, summary: '',
    status: 'running', hasDetail: false, seq: id, startedAt: new Date(now - id * 1000).toISOString(), endedAt: null, ...overrides,
  };
};

test('the worker strip is one line with the running and finished counts, closed until tapped', () => {
  assert.strictEqual(renderToStaticMarkup(<WorkerStrip events={[]} onOpen={() => undefined} />), '');
  const html = renderToStaticMarkup(<WorkerStrip events={[agent('sous-ticket-worker'), agent('sous-reviewer'), agent('sous-planner', { status: 'ok', endedAt: new Date(now).toISOString() })]} onOpen={() => undefined} />);
  assert.match(html, /2 running/);
  assert.match(html, /· 1 done/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Workers of this session/);
});

test('the phone and the floating panel share one header, no limits line or Runs on row, and open worker threads inside the panel', () => {
  const dock = read('ChatDock.tsx');
  assert.match(dock, /const compact = phone \|\| !drawer;/, 'the floating panel on a computer follows the phone layout; the drawer keeps its own');
  assert.match(dock, /\{compact && listing && <PhoneChatHeader title="Sessions"/);
  assert.match(dock, /\{!compact && <header/);
  assert.match(dock, /\{!compact && <LimitsLine/);
  assert.match(dock, /label: 'Dock to bottom'[\s\S]*\.\.\.\(phone \? \[\] : \[dockItem\]\)/, 'a computer can still dock it from the menu');
  assert.match(dock, /compact\s+threadId=\{threadId\}\s+onOpenThread=\{setThreadId\}/);
  assert.match(dock, /<AgentThreadPane sessionId=\{state\.active\} threadId=\{threadId\}[\s\S]*?className="absolute inset-0 z-20"/);
  assert.match(dock, /label: 'Rename'[\s\S]*label: 'New session'[\s\S]*label: 'Open full page'[\s\S]*label: 'All sessions'/);
  const thread = read('ChatThread.tsx');
  assert.match(thread, /\{session && !hideMachine && !compact && <div/);
  assert.match(thread, /\{session && !compact && <SessionHeader/);
  assert.match(thread, /compact && onOpenThread \? <WorkerStrip/);
  const header = read('PhoneChatHeader.tsx');
  assert.doesNotMatch(header, /workspace/i);
  assert.match(header, /<LimitBars machine=\{machine\} \/>/);
  assert.match(header, /<LimitMeters machine=\{machine\} \/>/);
});

test('the compact composer puts expand in the box, Stop in place of Send while the box is empty, and model with Queue/Steer under it', () => {
  const composer = readFileSync(fileURLToPath(new URL('../chat/composer/Composer.tsx', import.meta.url)), 'utf8');
  assert.match(composer, /const stopInPlace = Boolean\(compact\) && showStop && !draft\.trim\(\) && attachments\.items\.length === 0;/);
  assert.match(composer, /\{!stopInPlace && <button/);
  assert.match(composer, /\{showStop && \(!compact \|\| stopInPlace\) && \(/);
  assert.match(composer, /<ModelPopover control=\{control\} machine=\{machine\}[^>]* up \/>/);
  assert.match(composer, /\{choice === 'queue' \? 'Queue' : 'Steer'\}/);
});
