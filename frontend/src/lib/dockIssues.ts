export type DockIssueFilter = 'OPEN' | 'CLOSED' | 'MINE';

export const ISSUE_FILTERS: Array<{ id: DockIssueFilter; label: string }> = [
  { id: 'OPEN', label: 'Open' },
  { id: 'CLOSED', label: 'Closed' },
  { id: 'MINE', label: 'Mine' },
];

export interface DockIssueAuthor { login: string; avatarUrl: string }

export interface DockIssueSummary {
  number: number;
  title: string;
  state: string;
  author: DockIssueAuthor;
  createdAt: string;
  updatedAt: string;
  comments: number;
  url: string;
}

/** The search box matches a title or an issue number, with or without the #. */
export function matchesIssue(issue: Pick<DockIssueSummary, 'number' | 'title'>, query: string): boolean {
  const text = query.trim().toLowerCase().replace(/^#/, '');
  return !text || issue.title.toLowerCase().includes(text) || String(issue.number).includes(text);
}

/** One link per line; blank lines are dropped. */
export const imageLinksOf = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter(Boolean);

/** What the form shows under Environment; the server adds the branch and the reporter when it builds the issue. */
export const environmentPreview = (page: string, mode: string, build: string | null): string =>
  [`Page: ${page}`, `Build: ${build ?? 'unknown'}`, `DOCK_MODE: ${mode}`, 'Branch and reporter are added by DOCK.'].join('\n');
