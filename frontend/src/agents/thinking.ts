import { FLOW_RAIL } from './runs';

/** One row of a run's Thinking column and log, as the backend's runThinking returns it. */
export interface ThinkingOption { label: string; why: string | null; chosen: boolean }
export interface ThinkingRow {
  id: string;
  at: string;
  stageIndex: number;
  round: number;
  agent: string;
  kind: 'ask' | 'decide' | 'did' | 'event' | string;
  topic: 'thinking' | 'owner' | 'agent' | 'git' | 'stage' | string;
  text: string;
  answer: string | null;
  options: ThinkingOption[];
  flag: string | null;
}
export interface ThinkingRawLine { at: string; agent: string; kind: string; text: string }

export type RowFilter = 'all' | 'thinking' | 'events' | 'owner' | 'agents' | 'git' | 'problems';
export interface RowScope { stageIndex?: number; round?: number; agent?: string }

export const isThinking = (row: ThinkingRow) => row.kind !== 'event';

export function matchesFilter(row: ThinkingRow, filter: RowFilter): boolean {
  switch (filter) {
    case 'thinking': return isThinking(row);
    case 'events': return !isThinking(row);
    case 'owner': return row.agent === 'owner' || row.topic === 'owner';
    case 'agents': return row.agent !== 'owner' && row.agent !== 'DOCK';
    case 'git': return row.topic === 'git';
    case 'problems': return Boolean(row.flag);
    default: return true;
  }
}

export function filterRows(rows: ThinkingRow[], filter: RowFilter, scope: RowScope | null): ThinkingRow[] {
  return rows.filter((row) => matchesFilter(row, filter)
    && (scope?.stageIndex == null || (row.stageIndex === scope.stageIndex && (scope.round == null || row.round === scope.round)))
    && (!scope?.agent || row.agent === scope.agent));
}

export const stopName = (index: number, review = false) => {
  const stop = FLOW_RAIL[Math.min(Math.max(index, 0), FLOW_RAIL.length - 1)];
  return review ? stop.review : stop.name;
};

/** Rows in their stage and round, keeping the order they came in (newest first). */
export function groupRows(rows: ThinkingRow[]): Array<{ key: string; stageIndex: number; round: number; rows: ThinkingRow[] }> {
  const groups: Array<{ key: string; stageIndex: number; round: number; rows: ThinkingRow[] }> = [];
  for (const row of rows) {
    const key = `${row.stageIndex}-${row.round}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, stageIndex: row.stageIndex, round: row.round, rows: [row] });
  }
  return groups;
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The row after this one in time, so the raw layer stops where the next thing began. */
export const nextAt = (rows: ThinkingRow[], row: ThinkingRow) => {
  const later = rows.filter((other) => Date.parse(other.at) > Date.parse(row.at)).map((other) => other.at).sort();
  return later[0] ?? null;
};

export function rowsMarkdown(key: string, rows: ThinkingRow[], review = false): string {
  const lines = [`# ${key} · log`];
  for (const group of groupRows(rows)) {
    lines.push('', `## ${stopName(group.stageIndex, review)} · R${group.round}`, '');
    for (const row of group.rows) {
      const when = new Date(row.at).toISOString().slice(0, 16).replace('T', ' ');
      lines.push(`- ${when} **${row.agent}** ${isThinking(row) ? `${row.kind} ` : ''}${row.text}${row.answer ? ` → ${row.answer}` : ''}${row.flag ? ` _(${row.flag})_` : ''}`);
      for (const option of row.options) lines.push(`  - ${option.chosen ? '✓' : '✗'} ${option.label}${option.why ? `: ${option.why}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
