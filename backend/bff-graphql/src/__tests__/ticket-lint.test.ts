import assert from 'node:assert';
import test from 'node:test';
import { flagReason, lintJiraTicket, lintTicket, type LintInput } from '../integrations/ticket-lint';

const BAD: LintInput = {
  type: 'Story',
  summary: 'Implement phone number display in inbox header using contact.phone from getConversation resolver and update ChatHeader component',
  userStory: '',
  problem: 'Per D-3 (GUESS) the header lacks phone; see ChatHeader.tsx:42. Agents need it.',
  ac: [
    'Phone number display works correctly.',
    'Header is user friendly and the copy button and formatting and the empty state and every contact type all behave as expected.',
    'Uses the field from QRD-1603.',
    'TBD for group chats',
  ],
  reference: '',
  openToConfirm: '',
  sp: 5,
  blockedBy: [],
  decidedRefs: [],
};

const GOOD: LintInput = {
  type: 'Task',
  summary: "[FE][Inbox] Show the contact's phone number in the chat header",
  userStory: "As an agent handling a WhatsApp chat, I want to see the customer's phone number in the chat header, so I can call or copy it without opening the contact page.",
  problem: 'Today the chat header shows only the contact name. Agents open the contact page to find the number, which takes three clicks and loses their place in the chat.',
  ac: [
    "In Inbox, when a chat is open, the header shows the contact's phone number next to the name.",
    'The number is shown with the country code, for example +62 812-3456-7890.',
    'Clicking the copy icon next to the number copies it and shows "Phone number copied".',
    'A contact without a phone number shows "-" and no copy icon.',
  ],
  reference: 'QRD-1603 stores the phone number from the WhatsApp ID. This ticket only shows the number that is already saved on the contact.',
  openToConfirm: '',
  sp: 2,
  blockedBy: [],
  decidedRefs: [],
};

const rules = (input: LintInput, level?: 'block' | 'warn') => [...new Set(lintTicket(input).findings.filter((item) => !level || item.level === level).map((item) => item.rule))].sort();
const at = (input: LintInput, rule: string) => lintTicket(input).findings.filter((item) => item.rule === rule);

test('the example ticket written for agents fails W1 W2 W3 as block and W5 W6 W7 W8 as warn', () => {
  const lint = lintTicket(BAD);
  assert.strictEqual(lint.ok, false);
  assert.deepStrictEqual(rules(BAD, 'block'), ['W1', 'W2', 'W3']);
  assert.deepStrictEqual(rules(BAD, 'warn'), ['W5', 'W6', 'W7', 'W8']);
  assert.deepStrictEqual(at(BAD, 'W2').map((item) => item.line), [1, 2]);
  assert.deepStrictEqual(at(BAD, 'W1').map((item) => item.line), [4]);
  assert.deepStrictEqual(at(BAD, 'W3').map((item) => [item.line, item.field]), [[3, 'ac']]);
  assert.ok(at(BAD, 'W6').some((item) => item.field === 'problem' && /D-<n>.*GUESS|GUESS/.test(item.text)));
  assert.ok(at(BAD, 'W6').some((item) => item.field === 'ac' && item.line === 2));
  assert.deepStrictEqual(at(BAD, 'W7').map((item) => item.field), ['userStory']);
  for (const item of lintTicket(BAD).findings) assert.ok(item.text && item.fix);
});

test('the example ticket written for humans passes with no finding', () => {
  assert.deepStrictEqual(lintTicket(GOOD), { ok: true, findings: [] });
});

test('W1: no AC, or placeholder lines, block; each placeholder is a finding on its line', () => {
  assert.deepStrictEqual(at({ ac: [] }, 'W1').map((item) => [item.line, item.level]), [[null, 'block']]);
  for (const placeholder of ['TBD', '-', 'N/A', 'to be defined', 'tbd', '']) {
    assert.deepStrictEqual(at({ ac: ['The list shows 3 rows.', placeholder] }, 'W1').map((item) => item.line), [2], placeholder);
  }
  assert.strictEqual(lintTicket({ ac: ['TBD', 'N/A'] }).ok, false);
  assert.deepStrictEqual(at({ ac: ['The list shows 3 rows.'] }, 'W1'), []);
});

