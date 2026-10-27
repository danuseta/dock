import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

test('the guide is a route with no sidebar entry; the book icon by the version and the phone More menu open it', () => {
  const app = read('App.tsx');
  assert.match(app, /path === '\/guide'/);
  assert.match(app, /case '\/guide': return <GuidePage/);
  const layout = read('components/AppLayout.tsx');
  assert.ok(!/path: '\/guide'/.test(layout), 'not a sidebar item');
  assert.match(layout, /aria-label="How to use DOCK"[^>]*onClick=\{\(\) => onNavigate\('\/guide'\)\}/);
  assert.match(layout, /onClick=\{\(\) => go\('\/guide'\)\}/);
});

test('the guide states the limits the code enforces', () => {
  const guide = read('pages/GuidePage.tsx');
  const cron = readFileSync(join(src, '..', '..', 'backend', 'bff-graphql', 'src', 'integrations', 'orchestrator-cron.ts'), 'utf8');
  assert.match(cron, /parallel: 2,/);
  assert.match(cron, /integer\(merged\.parallel, 'parallel', 1, 5\)/);
  assert.match(guide, /\['Agents at once', '2', '1–5'/);
  assert.match(cron, /maxPerDay: 6,/);
  assert.match(cron, /integer\(merged\.maxPerDay, 'maxPerDay', 1, 50\)/);
  assert.match(guide, /\['New tickets per day', '6', '1–50'/);
  assert.match(cron, /usageBrakePercent: 70,/);
  assert.match(guide, /\['Usage brake \(%\)', '70', '0–100'/);
  assert.match(guide, /\['Turns at once \(Settings → Chat\)', '3', '1–6'/);
});
