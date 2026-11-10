// Whether a ticket's work has landed, read from its GitHub pull requests rather than its Jira status. A pull request
// merged into any base counts, a feature branch included; one closed without a merge is ignored.

export type MergeState = 'merged' | 'open' | 'none';
export type TicketMerge = MergeState | 'unknown';

/** merged: a merged pull request and none still open; open: any still open; none: nothing else. */
export function mergeState(pulls: Array<{ status: string; merged: boolean }>): MergeState {
  if (pulls.some((pull) => !pull.merged && pull.status === 'open')) return 'open';
  return pulls.some((pull) => pull.merged) ? 'merged' : 'none';
}

export interface MergeRead { merge: TicketMerge; pulls: string[] }

interface ListedPull { owner: string; repo: string; number?: number | string; pullNumber?: number | string; status?: string }
interface PullDetail { state?: string | null; merged_at?: string | null }

/** The parts of GitHubAPI the reader needs. */
export interface MergeGitHub {
  client(): Promise<{ getPRStatus(owner: string, repo: string, number: number): Promise<PullDetail | null | undefined> } | null>;
  cachedPullRequestsForTicket(key: string): Promise<ListedPull[] | null>;
  freshPullRequestsForTicket(key: string): Promise<{ prs: ListedPull[]; complete: boolean }>;
}

export const MERGE_CONCURRENCY = 6;

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

/**
 * The merge state of every ticket, at most MERGE_CONCURRENCY GitHub requests in flight. A ticket whose search came back
 * incomplete is unknown. Null when there is no GitHub token or a read fails, so the caller falls back to Jira.
 */
export async function readMergeStates(keys: string[], github: MergeGitHub): Promise<Map<string, MergeRead> | null> {
  try {
    const gh = await github.client();
    if (!gh) return null;
    const lists = await mapLimit(keys, MERGE_CONCURRENCY, async (key) => {
      const cached = await github.cachedPullRequestsForTicket(key);
      if (cached && cached.length) return { key, pulls: cached, complete: true };
      const fresh = await github.freshPullRequestsForTicket(key);
      return { key, pulls: fresh.prs || [], complete: fresh.complete };
    });
    const pulls = lists.flatMap((list) => list.pulls.map((pull) => ({ key: list.key, owner: pull.owner, repo: pull.repo, number: Number(pull.number || pull.pullNumber), status: String(pull.status || 'open') })));
    const details = await mapLimit(pulls, MERGE_CONCURRENCY, async (pull) => {
      if (pull.status === 'merged') return { status: 'closed', merged: true };
      const detail = await gh.getPRStatus(pull.owner, pull.repo, pull.number);
      return { status: String(detail?.state ?? 'open'), merged: Boolean(detail?.merged_at) };
    });
    const result = new Map<string, MergeRead>();
    for (const list of lists) {
      const own = pulls.map((pull, index) => ({ pull, detail: details[index] })).filter(({ pull }) => pull.key === list.key);
      result.set(list.key, {
        merge: list.complete ? mergeState(own.map(({ detail }) => detail)) : 'unknown',
        pulls: own.map(({ pull }) => `${pull.owner}/${pull.repo}#${pull.number}`),
      });
    }
    return result;
  } catch {
    return null;
  }
}