test('W2: a vague phrase with nothing observable blocks; a quoted result makes it observable', () => {
  for (const phrase of ['works correctly', 'work properly', 'as expected', 'user friendly', 'user-friendly', 'sesuai', 'dengan baik', 'berjalan normal', 'optimal', 'seamless', 'intuitive']) {
    assert.deepStrictEqual(at({ ac: [`The page ${phrase} on mobile.`] }, 'W2').map((item) => item.level), ['block'], phrase);
  }
  assert.deepStrictEqual(at({ ac: ['The toast says "Saved" as expected.'] }, 'W2'), []);
  assert.deepStrictEqual(at({ ac: ['The suboptimal row is hidden.'] }, 'W2'), []);
  assert.deepStrictEqual(at({ ac: ['The page is rendered correctly.', 'The form is filled in properly.'] }, 'W2'), [], 'the standalone words are not enough; only works correctly and work properly are');
});

test('W3: an AC line naming another ticket needs a Blocks link or a decision to move it to Reference', () => {
  const ac = ['Uses the field from QRD-1603.', 'Own key QRD-1 is fine.'];
  assert.deepStrictEqual(at({ key: 'QRD-1', ac }, 'W3').map((item) => item.line), [1]);
  assert.deepStrictEqual(at({ key: 'QRD-1', ac, blockedBy: ['qrd-1603'] }, 'W3'), []);
  assert.deepStrictEqual(at({ key: 'QRD-1', ac, decidedRefs: ['QRD-1603'] }, 'W3'), []);
});

test('W4: a Bug needs Expected and Actual in the description or the AC', () => {
  assert.deepStrictEqual(at({ type: 'Bug', ac: ['The save button works.'] }, 'W4').map((item) => item.level), ['block']);
  assert.deepStrictEqual(at({ type: 'Bug', ac: ['Expected: the list saves.', 'Actual: nothing happens.'] }, 'W4'), []);
  assert.deepStrictEqual(at({ type: 'Bug', ac: ['Seharusnya tersimpan.'], description: 'Aktual: gagal' }, 'W4'), []);
  assert.deepStrictEqual(at({ type: 'Bug', ac: ['Expected: the list saves.'] }, 'W4').length, 1);
  assert.deepStrictEqual(at({ type: 'Task', ac: ['The save button works.'] }, 'W4'), []);
});

test('W5: summary prefix, length and implementation plan are warnings', () => {
  assert.deepStrictEqual(at({ summary: 'Show the phone number' }, 'W5').map((item) => item.level), ['warn']);
  assert.strictEqual(at({ summary: `[FE] ${'a'.repeat(100)}` }, 'W5').length, 1);
  assert.strictEqual(at({ summary: '[BE] Refactor the share resolver' }, 'W5').length, 1);
  assert.deepStrictEqual(at({ summary: '[BE][Share] Let owners revoke a link' }, 'W5'), []);
});

test('W6: agent jargon, long AC lines and three behaviours in one line are warnings', () => {
  for (const jargon of ['see File.tsx:42', 'a GUESS', 'D-12', 'task T3', 'the ledger', 'via sous', 'issue I-4']) {
    assert.strictEqual(at({ problem: `Text ${jargon} here` }, 'W6').length, 1, jargon);
  }
  assert.strictEqual(at({ ac: [Array.from({ length: 41 }, (_, index) => `w${index}`).join(' ')] }, 'W6').length, 1);
  assert.strictEqual(at({ ac: [Array.from({ length: 40 }, (_, index) => `w${index}`).join(' ')] }, 'W6').length, 0, '40 words is the most');
  assert.strictEqual(at({ ac: ['Shows A and B and C and D and E.'] }, 'W6').length, 1);
  assert.strictEqual(at({ ac: ['Shows A and B and C and D.'] }, 'W6').length, 0, 'three conjunctions are allowed; four are not');
  assert.strictEqual(at({ ac: ['Shows A and B dan C.'] }, 'W6').length, 0);
  assert.strictEqual(at({ ac: ['Shows A, B and C.'] }, 'W6').length, 0);
});

test('W7 and W8: empty story or problem, and 5 SP or more, are warnings', () => {
  assert.deepStrictEqual(at({ userStory: ' ', problem: '' }, 'W7').map((item) => item.field), ['userStory', 'problem']);
  assert.deepStrictEqual(at({ sp: 4 }, 'W8'), []);
  assert.deepStrictEqual(at({ sp: 5 }, 'W8').map((item) => item.level), ['warn']);
});

