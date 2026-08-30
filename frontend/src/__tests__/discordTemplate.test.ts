import assert from 'node:assert';
import test from 'node:test';
import { getDiscordTemplateError, renderDiscordMessageTemplate } from '../lib/discordTemplate';

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
