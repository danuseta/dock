import 'dotenv/config';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { StorageAPI } from '../datasources/StorageAPI';
import { atlassianBaseUrl } from '../integrations/jira';
import { prisma } from '../storage/client';

export interface SetupValues {
  jiraUrl?: string;
  jiraEmail?: string;
  jiraToken?: string;
  githubToken?: string;
  pin?: string;
}

type SetupStore = Pick<StorageAPI, 'updateSettings' | 'setMasterPin' | 'getPublicSettings'>;
type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number }>;

const FLAGS: Record<string, keyof SetupValues> = {
  '--jira-url': 'jiraUrl',
  '--jira-email': 'jiraEmail',
  '--jira-token': 'jiraToken',
  '--github-token': 'githubToken',
  '--pin': 'pin',
};
const ENV_NAMES: Record<keyof SetupValues, string> = {
  jiraUrl: 'DOCK_SETUP_JIRA_URL',
  jiraEmail: 'DOCK_SETUP_JIRA_EMAIL',
  jiraToken: 'DOCK_SETUP_JIRA_TOKEN',
  githubToken: 'DOCK_SETUP_GITHUB_TOKEN',
  pin: 'DOCK_SETUP_PIN',
};

const cleanDomain = (url: string) => url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

export function parseSetupArgs(argv: string[], env: NodeJS.ProcessEnv = {}): SetupValues {
  const values: SetupValues = {};
  for (const key of Object.keys(ENV_NAMES) as Array<keyof SetupValues>) {
    const fromEnv = env[ENV_NAMES[key]]?.trim();
    if (fromEnv) values[key] = fromEnv;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    const key = FLAGS[flag];
    if (!key) throw new Error(`Unknown option ${flag}`);
    const value = (inline ?? argv[index += 1])?.trim();
    if (!value) throw new Error(`${flag} needs a value`);
    values[key] = value;
  }
  if (values.jiraUrl) values.jiraUrl = cleanDomain(values.jiraUrl);
  return values;
}

const basic = (email: string, token: string) => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

async function check(fetchFn: FetchLike, url: string, headers: Record<string, string>, name: string): Promise<string | null> {
  try {
    const response = await fetchFn(url, { headers });
    if (response.ok) return null;
    return response.status === 401 || response.status === 403 ? `${name} rejected the credentials (${response.status}).` : `${name} answered ${response.status}.`;
  } catch {
    return `Could not reach ${name}.`;
  }
}

export const validateJira = (values: SetupValues, fetchFn: FetchLike) => check(
  fetchFn,
  `${atlassianBaseUrl(values.jiraUrl ?? '')}/rest/api/3/myself`,
  { Authorization: basic(values.jiraEmail ?? '', values.jiraToken ?? ''), Accept: 'application/json' },
  'Jira',
);

export const validateGithub = (values: SetupValues, fetchFn: FetchLike) => check(
  fetchFn,
  'https://api.github.com/user',
  { Authorization: `Bearer ${values.githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dock-setup' },
  'GitHub',
);

export const validatePin = (pin: string) => (/^\d{4,6}$/.test(pin) ? null : 'The PIN is 4 to 6 digits.');

export async function runSetup(store: SetupStore, values: SetupValues, fetchFn: FetchLike): Promise<{ saved: string[]; errors: string[] }> {
  const errors: string[] = [];
  const found = (error: string | null) => { if (error) errors.push(error); };
  const hasJira = Boolean(values.jiraUrl || values.jiraEmail || values.jiraToken);
  if (hasJira && !(values.jiraUrl && values.jiraEmail && values.jiraToken)) errors.push('Jira needs a URL, an email and an API token together.');
  else if (hasJira) found(await validateJira(values, fetchFn));
  if (values.githubToken) found(await validateGithub(values, fetchFn));
  if (values.pin) found(validatePin(values.pin) ?? ((await store.getPublicSettings()).hasMasterPin ? 'A PIN is already set. Change it in Settings, Security.' : null));
  if (errors.length > 0) return { saved: [], errors };
  const saved: string[] = [];
  if (hasJira) {
    if (await store.updateSettings({ jiraUrl: values.jiraUrl, jiraEmail: values.jiraEmail, jiraApiToken: values.jiraToken })) saved.push('Jira');
    else errors.push('Jira could not be saved.');
  }
  if (values.githubToken) {
    if (await store.updateSettings({ githubToken: values.githubToken })) saved.push('GitHub');
    else errors.push('GitHub could not be saved.');
  }
  if (values.pin) {
    if (await store.setMasterPin(values.pin)) saved.push('PIN');
    else errors.push('The PIN could not be saved.');
  }
  return { saved, errors };
}

function prompter() {
  let hidden = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stdout.write(chunk, encoding); done(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  const ask = (label: string, secret = false) => new Promise<string>((resolve) => {
    process.stdout.write(`${label}: `);
    hidden = secret;
    rl.question('', (answer) => {
      hidden = false;
      if (secret) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
  return { ask, close: () => rl.close() };
}

async function fillMissing(store: SetupStore, values: SetupValues): Promise<SetupValues> {
  const saved = await store.getPublicSettings();
  const next = { ...values };
  const { ask, close } = prompter();
  try {
    process.stdout.write('Required: Jira, GitHub and a PIN. Discord, Calendar and plugins can be set later in Settings, or by asking Guild Master.\n');
    if (saved.jiraUrl && saved.jiraEmail && saved.hasJiraApiToken) process.stdout.write('Jira is already set.\n');
    else {
      next.jiraUrl ||= cleanDomain(await ask('Jira URL (company.atlassian.net)'));
      next.jiraEmail ||= await ask('Jira email');
      next.jiraToken ||= await ask('Jira API token', true);
    }
    if (saved.hasGithubToken) process.stdout.write('GitHub is already set.\n');
    else next.githubToken ||= await ask('GitHub token', true);
    if (saved.hasMasterPin) process.stdout.write('A PIN is already set.\n');
    else next.pin ||= await ask('PIN (4 to 6 digits)', true);
  } finally {
    close();
  }
  return next;
}

async function main() {
  const store = new StorageAPI();
  const given = parseSetupArgs(process.argv.slice(2), process.env);
  const interactive = Boolean(process.stdin.isTTY);
  const values = interactive ? await fillMissing(store, given) : given;
  if (Object.values(values).every((value) => !value)) {
    process.stdout.write(interactive ? 'Nothing left to set.\n' : 'Nothing to set. Pass --jira-url --jira-email --jira-token --github-token --pin, or DOCK_SETUP_* variables.\n');
    return;
  }
  const { saved, errors } = await runSetup(store, values, (url, init) => fetch(url, init));
  if (saved.length > 0) process.stdout.write(`Saved: ${saved.join(', ')}.\n`);
  for (const error of errors) process.stderr.write(`${error}\n`);
  if (errors.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'unknown error'}\n`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
