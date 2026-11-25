export interface GitHubQuota {
  limited: boolean;
  remaining: number | null;
  resetAt: string | null;
}

export const LOW_GITHUB_QUOTA = 500;

const localTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function githubQuotaText(quota: GitHubQuota | null | undefined, formatTime: (iso: string) => string = localTime): string | null {
  if (!quota) return null;
  if (quota.limited) return `GitHub quota used up — data from cache until ${quota.resetAt ? formatTime(quota.resetAt) : 'the reset'}`;
  if (quota.remaining !== null && quota.remaining < LOW_GITHUB_QUOTA) return `GitHub quota low (${quota.remaining} left) — background refresh paused`;
  return null;
}
