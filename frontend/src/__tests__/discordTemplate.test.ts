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
});

test('rejects unknown Discord template fields before saving', () => {
  assert.match(getDiscordTemplateError('{{unknownField}}'), /Unsupported template field/);
  assert.strictEqual(getDiscordTemplateError('{{ticketKey}}'), '');
});

test('renders a related ticket group in one Discord preview', () => {
  const message = renderDiscordMessageTemplate('{{ticketKey}}\n{{relatedTickets}}', {
    ticket: { key: 'QRD-475 + QRD-476', title: 'Combined delivery', url: 'https://jira.example/QRD-475' },
    relatedTickets: [
      { key: 'QRD-475', title: 'Backend', url: 'https://jira.example/QRD-475' },
      { key: 'QRD-476', title: 'Frontend', url: 'https://jira.example/QRD-476' },
    ],
    pullRequests: [],
  });
  assert.match(message, /Related Tickets/);
  assert.match(message, /QRD-476/);
  assert.strictEqual(getDiscordTemplateError('{{relatedTickets}}'), '');
});

test('builds a safe bounded default title for Discord forum posts', () => {
  const title = buildDiscordForumTitle({ key: 'QRD-1055', title: '[BE]\nComponent Template: folder support '.repeat(8) });
  assert.match(title, /^\[QRD-1055\] \[BE\] Component Template/);
  assert.strictEqual(title.length, 100);
  assert.doesNotMatch(title, /\n/);
});
