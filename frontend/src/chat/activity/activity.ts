export type ActivityStatus = 'running' | 'ok' | 'error' | 'denied' | 'stopped';

export interface ChatActivity {
  id: number;
  sessionId: string;
  turnId: number;
  eventId: string;
  parentId: string | null;
  kind: 'tool' | 'agent' | 'skill' | 'hook' | 'note' | string;
  agent: string;
  name: string;
  label: string;
  summary: string;
  status: ActivityStatus | string;
  hasDetail: boolean;
  seq: number;
  startedAt: string;
  endedAt: string | null;
}

export interface ActivityNode { event: ChatActivity; children: ActivityNode[] }

export const MAX_NEST_LEVEL = 3;
export const HIDDEN_OUTPUT = '[output hidden: sensitive command]';
export const HIDDEN_EVENT = '[hidden]';

export const isDropped = (event: ChatActivity) => event.kind === 'note' && event.name === 'dropped';

const startOf = (event: ChatActivity) => Date.parse(event.startedAt);

const compareEvents = (a: ChatActivity, b: ChatActivity) => (startOf(a) - startOf(b)) || (a.id - b.id);

const rowKey = (event: ChatActivity) => `${event.turnId}:${event.eventId}`;

const sameRow = (a: ChatActivity, b: ChatActivity) => a.seq === b.seq && a.status === b.status && a.endedAt === b.endedAt && a.label === b.label && a.summary === b.summary && a.hasDetail === b.hasDetail;

export function mergeActivity(existing: ChatActivity[], incoming: ChatActivity[]): ChatActivity[] {
  if (incoming.length === 0) return existing;
  const byKey = new Map<string, ChatActivity>();
  for (const event of existing) byKey.set(rowKey(event), event);
  let changed = false;
  for (const event of incoming) {
    const current = byKey.get(rowKey(event));
    if (current && (event.seq < current.seq || sameRow(current, event))) continue;
    byKey.set(rowKey(event), event);
    changed = true;
  }
  return changed ? [...byKey.values()] : existing;
}

export function maxSeq(events: ChatActivity[]): number {
  let highest = 0;
  for (const event of events) if (event.seq > highest) highest = event.seq;
  return highest;
}

export function groupByTurn(events: ChatActivity[]): Map<number, ChatActivity[]> {
  const byTurn = new Map<number, ChatActivity[]>();
  for (const event of events) {
    const list = byTurn.get(event.turnId);
    if (list) list.push(event);
    else byTurn.set(event.turnId, [event]);
  }
  return byTurn;
}

function parentLinks(events: ChatActivity[]): Map<string, string | null> {
  const known = new Set(events.map((event) => event.eventId));
  const links = new Map<string, string | null>();
  for (const event of events) links.set(event.eventId, event.parentId && event.parentId !== event.eventId && known.has(event.parentId) ? event.parentId : null);
  for (const event of events) {
    const seen = new Set<string>([event.eventId]);
    let cursor = links.get(event.eventId) ?? null;
    while (cursor) {
      if (seen.has(cursor)) {
        links.set(event.eventId, null);
        break;
      }
      seen.add(cursor);
      cursor = links.get(cursor) ?? null;
    }
  }
  return links;
}

