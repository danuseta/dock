/** What one round of the orchestrator cron did, as the server reports it. */
export interface RoundLog { at: string; skipped: string | null; started: string[]; parked: string[]; notMoved: string[]; failed: string[] }

export function roundSummary(round: RoundLog | null): string {
  if (!round) return 'No round has run yet.';
  const when = new Date(round.at).toLocaleString();
  if (round.skipped) return `${when}: skipped, ${round.skipped}.`;
  const parts = [
    `started ${round.started.join(', ') || 'nothing'}`,
    round.parked.length ? `parked ${round.parked.join(', ')}` : '',
    round.notMoved.length ? `Jira did not move ${round.notMoved.join(', ')}` : '',
    round.failed.length ? `failed ${round.failed.join(', ')}` : '',
  ].filter(Boolean);
  return `${when}: ${parts.join('; ')}.`;
}
