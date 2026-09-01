import assert from 'node:assert';
import test from 'node:test';
import { buildDiscordForumTitle, getDiscordTemplateError, renderDiscordMessageTemplate } from '../lib/discordTemplate';

test('renders saved Discord template fields for the editable preview', () => {
  const message = renderDiscordMessageTemplate('{{ticketKey}} — {{ticketTitle}}\n{{pullRequests}}\n{{demoUrl}}', {
    ticket: { key: 'QRD-1099', title: 'Agent workflow', url: 'https://jira.example/QRD-1099' },
    pullRequests: [{ repo: 'org/frontend', title: 'QRD-1099 UI', url: 'https://github.example/pr/1', status: 'OPEN', type: 'FE' }],
    demoUrl: 'https://demo.example/1099',
  });
  assert.match(message, /QRD-1099 — Agent workflow/);
  assert.match(message, /Frontend Repositories/);
  assert.match(message, /demo\.example/);
  assert.doesNotMatch(message, /OPEN|🟢|Demo Video|🎬/);
  assert.match(message, /\[org\/frontend\] - \[QRD-1099 UI\]/);
});

test('rejects unknown Discord template fields before saving', () => {
  assert.match(getDiscordTemplateError('{{unknownField}}'), /Unsupported template field/);
  assert.strictEqual(getDiscordTemplateError('{{ticketKey}}'), '');
});

test('repeats every ticket line once per ticket in a dependency group', () => {
  const message = renderDiscordMessageTemplate('{{ticketKey}} - {{ticketTitle}}\n\nJira :\n[{{ticketKey}}]({{ticketUrl}})\n\n{{demoUrl}}', {
    ticket: { key: 'QRD-476', title: 'Backend threads', url: 'https://jira.example/QRD-476' },
    relatedTickets: [
      { key: 'QRD-476', title: 'Backend threads', url: 'https://jira.example/QRD-476' },
      { key: 'QRD-475', title: 'Frontend panel', url: 'https://jira.example/QRD-475' },
    ],
    pullRequests: [],
    demoUrl: '- **QRD-476 + QRD-475:** https://demo.example/475',
  });
  assert.match(message, /^QRD-476 - Backend threads\nQRD-475 - Frontend panel$/m);
  assert.match(message, /^\[QRD-476\]\(https:\/\/jira\.example\/QRD-476\)\n\[QRD-475\]\(https:\/\/jira\.example\/QRD-475\)$/m);
  assert.match(message, /- \*\*QRD-476 \+ QRD-475:\*\* https:\/\/demo\.example\/475/);
  assert.doesNotMatch(message, /\(\+1 related\)/);
});

test('still renders the optional related ticket block', () => {
  const message = renderDiscordMessageTemplate('{{relatedTickets}}', {
    ticket: { key: 'QRD-476', title: 'Backend threads', url: 'https://jira.example/QRD-476' },
    relatedTickets: [
      { key: 'QRD-476', title: 'Backend threads', url: 'https://jira.example/QRD-476' },
      { key: 'QRD-475', title: 'Frontend panel', url: 'https://jira.example/QRD-475' },
    ],
    pullRequests: [],
  });
  assert.match(message, /Related Tickets/);
  assert.match(message, /- \[QRD-475\]\(https:\/\/jira\.example\/QRD-475\) — Frontend panel/);
  assert.strictEqual(getDiscordTemplateError('{{relatedTickets}}'), '');
});

test('builds a safe bounded default title for Discord forum posts', () => {
  const title = buildDiscordForumTitle({ key: 'QRD-1055', title: '[BE]\nComponent Template: folder support '.repeat(8) });
  assert.match(title, /^\[QRD-1055\] \[BE\] Component Template/);
  assert.strictEqual(title.length, 100);
  assert.doesNotMatch(title, /\n/);
});
