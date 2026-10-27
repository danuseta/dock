import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

test('the Forum reader card shows workspace values instead of their fields and keeps the user id field', () => {
  const section = read('settings/sections/DiscordSection.tsx');
  assert.match(section, /settings\.discordManagedToken \? <Managed label="Bot token"/);
  assert.match(section, /settings\.discordManagedGuild \? <Managed label="Server"/);
  assert.match(section, /label="Your Discord user id"/);
  assert.match(section, /settings\.hasDiscordBotToken \|\| settings\.discordManagedToken/);
});

test('a team channel has no Remove on the Discord page, and a missing user id points to Settings', () => {
  const page = read('pages/DiscordPage.tsx');
  assert.match(page, /channel\.team\s*\? <span/);
  assert.match(page, /feed\.ownerSet === false/);
  assert.match(page, /onNavigate\('\/settings\?section=discord'\)/);
  const queries = read('graphql/queries.ts');
  assert.match(queries, /channels \{ id name kind thread enabled team \}/);
  assert.match(queries, /ownerSet/);
  assert.match(queries, /discordManagedToken\s+discordManagedGuild\s+discordTeamChannels/);
});
