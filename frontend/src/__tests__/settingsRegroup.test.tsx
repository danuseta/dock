import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { DiscordMessagesSection } from '../settings/sections/DiscordMessagesSection';
import { ReviewSection } from '../settings/sections/ReviewSection';
import { matchSections, savedValues, sectionFromSearch, visibleSections, SECTION_GROUPS } from '../settings/sections';

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
