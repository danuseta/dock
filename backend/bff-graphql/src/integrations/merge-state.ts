// Whether a ticket's work has landed, read from its GitHub pull requests rather than its Jira status. A pull request
// merged into any base counts, a feature branch included; one closed without a merge is ignored.

export type MergeState = 'merged' | 'open' | 'none';
export type TicketMerge = MergeState | 'unknown';

/** merged: a merged pull request and none still open; open: any still open; none: nothing else. */
export function mergeState(pulls: Array<{ status: string; merged: boolean }>): MergeState {
  if (pulls.some((pull) => !pull.merged && pull.status === 'open')) return 'open';
  return pulls.some((pull) => pull.merged) ? 'merged' : 'none';
}

/** pulls reads `owner/repo#n · merged|open|closed` for each of the ticket's own pull requests. */
export interface MergeRead { merge: TicketMerge; pulls: string[] }

interface ListedPull { owner: string; repo: string; number?: number | string; pullNumber?: number | string; status?: string; title?: string; headBranch?: string }

/**
 * Whether a pull request is the ticket's own work: its branch names the key, or its title does before the first colon
 * ("feat(QRD-1292): ...", "QRD-1306 fix: ..."). The docs sync a bot opens after a merge ("docs: sync for #1115
 * (QRD-1292)" on docs/auto-update/QRD-1292-pr-1115) names the key in its branch too, so it is left out by name; so is
 * a PR that only mentions the key elsewhere. Neither holds a merged ticket open.
 */
export function ownPull(key: string, pull: { title?: string; headBranch?: string }): boolean {
  const normalized = key.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(normalized)) return false;
  if (/^docs\/auto-update\//i.test(String(pull.headBranch ?? '')) || /^docs: sync for #\d+/i.test(String(pull.title ?? ''))) return false;
  const exact = new RegExp(`(^|[^A-Z0-9_])${normalized}(?![A-Z0-9_])`, 'i');
  const lead = String(pull.title ?? '').split(':')[0];
  return exact.test(String(pull.headBranch ?? '')) || exact.test(lead);
}

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
      if (cached && cached.length) return { key, pulls: cached.filter((pull) => ownPull(key, pull)), complete: true };
      const fresh = await github.freshPullRequestsForTicket(key);
      return { key, pulls: (fresh.prs || []).filter((pull) => ownPull(key, pull)), complete: fresh.complete };
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
        pulls: own.map(({ pull, detail }) => `${pull.owner}/${pull.repo}#${pull.number} · ${detail.merged ? 'merged' : detail.status === 'open' ? 'open' : 'closed'}`),
      });
    }
    return result;
  } catch {
    return null;
  }
}
