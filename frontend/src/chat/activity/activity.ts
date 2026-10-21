import { isOptimistic, type ChatMessage } from '../messages';

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

export interface ThreadGroup { key: string; turnId: number; events: ChatActivity[]; last: boolean; stopped: boolean }

export type ThreadItem = ChatMessage | ThreadGroup;

export interface GroupSummary { steps: number; failed: number; denied: number; stopped: number; running: number; durationMs: number; userStopped?: boolean }

export interface LiveLine { id: number; label: string; path: string[]; startedAt: string }

export const ROWS_PER_PAGE = 50;
export const MAX_NEST_LEVEL = 3;
export const ANNOUNCE_MS = 5000;
export const HIDDEN_OUTPUT = '[output hidden: sensitive command]';
export const HIDDEN_EVENT = '[hidden]';

export const isThreadGroup = (item: ThreadItem): item is ThreadGroup => 'events' in item;

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

const droppedOf = (event: ChatActivity) => {
  const count = Number.parseInt(event.summary, 10) || Number.parseInt(event.label, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
};

export function groupSummary(events: ChatActivity[], now: number, userStopped = false): GroupSummary {
  let steps = 0;
  let failed = 0;
  let denied = 0;
  let stopped = 0;
  let running = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const event of events) {
    if (isDropped(event)) steps += droppedOf(event);
    else if (event.kind !== 'note') steps += 1;
    if (event.status === 'error' && !userStopped) failed += 1;
    if (event.status === 'denied') denied += 1;
    if (event.status === 'stopped' || (event.status === 'error' && userStopped)) stopped += 1;
    if (event.status === 'running') running += 1;
    const started = startOf(event);
    if (Number.isFinite(started) && started < first) first = started;
    const ended = event.endedAt ? Date.parse(event.endedAt) : event.status === 'running' ? now : started;
    if (Number.isFinite(ended) && ended > last) last = ended;
  }
  return { steps, failed, denied, stopped, running, durationMs: Number.isFinite(first) && last > first ? last - first : 0, userStopped };
}

