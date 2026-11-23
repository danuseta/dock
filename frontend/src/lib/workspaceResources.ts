/** Home › Workspace resources: what the BFF reads from the workspace's cgroup and proc files, and how Home shows it. */
import type { NotifyEvent } from './notificationEvents';

export interface ResourceKind { kind: string; bytes: number; count: number }
export interface ResourceGroup { key: string | null; bytes: number; count: number; kinds: ResourceKind[]; worktrees: string[] }
export interface ResourceLeftover { ticketKey: string; status: string | null; bytes: number; count: number; worktrees: string[] }
export interface WorkspaceResources {
  at: string;
  memory: { current: number; max: number | null; anon: number | null; samples: Array<{ at: string; bytes: number }> };
  cpu: { percent: number | null; limit: number | null; load1: number | null };
  disk: { total: number; used: number } | null;
  oom: { total: number; today: number };
  worktrees: number;
  tickets: ResourceGroup[];
  base: ResourceGroup;
  leftovers: ResourceLeftover[];
}

export const RESOURCES_POLL_MS = 5000;
const GB = 1024 ** 3;

/** Bytes as gigabytes with one decimal: "10.3". */
export const gb = (bytes: number) => (bytes / GB).toFixed(1);

const KIND_LABEL: Record<string, string> = { claude: 'Claude', mcp: 'MCP', dev: 'dev', tests: 'tests', ffmpeg: 'ffmpeg', dock: 'DOCK', codeServer: 'code-server', other: 'other' };
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/** "Claude 0.4 · MCP 0.6 · dev 1.0": a group's memory per kind, biggest first. */
export const breakdown = (group: Pick<ResourceGroup, 'kinds'>) => group.kinds.map((kind) => `${kindLabel(kind.kind)} ${gb(kind.bytes)}`).join(' · ');

/** Share of the limit in percent, or null without a limit. */
export const memoryPercent = (memory: WorkspaceResources['memory']) => (memory.max ? Math.min(100, Math.round((memory.current / memory.max) * 100)) : null);

/** Near the limit: the bar turns to the warning tone above 93%. */
export const memoryTight = (memory: WorkspaceResources['memory']) => (memoryPercent(memory) ?? 0) > 93;

/**
 * The sparkline's points in a width x height box, scaled from half the limit to the limit (or the highest sample
 * without a limit); `limitY` is where the limit line sits.
 */
export function sparkline(memory: WorkspaceResources['memory'], width = 200, height = 38): { points: string; limitY: number; low: number; high: number } {
  const high = memory.max ?? Math.max(1, ...memory.samples.map((sample) => sample.bytes));
  const low = high / 2;
  const y = (bytes: number) => (height - 2 - (Math.min(high, Math.max(low, bytes)) - low) / (high - low) * (height - 4)).toFixed(1);
  const count = memory.samples.length;
  const points = memory.samples.map((sample, index) => `${(count <= 1 ? width : (index / (count - 1)) * width).toFixed(1)},${y(sample.bytes)}`).join(' ');
  return { points, limitY: Number(y(high)), low, high };
}

/**
 * A notice when today's OOM kill count went up since the previous look; the first look only remembers, so opening
 * Home never replays an older kill.
 */
export function newOomKills(previous: number | null, today: number): { seen: number; events: NotifyEvent[] } {
  const events: NotifyEvent[] = previous !== null && today > previous ? [{
    event: 'needsYou',
    tag: 'workspace-oom',
    title: 'Workspace ran out of memory',
    body: `${today} OOM ${today === 1 ? 'kill' : 'kills'} today. Home shows where the memory goes.`,
    url: '/',
  }] : [];
  return { seen: today, events };
}