test('W9: every AC line of a [BE] ticket starts with [UI], [API] or [Dev evidence]; a warning, never a block', () => {
  const tagged: LintInput = { summary: '[BE][Contacts] Store the imported tag', ac: ['[UI] Contacts page: the imported contact shows its tag', '[API] GET /contacts/:id answers 404 for another workspace', '[Dev evidence] A migration adds the index on contacts.workspace_id'] };
  assert.deepStrictEqual(at(tagged, 'W9'), []);
  const untagged = at({ ...tagged, ac: ['[UI] Contacts page: the contact shows its tag', 'The import stores the tag', '[dev evidence] The index exists'] }, 'W9');
  assert.deepStrictEqual(untagged.map((item) => [item.line, item.level, item.field]), [[2, 'warn', 'ac']]);
  assert.strictEqual(untagged[0].text, 'AC 2 has no check tag: [UI], [API] or [Dev evidence].');
  assert.strictEqual(lintTicket({ summary: '[BE] Store it', ac: ['The import stores the tag'] }).ok, true);
  assert.deepStrictEqual(at({ summary: "[FE][Inbox] Show the contact's phone number", ac: ['The header shows the number'] }, 'W9'), [], 'an FE ticket is not checked');
  assert.deepStrictEqual(at({ summary: 'Store the tag', description: 'Repo: BE', ac: ['The import stores the tag'] }, 'W9').map((item) => item.line), [1], 'Repo: BE in the description counts');
  assert.deepStrictEqual(at({ summary: 'Store the tag', ac: ['The import stores the tag'] }, 'W9'), [], 'no side, no check');
  assert.deepStrictEqual(at({ summary: '[BE] Store it', ac: ['BE', '[API] POST /tags answers 201', 'TBD'] }, 'W9'), [], 'a group header and a placeholder line are not checked');
  const bug: LintInput = { type: 'Bug', summary: '[BE][Contacts] The import drops the tag', description: 'Expected: the tag is kept. Actual: it is dropped.' };
  assert.deepStrictEqual(at({ ...bug, ac: ['[UI] Contacts page: after importing a CSV with a tag, the contact shows that tag (today it shows none)', '[API] GET /contacts/:id returns the tag'] }, 'W9'), [], "a bug's tagged repro line passes");
  assert.deepStrictEqual(at({ ...bug, ac: ['After importing a CSV with a tag, the contact shows that tag', '[API] GET /contacts/:id returns the tag'] }, 'W9').map((item) => item.line), [1], "a bug's untagged repro line is noted");
});

test('a field the input leaves out is not checked', () => {
  assert.deepStrictEqual(lintTicket({ ac: ['The list shows 3 rows.'] }), { ok: true, findings: [] });
  assert.deepStrictEqual(lintTicket({}), { ok: true, findings: [] });
});

test('a Jira ticket is read from its detail shape: Blocks links count and the placeholder description does not', () => {
  const lint = lintJiraTicket({
    key: 'QRD-9', title: '[FE] Show it', issueType: 'Task', userStory: 'As a user, I want it', problemDefinition: 'It is missing',
    acceptanceCriteria: '- Uses QRD-1603.\n- The list shows 3 rows.', links: [{ key: 'QRD-1603', relation: 'blockedBy' }], storyPoints: 2,
    description: 'No detailed description provided in this Jira issue.',
  });
  assert.deepStrictEqual(lint, { ok: true, findings: [] });
  assert.strictEqual(lintJiraTicket({ key: 'QRD-9', title: 'x', acceptanceCriteria: null }).ok, false);
});

test('a flag reason is 5 to 300 characters', () => {
  assert.strictEqual(flagReason({ reason: 'owner ok' }), 'owner ok');
  assert.strictEqual(flagReason({ reason: ' abcd ' }), null);
  assert.strictEqual(flagReason({ reason: 'x'.repeat(301) }), null);
  assert.strictEqual(flagReason({ reason: 'x'.repeat(300) })?.length, 300);
  assert.strictEqual(flagReason(null), null);
  assert.strictEqual(flagReason({}), null);
});
