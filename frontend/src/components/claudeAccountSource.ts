const time = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One line saying where an account's numbers come from: the probe, or a turn that ran on this account's own token. */
export const usageSource = (account: { source?: string | null; seenAt: string | null; checkedAt: string | null }) => {
  if (account.source === 'status' && account.seenAt) return `Seen ${time(account.seenAt)} from a turn`;
  if (account.checkedAt) return `Checked ${time(account.checkedAt)}`;
  return 'no usage seen yet';
};
