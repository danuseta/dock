import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GraphQLError } from 'graphql';
import { dockMode } from '../mode';

export const DRAFT_URL_LIMIT = 7000;
const TRIMMED = ' (trimmed to fit the GitHub link)';
const TITLE_LIMIT = 200;
const PAGE_LIMIT = 200;
const LINK_LIMIT = 10;

export interface IssueDraft {
  title: string;
  happened: string;
  steps?: string | null;
  expected?: string | null;
  imageLinks?: string[] | null;
  page: string;
}

export interface IssueEnvironment {
  build: string | null;
  mode: string;
  branch: string;
  page: string;
  reporter: string;
}

export interface DockIssueSource {
  number: number;
  title: string;
  state: string;
  body?: string | null;
  html_url: string;
  comments: number;
  created_at: string;
  updated_at: string;
  user?: { login?: string; avatar_url?: string } | null;
  pull_request?: unknown;
}

/** The build a page belongs to: the hashed name of its entry script, the same value the running page reads from its own script tag. */
export const buildOf = (indexHtml: string): string | null => indexHtml.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;

export const issuesRepo = (): string => process.env.DOCK_ISSUES_REPO?.trim() || 'danuseta/dock';

export const reporterName = (): string => process.env.GIT_AUTHOR_NAME?.trim() || process.env.CODER_WORKSPACE_OWNER_NAME?.trim() || 'Danu';

/** The short commit of the app checkout; the asset name of the page when git or .git is missing. */
export function resolveBuild(appRoot: string, assetBuild: string | null): string | null {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(appRoot) },
    }).trim();
    if (commit) return commit;
  } catch {
    return assetBuild;
  }
  return assetBuild;
}

let cachedBuild: string | null | undefined;

export function currentBuild(): string | null {
  if (cachedBuild === undefined) {
    const indexPath = path.join(path.resolve(process.env.FRONTEND_DIST_PATH || path.resolve(__dirname, '../../../../frontend/dist')), 'index.html');
    cachedBuild = resolveBuild(path.resolve(__dirname, '../../../..'), existsSync(indexPath) ? buildOf(readFileSync(indexPath, 'utf8')) : null);
  }
  return cachedBuild;
}

export const dockIssueError = (error: any): GraphQLError => new GraphQLError(String(error.response?.data?.message ?? error.message));

const clip = (text: string, length: number): string => {
  const characters = Array.from(text);
  return characters.length > length ? `${characters.slice(0, length).join('')}${TRIMMED}` : text;
};

export const issueTitle = (title: string): string => Array.from(title.trim()).slice(0, TITLE_LIMIT).join('');

/** The page a report came from, as a path: no spaces or line breaks, starts with a slash. */
export const pagePath = (page: string): string => {
  const text = page.replace(/\s+/g, '');
  return (text.startsWith('/') ? text : '/').slice(0, PAGE_LIMIT);
};

export const issueEnvironment = (page: string): IssueEnvironment => ({
  build: currentBuild(),
  mode: dockMode(),
  branch: process.env.DOCK_BRANCH?.trim() || 'unknown',
  page: pagePath(page),
  reporter: reporterName(),
});

/** The issue text the Post button and the Continue on GitHub page both use. */
export function buildIssueBody(draft: IssueDraft, environment: IssueEnvironment): string {
  const sections = [`## What happened\n\n${draft.happened.trim()}`];
  if (draft.steps?.trim()) sections.push(`## Steps to reproduce\n\n${draft.steps.trim()}`);
  if (draft.expected?.trim()) sections.push(`## Expected\n\n${draft.expected.trim()}`);
  const images = (draft.imageLinks ?? []).map((link) => link.trim()).filter((link) => /^https?:\/\/[^\s<>]+$/i.test(link));
  if (images.length) sections.push(`## Screenshots\n\n${images.map((link) => `![screenshot](<${link}>)`).join('\n')}`);
  sections.push(`## Environment\n\n- Build: ${environment.build ?? 'unknown'}\n- DOCK_MODE: ${environment.mode}\n- Branch: ${environment.branch}\n- Page: ${environment.page}\n- Reported by: ${environment.reporter}`);
  return sections.join('\n\n');
}

/** A GitHub new-issue page with the same title and body; the long texts are cut until the address fits. */
export function draftUrl(repo: string, draft: IssueDraft, environment: IssueEnvironment): string {
  const title = encodeURIComponent(issueTitle(draft.title));
  const urlOf = (candidate: IssueDraft) => `https://github.com/${repo}/issues/new?title=${title}&body=${encodeURIComponent(buildIssueBody(candidate, environment))}`;
  let candidate: IssueDraft = { ...draft, imageLinks: (draft.imageLinks ?? []).slice(0, LINK_LIMIT) };
  let cut = Math.max(...[draft.happened, draft.steps, draft.expected].map((text) => Array.from(text ?? '').length));
  let url = urlOf(candidate);
  while (url.length > DRAFT_URL_LIMIT && cut > 0) {
    cut = Math.floor(cut * 0.8);
    const trim = (text?: string | null) => (text ? clip(text, cut) : text);
    candidate = { ...candidate, happened: clip(draft.happened, cut), steps: trim(draft.steps), expected: trim(draft.expected) };
    url = urlOf(candidate);
  }
  for (const optional of ['steps', 'expected', 'imageLinks'] as const) {
    if (url.length <= DRAFT_URL_LIMIT) break;
    candidate = { ...candidate, [optional]: null };
    url = urlOf(candidate);
  }
  return url;
}

export function toDockIssue(raw: DockIssueSource) {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    author: { login: raw.user?.login ?? 'ghost', avatarUrl: raw.user?.avatar_url ?? '' },
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    comments: raw.comments,
    url: raw.html_url,
    body: raw.body ?? '',
  };
}
