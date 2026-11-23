import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { DiscordMessagesSection } from '../settings/sections/DiscordMessagesSection';
import { ReviewSection } from '../settings/sections/ReviewSection';
import { matchSections, savedValues, sectionErrors, sectionFromSearch, sectionInput, visibleSections, SECTION_GROUPS } from '../settings/sections';

const workspace = visibleSections('workspace');
const values = savedValues({});
const noop = () => undefined;

test('the rail has four groups in order, with the spec sections in each', () => {
  assert.deepStrictEqual(SECTION_GROUPS, ['You', 'Connections', 'Automation', 'Messages & plugins']);
  const ids = (group: string) => workspace.filter((section) => section.group === group).map((section) => section.id);
  assert.deepStrictEqual(ids('You'), ['general', 'chat', 'notifications', 'security', 'claude']);
  assert.deepStrictEqual(ids('Connections'), ['jira', 'github', 'discord', 'machines']);
  assert.deepStrictEqual(ids('Automation'), ['review', 'planflow', 'sousflow', 'judge']);
  assert.deepStrictEqual(ids('Messages & plugins'), ['messages', 'plugins']);
});

test('old section ids still open their new section', () => {
  assert.strictEqual(sectionFromSearch('?section=demo', workspace), 'plugins');
  assert.strictEqual(sectionFromSearch('?section=tokens', workspace), 'machines');
  assert.strictEqual(sectionFromSearch('?section=review', workspace), 'review');
});

test('search matches section labels and field labels, ignoring case', () => {
  const ids = (query: string) => matchSections(workspace, query).map((section) => section.id);
  assert.deepStrictEqual(ids('lgtm'), ['review']);
  assert.deepStrictEqual(ids('MACHINES'), ['machines']);
  assert.deepStrictEqual(ids('webhook'), ['discord']);
  assert.deepStrictEqual(ids('zzz'), []);
  assert.strictEqual(ids('  ').length, workspace.length);
});

test('Discord is connection only, Review has the three toggles, Messages has the template', () => {
  const discord = readFileSync(new URL('../settings/sections/DiscordSection.tsx', import.meta.url), 'utf8');
  assert.match(discord, /Webhook URL/);
  assert.match(discord, /Your Discord user id/);
  assert.doesNotMatch(discord, /Auto review|autoReviewOnIt|autoLgtm|reviewFindingsToTask|discordMessageTemplate/);
  const review = renderToStaticMarkup(<ReviewSection values={values.review} set={noop} />);
  assert.match(review, /Review when I say on it/);
  assert.match(review, /LGTM when the review is clean/);
  assert.match(review, /Send review findings to the Task session/);
  const messages = renderToStaticMarkup(<DiscordMessagesSection values={values.messages} set={noop} />);
  assert.match(messages, /Message template/);
  assert.match(messages, /Preview/);
});

test('Review has the arena settings and the locked stop word, and a number out of range blocks the save', () => {
  const review = renderToStaticMarkup(<ReviewSection values={values.review} set={noop} />);
  for (const text of ['Post the review to the thread', 'Reply after a fix', 'Post delay', 'Re-review wait', 'Max rounds', 'Stop word', 'stop dock']) assert.match(review, new RegExp(text));
  assert.deepStrictEqual(sectionErrors('review', values.review), []);
  assert.strictEqual(sectionErrors('review', { ...values.review, reviewMaxRounds: '11' }).length, 1);
  assert.strictEqual(sectionErrors('review', { ...values.review, reviewPostDelayMinutes: '' }).length, 1);
  const input = sectionInput('review', { ...values.review, reviewPostDelayMinutes: '5' });
  assert.strictEqual(input.reviewPostDelayMinutes, 5, 'the Int keys are sent as numbers');
  assert.strictEqual(input.autoReviewPostDiscord, 'true');
  assert.deepStrictEqual([values.review.reviewPostDelayMinutes, values.review.reviewReReviewWaitMinutes, values.review.reviewMaxRounds], ['2', '10', '3']);
});

test('Discord messages has the review post and reply formats, a skill picker, a preview and the read-only marker', () => {
  const html = renderToStaticMarkup(<DiscordMessagesSection values={{ ...values.messages, reviewPostFormat: 'template', reviewReplyFormat: 'skill' }} set={noop} skills={['review-message', 'my-skill']} />);
  for (const text of ['Review post', 'Review reply', 'DOCK template', 'DOCK default', 'Skill', '{{author}}', 'preview', 'DOCK-REVIEW on it by', 'DOCK-FIX round 2']) assert.ok(html.includes(text), text);
  assert.match(html, /aria-label="Review reply skill"/);
  assert.match(html, /aria-label="Review post template"/);
  assert.match(html, /cannot be changed/);
  assert.deepStrictEqual([values.messages.reviewPostFormat, values.messages.reviewReplyFormat], ['skill', 'builtin']);
  assert.strictEqual(sectionErrors('messages', { ...values.messages, reviewPostFormat: 'template', reviewPostTemplate: '  ' }).length, 1);
  assert.strictEqual(sectionErrors('messages', { ...values.messages, reviewReplyFormat: 'skill', reviewReplySkill: 'Bad Name' }).length, 1);
  assert.deepStrictEqual(sectionErrors('messages', values.messages), []);
});

test('Sous flow has the light runner card with its editable rows and the locked rules', () => {
  const card = readFileSync(new URL('../settings/sections/LightRunnerCard.tsx', import.meta.url), 'utf8');
  for (const key of ['lightRunnerOn', 'lightForFindings', 'lightForParty', 'lightForRetro', 'lightMaxLines', 'lightMaxFiles', 'lightWorkerModel', 'lightBrowserCheck', 'lightBlastCheck', 'lightBlastLoops', 'lightPublish']) assert.ok(card.includes(key), key);
  for (const locked of ['Scout (step 1)', 'One repo per job', 'No AC, scope or contract change', 'Verifier', 'Gate fails mid-run']) assert.ok(card.split('<SettingRow ').some((row) => row.startsWith('label="' + locked) && row.includes('<LockedValue>') && !row.includes('<Number')), locked);
  assert.match(readFileSync(new URL('../settings/sections/SousFlowSection.tsx', import.meta.url), 'utf8'), /<LightRunnerCard \/>/);
});
