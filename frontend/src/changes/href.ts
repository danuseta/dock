/** Links into the Changes page from the places DOCK shows a pull request. */

export type ChangesFrom = 'agents' | 'board' | 'ticket' | 'discord';

/** The repository name of a pull request link, an owner/repo name or a bare name. */
export function repoName(value: string): string {
  const pull = /github\.com\/[^/]+\/([^/]+)\/pull\//.exec(value);
  if (pull) return pull[1];
  return value.split('/').filter(Boolean).pop() ?? value;
}

export function changesHref(ticketKey: string, repo: string | null, from: ChangesFrom): string {
  const query = new URLSearchParams({ ticket: ticketKey });
  if (repo) query.set('repo', repoName(repo));
  query.set('from', from);
  return `/changes?${query.toString()}`;
}
