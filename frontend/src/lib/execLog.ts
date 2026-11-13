import type { AgentRun, AgentTimeline } from '../agents/runs';

/** One row of Log eksekusi: an agent's work from spawn to stop, a failure, or an event the run recorded. */
export interface ExecRow {
  at: string;
  kind: 'agent' | 'fail' | 'event';
  until: string | null;
  agent: string;
  doing: string;
  result: string;
  tools: number | null;
  seconds: number | null;
}

export type ExecFilter = 'all' | 'fail' | 'event';

/** The members of every visit, each once, with the failures and events of the run, oldest first. */
export function execRows(run: Pick<AgentRun, 'failures' | 'events'> | null, timeline: Pick<AgentTimeline, 'visits'> | null): ExecRow[] {
  const rows: ExecRow[] = [];
  const seen = new Set<string>();
  for (const visit of timeline?.visits ?? []) {
    for (const agent of visit.agents) {
      if (!agent.parentId || seen.has(agent.id)) continue;
      seen.add(agent.id);
      const since = agent.since ?? visit.from ?? null;
      if (!since) continue;
      const until = agent.until ?? null;
      rows.push({
        at: since, kind: 'agent', until, agent: agent.name, doing: agent.detail ?? '', result: agent.state === 'done' ? 'OK' : agent.state === 'waiting' ? 'nunggu' : 'jalan',
        tools: agent.tools, seconds: until ? Math.max(0, Math.round((Date.parse(until) - Date.parse(since)) / 1000)) : null,
      });
    }
  }
  for (const failure of run?.failures ?? []) {
    rows.push({ at: failure.at, kind: 'fail', until: null, agent: failure.type, doing: failure.what || failure.type, result: `GAGAL #${failure.attempt}`, tools: null, seconds: null });
  }
  for (const event of run?.events ?? []) {
    rows.push({ at: event.at, kind: 'event', until: null, agent: 'event', doing: `${event.kind}${event.detail ? ` ${event.detail}` : ''}`, result: '', tools: null, seconds: null });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

export const filterExec = (rows: ExecRow[], filter: ExecFilter) => (filter === 'all' ? rows : rows.filter((row) => row.kind === filter));

export const duration = (seconds: number | null) => (seconds === null ? '–' : seconds < 60 ? `${seconds}d` : `${Math.round(seconds / 60)}m`);
