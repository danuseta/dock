import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinishSetupView } from '../components/FinishSetupView';
import { setupGaps } from '../lib/setupStatus';

test('every missing item is listed with the Settings section that fixes it', () => {
  assert.deepStrictEqual(setupGaps({}).map((gap) => gap.section), ['jira', 'github', 'security']);
  assert.strictEqual(setupGaps({ jiraUrl: 'a.atlassian.net' })[0].missing, 'email, API token');
  assert.deepStrictEqual(setupGaps({ jiraUrl: 'a', jiraEmail: 'b', hasJiraApiToken: true, hasMasterPin: true }).map((gap) => gap.section), ['github']);
});

test('nothing is missing once Jira, GitHub and the PIN are set', () => {
  assert.deepStrictEqual(setupGaps({ jiraUrl: 'a', jiraEmail: 'b', hasJiraApiToken: true, hasGithubToken: true, hasMasterPin: true }), []);
});

test('the Finish setup card shows what is missing and hides when nothing is', () => {
  const shown = renderToStaticMarkup(<FinishSetupView gaps={setupGaps({ hasGithubToken: true })} onNavigate={() => undefined} />);
  assert.match(shown, /Finish setup/);
  assert.match(shown, /Jira: URL, email, API token/);
  assert.match(shown, /Security: PIN/);
  assert.doesNotMatch(shown, /GitHub:/);
  assert.strictEqual(renderToStaticMarkup(<FinishSetupView gaps={[]} onNavigate={() => undefined} />), '');
});

test('Home renders the card and leaves the rest as it was', () => {
  const home = readFileSync(new URL('../pages/HomePage.tsx', import.meta.url), 'utf8');
  assert.match(home, /<FinishSetupCard onNavigate=\{onNavigate\} \/>/);
});