export function buildTree(events: ChatActivity[]): ActivityNode[] {
  const sorted = [...events].sort(compareEvents);
  const links = parentLinks(sorted);
  const levels = new Map<string, number>();
  const levelOf = (eventId: string): number => {
    const known = levels.get(eventId);
    if (known !== undefined) return known;
    const parent = links.get(eventId) ?? null;
    const level = parent ? levelOf(parent) + 1 : 1;
    levels.set(eventId, level);
    return level;
  };
  const nodes = new Map<string, ActivityNode>(sorted.map((event) => [event.eventId, { event, children: [] }]));
  const roots: ActivityNode[] = [];
  for (const event of sorted) {
    const node = nodes.get(event.eventId);
    if (!node) continue;
    let parent = links.get(event.eventId) ?? null;
    while (parent && levelOf(parent) >= MAX_NEST_LEVEL) parent = links.get(parent) ?? null;
    const holder = parent ? nodes.get(parent) : undefined;
    if (holder) holder.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} m ${String(total % 60).padStart(2, '0')} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} m`;
}

export function durationOf(event: ChatActivity, now: number): number | null {
  const started = startOf(event);
  const ended = event.endedAt ? Date.parse(event.endedAt) : event.status === 'running' ? now : Number.NaN;
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null;
}

const STATUS_TEXT: Record<string, string> = { running: 'running', ok: 'done', error: 'failed', denied: 'blocked', stopped: 'stopped' };

export const statusText = (status: string) => STATUS_TEXT[status] ?? status;

export const stepsText = (count: number) => `${count} ${count === 1 ? 'step' : 'steps'}`;

export function capRows<T>(items: T[], shown: number): { visible: T[]; hidden: number } {
  const visible = items.length > shown ? items.slice(0, shown) : items;
  return { visible, hidden: items.length - visible.length };
}

export function splitDetail(detail: string): { body: string; notice: string | null } {
  const trimmed = detail.trim();
  if (trimmed === HIDDEN_EVENT) return { body: '', notice: 'This step is hidden because it may contain sensitive data.' };
  if (!detail.includes(HIDDEN_OUTPUT)) return { body: detail, notice: null };
  return { body: detail.replace(HIDDEN_OUTPUT, '').trim(), notice: 'Output hidden: this command may print sensitive data.' };
}

/** "oh-my-claudecode:executor" reads as "executor". */
export const agentType = (name: string) => name.split(':').pop() || name;

/** "Agent executor: add the tags filter" reads as "add the tags filter". */
export const agentTask = (event: Pick<ChatActivity, 'label' | 'name'>) => event.label.replace(/^Agent [^:]*:\s*/, '') || agentType(event.name);

export interface SessionStats { steps: number; skills: number; agents: number; runningAgents: number }

/** Counts for the session header: steps, distinct skills, subagents and how many of them still run. */
export function sessionStats(events: ChatActivity[]): SessionStats {
  const agents = events.filter((event) => event.kind === 'agent');
  return {
    steps: events.filter((event) => event.kind !== 'note').length,
    skills: new Set(events.filter((event) => event.kind === 'skill').map((event) => event.name)).size,
    agents: agents.length,
    runningAgents: agents.filter((event) => event.status === 'running').length,
  };
}

export interface AgentLane { agent: ChatActivity; steps: ChatActivity[] }

/** One lane per subagent still running: its own steps, oldest first, the newest `limit` of them. */
export function runningLanes(events: ChatActivity[], limit = 12): AgentLane[] {
  const lanes: AgentLane[] = [];
  const collect = (node: ActivityNode, into: ChatActivity[]) => {
    for (const child of node.children) {
      if (child.event.kind !== 'note') into.push(child.event);
      collect(child, into);
    }
  };
  const walk = (nodes: ActivityNode[]) => {
    for (const node of nodes) {
      if (node.event.kind === 'agent' && node.event.status === 'running') {
        const steps: ChatActivity[] = [];
        collect(node, steps);
        lanes.push({ agent: node.event, steps: steps.sort(compareEvents).slice(-limit) });
      }
      walk(node.children);
    }
  };
  walk(buildTree(events));
  return lanes;
}

export interface TrayWorker { agent: ChatActivity; steps: number; last: ChatActivity | null }

/** The subagents the tray above the composer keeps in view: every one still running, plus the ones the newest turn already finished. */
export function trayWorkers(events: ChatActivity[]): TrayWorker[] {
  const newestTurn = Math.max(...events.map((event) => event.turnId));
  const workers: TrayWorker[] = [];
  const collect = (node: ActivityNode, into: ChatActivity[]) => {
    for (const child of node.children) {
      if (child.event.kind !== 'note') into.push(child.event);
      collect(child, into);
    }
  };
  const walk = (nodes: ActivityNode[]) => {
    for (const node of nodes) {
      if (node.event.kind === 'agent' && (node.event.status === 'running' || node.event.turnId === newestTurn)) {
        const steps: ChatActivity[] = [];
        collect(node, steps);
        steps.sort(compareEvents);
        workers.push({ agent: node.event, steps: steps.length, last: steps[steps.length - 1] ?? null });
      }
      walk(node.children);
    }
  };
  walk(buildTree(events));
  return workers;
}
