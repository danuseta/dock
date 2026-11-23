import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentTimeline } from '../agents/runs';
import { SessionUsage } from '../chat/SessionUsage';
import { subagentShare, type ClaudeSessionUsage, type ClaudeTicketUsage } from '../lib/claudeUsage';
import { ExecLog } from '../pages/blackboard/ExecLog';

const agents = [
  { agentId: 'a1', name: 'sous-pr-reviewer', model: 'claude-opus-5-5', totalTokens: 8_633_818, peakContext: 316_000, cost: 6.42 },
  { agentId: 'a2', name: 'browser-verifier', model: 'claude-sonnet-5-5', totalTokens: 226_560, peakContext: 48_000, cost: 0.11 },
];
const session: ClaudeSessionUsage = { available: true, found: true, totalTokens: 10_760_000, totalCost: 9.5, mainTokens: 1_899_622, agents, error: null };
const missing = { available: false, found: false, totalTokens: 0, totalCost: 0, mainTokens: 0, agents: [], error: null };
const text = (html: string) => html.replace(/<[^>]+>/g, '');

test('the inspector shows main and subagent tokens, the subagent share, the ccusage cost and an expandable per-agent list with estimates', () => {
  assert.equal(subagentShare(session), 82);
  const html = renderToStaticMarkup(<SessionUsage usage={session} />);
  const shown = text(html);
  assert.match(shown, /main 1\.90M · subagents 8\.86M/);
  assert.match(shown, /82% of 10\.76M/);
  assert.match(shown, /2 subagents · peak 316\.0K/);
  assert.match(shown, /\$9\.50/);
  assert.match(html, /<details/);
  assert.match(shown, /sous-pr-reviewer/);
  assert.match(shown, /opus-5-5/);
  assert.match(shown, /8\.63M tok · peak 316\.0K/);
  assert.match(shown, /\$6\.42 estimate/);
});

test('without ccusage the inspector shows a dash and the Home message, not an error', () => {
  const html = renderToStaticMarkup(<SessionUsage usage={missing} />);
  assert.match(text(html), /Tokens-/);
  assert.match(text(html), /Cost-/);
  assert.match(html, /ccusage is not installed on this workspace\./);
  assert.doesNotMatch(html, /role="alert"|<details/);
  assert.equal(readFileSync(new URL('../components/ClaudeUsageCard.tsx', import.meta.url), 'utf8').includes('ccusage is not installed on this workspace.'), true, 'the same sentence as Home');
});

test('the inspector reads the session usage and places it in the panel', () => {
  const inspector = readFileSync(new URL('../chat/SessionInspector.tsx', import.meta.url), 'utf8');
  assert.match(inspector, /useQuery<\{ claudeSessionUsage: ClaudeSessionUsage \}>\(GET_CLAUDE_SESSION_USAGE, \{ variables: \{ sessionId: session\.id \}/);
  assert.match(inspector, /<SessionUsage usage=\{usageData\?\.claudeSessionUsage\} \/>/);
});

const timeline: Pick<AgentTimeline, 'visits'> = { visits: [{ stageIndex: 1, round: 1, agents: [
  { id: 'a1', parentId: 'main', name: 'sous-pr-reviewer', detail: 'Review', state: 'done', tool: null, tools: 30, since: '2026-11-16T14:54:00Z', until: '2026-11-16T15:05:00Z' },
  { id: 'zz', parentId: 'main', name: 'sous-planner', detail: 'Plan', state: 'done', tool: null, tools: 3, since: '2026-11-16T14:50:00Z', until: '2026-11-16T14:52:00Z' },
] }] };
const ticket: ClaudeTicketUsage = { available: true, sessions: 3, totalTokens: 13_940_000, totalCost: 12.34, mainTokens: 1_900_000, agents, error: null };

test('Agent runs carries Tokens · peak and Cost per agent row and the ticket total over all its sessions', () => {
  const html = renderToStaticMarkup(<ExecLog ticket="QRD-1536" run={null} timeline={timeline as AgentTimeline} usage={ticket} />);
  assert.match(html, />Tokens · peak<\/th><th[^>]*>Cost<\/th>/);
  assert.match(html, /colSpan="9"/);
  assert.match(text(html), /8\.63Mpeak 316\.0K\$6\.42/);
  assert.match(text(html), /Ticket total: 13\.94M tokens · \$12\.34 \(3 sessions, subagents included\)/);
  assert.match(html, /estimate/);
  assert.doesNotMatch(html, /does not record tokens per agent/);
});

test('Agent runs without ccusage shows a dash per agent row and the Home message', () => {
  const html = renderToStaticMarkup(<ExecLog ticket="QRD-1536" run={null} timeline={timeline as AgentTimeline} usage={{ ...ticket, ...missing, sessions: 0 }} />);
  assert.equal((html.match(/>-<\/td>/g) ?? []).length, 4);
  assert.match(text(html), /Ticket total: - ccusage is not installed on this workspace\./);
});
