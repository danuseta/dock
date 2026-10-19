import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dock = readFileSync(fileURLToPath(new URL('../chat/ChatDock.tsx', import.meta.url)), 'utf8');

test('the chat dock opens on the session list, with New session in the header and no session tabs', () => {
  assert.match(dock, /useState\(true\)/);
  assert.match(dock, /GET_CHAT_SESSIONS/);
  assert.match(dock, /<SessionRow/);
  assert.match(dock, /aria-label="New session"/);
  assert.doesNotMatch(dock, /role="tablist"/);
});

test('picking a session opens its thread and the back button returns to the list', () => {
  assert.match(dock, /chatStore\.openSession\(session\.id\); setShowList\(false\)/);
  assert.match(dock, /aria-label="Back to sessions"[^>]*onClick=\{\(\) => setShowList\(true\)\}/);
  assert.match(dock, /<ChatThread key=\{state\.active\}/);
});
