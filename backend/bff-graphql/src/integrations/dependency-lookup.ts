export type DependencyInfo = { title?: string; assignee?: string | null; status?: string | null };

const HIT_TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 2 * 60 * 1000;
const MAX_KEYS = 20;

const memo = new Map<string, { value: DependencyInfo | null; fetchedAt: number }>();

export function resetDependencyLookup() {
  memo.clear();
}

export async function lookupDependencies(
  keys: string[],
  fetchTicket: (key: string) => Promise<any>,
  now: () => number = Date.now,
): Promise<Map<string, DependencyInfo>> {
  const found = new Map<string, DependencyInfo>();
  await Promise.all([...new Set(keys)].slice(0, MAX_KEYS).map(async (key) => {
    const cached = memo.get(key);
    if (cached && now() - cached.fetchedAt < (cached.value ? HIT_TTL_MS : MISS_TTL_MS)) {
      if (cached.value) found.set(key, cached.value);
      return;
    }
    let value: DependencyInfo | null = null;
    try {
      const ticket = await fetchTicket(key);
      if (ticket) value = { title: ticket.title, assignee: ticket.assignee ?? null, status: ticket.status ?? null };
    } catch { /* lookup failed: remembered as a miss */ }
    memo.set(key, { value, fetchedAt: now() });
    if (value) found.set(key, value);
  }));
  return found;
}
