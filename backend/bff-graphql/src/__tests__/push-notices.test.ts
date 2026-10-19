import assert from 'node:assert';
import test from 'node:test';
import { askNotice, splitChoices, waitingNotice } from '../integrations/push-notices';

test('a waiting run with fixed answers gets them as buttons, two at most', () => {
  assert.deepStrictEqual(waitingNotice({ key: 'QRD-7', waiting: 'Keep the tag filter? [Keep|Drop|Later]' }), {
    title: 'QRD-7 waits on you', body: 'Keep the tag filter?', url: '/detail/QRD-7', tag: 'wait-QRD-7',
    actions: [{ action: 'answer:0', title: 'Keep' }, { action: 'answer:1', title: 'Drop' }],
    data: { kind: 'answer', ticketKey: 'QRD-7', choices: ['Keep', 'Drop'] },
  });
  assert.deepStrictEqual(waitingNotice({ key: 'QRD-8', waiting: 'Which endpoint?' }), { title: 'QRD-8 waits on you', body: 'Which endpoint?', url: '/detail/QRD-8', tag: 'wait-QRD-8' });
  assert.deepStrictEqual(splitChoices('See [this] first'), { question: 'See [this] first', choices: [] });
});

const ask = { sessionId: 's1', sessionTitle: 'QRD-7 (cron)', id: 4, kind: 'permission', title: 'Run a command', tool: 'Edit', summary: 'src/a.ts' };

test('a permission can be allowed from the notification only when it is not a shell command', () => {
  assert.deepStrictEqual(askNotice(ask), {
    title: 'QRD-7 (cron) asks', body: 'Run a command: src/a.ts', url: '/sessions?session=s1', tag: 'ask-s1-4',
    actions: [{ action: 'allow', title: 'Allow once' }, { action: 'deny', title: 'Deny' }],
    data: { kind: 'interaction', sessionId: 's1', id: 4 },
  });
  assert.deepStrictEqual(askNotice({ ...ask, tool: 'Bash', summary: 'npm install zod' }).actions, [{ action: 'deny', title: 'Deny' }]);
  assert.deepStrictEqual(askNotice({ ...ask, tool: 'PowerShell' }).actions, [{ action: 'deny', title: 'Deny' }]);
});

test('plans and questions open the session and carry no buttons', () => {
  const notice = askNotice({ ...ask, kind: 'question', title: 'Which base?', tool: null, summary: null });
  assert.deepStrictEqual(notice, { title: 'QRD-7 (cron) asks', body: 'Which base?', url: '/sessions?session=s1', tag: 'ask-s1-4' });
});
