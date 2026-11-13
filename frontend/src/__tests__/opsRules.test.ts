import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STATUS_AFTER_MERGE, readCronRules, readStatusAfterMerge, readWorktreeMerged, withCronRules } from '../lib/opsRules';

test('the Aturan rules read with the defaults that keep today\'s behaviour, docs-sync ignored', () => {
  assert.deepEqual(readStatusAfterMerge(null), { enabled: true, next: 'UAT MERGED', ignoreDocsSync: true, laptop: false });
  assert.deepEqual(readStatusAfterMerge('{"next":"UAT CHECK","laptop":true}'), { ...DEFAULT_STATUS_AFTER_MERGE, next: 'UAT CHECK', laptop: true });
  assert.deepEqual(readWorktreeMerged('nope'), { mode: 'notify', days: 3 });
  assert.deepEqual(readCronRules('{}'), { blockedManual: 'tell', stackedAllowed: true });
});

test('a cron rule change keeps every other field of the saved cron config', () => {
  const config = JSON.stringify({ enabled: true, parallel: 3, waitForPublish: true, blockedManual: 'tell' });
  assert.deepEqual(JSON.parse(withCronRules(config, { blockedManual: 'stop' })), { enabled: true, parallel: 3, waitForPublish: true, blockedManual: 'stop' });
  assert.deepEqual(readCronRules(withCronRules(config, { stackedAllowed: false })), { blockedManual: 'tell', stackedAllowed: false });
});

test('a new session on a blocked ticket names what it waits on; the Aturan block sits in Sous flow and the merge rule on the laptop Jira section', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const hook = read('chat/useOpenForTicket.ts');
  assert.match(hook, /tiket ini masih nunggu \$\{waitsOn\}/);
  assert.match(hook, /if \(created\.data\?\.createChatSession\.waitsOn\) setNotice/);
  assert.match(read('settings/sections/SousFlowSection.tsx'), /<div id="rules"><RulesCard \/><\/div>/);
  assert.match(read('pages/SettingsPage.tsx'), /active === 'jira' && mode === 'laptop' && <div className="mt-5"><RulesCard scope="merge" \/><\/div>/);
  assert.match(read('graphql/mutations.ts'), /createChatSession\([^)]*\) \{\s*\$\{CHAT_SESSION_FIELDS\}\s*waitsOn/);
});