export function liveLine(events: ChatActivity[]): LiveLine | null {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const pathOf = (event: ChatActivity): string[] => {
    const path: string[] = [];
    const seen = new Set<string>([event.eventId]);
    let cursor = event.parentId ? byId.get(event.parentId) : undefined;
    while (cursor && !seen.has(cursor.eventId)) {
      seen.add(cursor.eventId);
      path.unshift(cursor.label);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return path;
  };
  let best: { event: ChatActivity; path: string[] } | null = null;
  for (const event of events) {
    if (event.status !== 'running' || isDropped(event)) continue;
    const path = pathOf(event);
    if (!best || path.length > best.path.length || (path.length === best.path.length && compareEvents(event, best.event) > 0)) best = { event, path };
  }
  return best ? { id: best.event.id, label: best.event.label || best.event.name, path: best.path, startedAt: best.event.startedAt } : null;
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

export function countsText(summary: GroupSummary): string {
  return [
    stepsText(summary.steps),
    summary.failed > 0 ? `${summary.failed} failed` : null,
    summary.denied > 0 ? `${summary.denied} blocked` : null,
  ].filter((part): part is string => part !== null).join(' · ');
}

export function summaryText(summary: GroupSummary): string {
  return [
    countsText(summary),
    summary.userStopped ? 'Stopped' : summary.stopped > 0 ? `${summary.stopped} stopped` : null,
    summary.durationMs > 0 ? formatDuration(summary.durationMs) : null,
  ].filter((part): part is string => part !== null).join(' · ');
}

export function announcement(events: ChatActivity[], live: boolean, userStopped = false): string {
  if (live) {
    let latest: ChatActivity | undefined;
    for (const event of events) if ((event.status === 'error' || event.status === 'denied') && (!latest || event.seq > latest.seq)) latest = event;
    return latest ? `Step ${statusText(latest.status)}: ${latest.label}` : '';
  }
  const summary = groupSummary(events, 0, userStopped);
  return [userStopped ? 'Stopped' : 'Finished', stepsText(summary.steps), summary.failed > 0 ? `${summary.failed} failed` : null, summary.denied > 0 ? `${summary.denied} blocked` : null].filter((part): part is string => part !== null).join(', ').replace(', ', ': ');
}

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

export function threadItems(messages: ChatMessage[], byTurn: Map<number, ChatActivity[]>): ThreadItem[] {
  if (byTurn.size === 0) return messages;
  const items: ThreadItem[] = [];
  let index = 0;
  while (index < messages.length) {
    const head = messages[index];
    let end = index + 1;
    while (end < messages.length && messages[end].role !== 'user') end += 1;
    const turn = messages.slice(index, end);
    index = end;
    const rows = head.role === 'user' && !isOptimistic(head) ? byTurn.get(head.id) : undefined;
    if (!rows || rows.length === 0) {
      items.push(...turn);
      continue;
    }
    const anchors = turn.filter((message) => message.role !== 'tool');
    const byEvent = new Map(rows.map((event) => [event.eventId, event]));
    const rootOf = (event: ChatActivity) => {
      const seen = new Set<string>([event.eventId]);
      let root = event;
      for (let next = root.parentId ? byEvent.get(root.parentId) : undefined; next && !seen.has(next.eventId); next = root.parentId ? byEvent.get(root.parentId) : undefined) {
        seen.add(next.eventId);
        root = next;
      }
      return root;
    };
    const slots = new Map<number, ChatActivity[]>();
    for (const event of rows) {
      const started = startOf(rootOf(event));
      let slot = 0;
      anchors.forEach((anchor, position) => {
        if (Date.parse(anchor.at) <= started) slot = position;
      });
      const list = slots.get(slot);
      if (list) list.push(event);
      else slots.set(slot, [event]);
    }
    for (const [slot, events] of slots) if (groupSummary(events, 0).steps === 0) slots.delete(slot);
    const lastSlot = Math.max(...slots.keys());
    anchors.forEach((anchor, position) => {
      items.push(anchor);
      const events = slots.get(position);
      if (events) items.push({ key: `group-${head.id}-${anchor.id}`, turnId: head.id, events: events.sort(compareEvents), last: position === lastSlot, stopped: head.stopped === true });
    });
  }
  return items;
}

export function sameEvents(a: ChatActivity[], b: ChatActivity[]): boolean {
  return a === b || (a.length === b.length && a.every((event, position) => event === b[position]));
}

export function hasRunning(node: ActivityNode): boolean {
  return node.event.status === 'running' || node.children.some(hasRunning);
}

export function sameTree(a: ActivityNode, b: ActivityNode): boolean {
  return a.event === b.event && a.children.length === b.children.length && a.children.every((child, position) => sameTree(child, b.children[position]));
}

export interface AgentHighlight { node: ActivityNode; steps: number }

export interface TurnHighlights { skills: string[]; agents: AgentHighlight[] }

const stepsUnder = (node: ActivityNode): number => node.children.reduce((total, child) => total + (child.event.kind === 'note' ? 0 : 1) + stepsUnder(child), 0);

/** The skills a turn called and the subagents it spawned, so they show without opening the step list. */
export function turnHighlights(events: ChatActivity[]): TurnHighlights {
  const skills = [...new Set(events.filter((event) => event.kind === 'skill').map((event) => event.name || event.label).filter(Boolean))];
  const agents: AgentHighlight[] = [];
  const walk = (nodes: ActivityNode[]) => {
    for (const node of nodes) {
      if (node.event.kind === 'agent') agents.push({ node, steps: stepsUnder(node) });
      walk(node.children);
    }
  };
  if (events.some((event) => event.kind === 'agent')) walk(buildTree(events));
  return { skills, agents };
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
