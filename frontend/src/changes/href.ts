/** Links into Perubahan kode, the Blackboard view of a ticket's pull requests, from the places DOCK shows a pull request. */
import { blackboardFileHref, pullEntry } from '../lib/blackboard';

export type ChangesFrom = 'agents' | 'board' | 'ticket' | 'discord' | 'sessions';

/** The repository name of a pull request link, an owner/repo name or a bare name. */
export function repoName(value: string): string {
  const pull = /github\.com\/[^/]+\/([^/]+)\/pull\//.exec(value);
  if (pull) return pull[1];
  return value.split('/').filter(Boolean).pop() ?? value;
}

export function changesHref(ticketKey: string, repo: string | null, from: ChangesFrom, session?: string): string {
  const query = new URLSearchParams({ from });
  if (session) query.set('session', session);
  return `${blackboardFileHref(ticketKey, pullEntry(repo ? repoName(repo) : null))}&${query.toString()}`;
}

/** An old /changes?ticket=…&repo=…&from=… link (bookmark, PWA, notification) as its Blackboard link; the file to open rides along. */
export function changesRedirect(search: string): string {
  const query = new URLSearchParams(search);
  const ticket = query.get('ticket');
  if (!ticket) return '/blackboard';
  const href = changesHref(ticket, query.get('repo'), (query.get('from') as ChangesFrom | null) || 'board', query.get('session') ?? undefined);
  const file = query.get('file');
  return file ? `${href}&path=${encodeURIComponent(file)}` : href;
}
