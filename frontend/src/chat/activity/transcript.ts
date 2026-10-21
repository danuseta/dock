import { isOptimistic, type ChatMessage } from '../messages';
import { agentType, isDropped, type ChatActivity } from './activity';

/** Rows closer than this stay in one message; a longer pause starts the next one, as a chat does. */
export const GROUP_GAP_MS = 120_000;

export type LeadPart = { kind: 'text'; message: ChatMessage } | { kind: 'event'; event: ChatActivity };

export type TranscriptItem =
  | { kind: 'user'; key: string; message: ChatMessage }
  | { kind: 'lead'; key: string; at: string; parts: LeadPart[] }
  | { kind: 'call'; key: string; event: ChatActivity; rows: ChatActivity[] };

export type ThreadPart = { kind: 'event'; event: ChatActivity } | { kind: 'call'; event: ChatActivity };

export interface ThreadMessage { key: string; at: string; parts: ThreadPart[] }

export interface TreeStats { steps: number; failed: number; denied: number; workers: number; types: string[] }

export interface AgentDetail { prompt: string; report: string | null; tools: number | null; tokens: number | null; durationMs: number | null }

/** Tools, skills, agents and the kit's "steps not shown" line. Hooks and notes stay out, as in Claude Code. */
export const shownRow = (event: ChatActivity) => event.kind === 'tool' || event.kind === 'skill' || event.kind === 'agent' || isDropped(event);

const timeOf = (iso: string) => Date.parse(iso);

const byTime = <T>(time: (item: T) => number, id: (item: T) => number) => (a: T, b: T) => (time(a) - time(b)) || (id(a) - id(b));

/** Every row under `parentId` in `rows`, at any depth. */
export function descendantsOf(rows: readonly ChatActivity[], parentId: string): ChatActivity[] {
  const byParent = new Map<string, ChatActivity[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = byParent.get(row.parentId);
    if (list) list.push(row);
    else byParent.set(row.parentId, [row]);
  }
  const out: ChatActivity[] = [];
  const seen = new Set<string>([parentId]);
  const walk = (id: string) => {
    for (const child of byParent.get(id) ?? []) {
      if (seen.has(child.eventId)) continue;
      seen.add(child.eventId);
      out.push(child);
      walk(child.eventId);
    }
  };
  walk(parentId);
  return out;
}

export function treeStats(rows: readonly ChatActivity[]): TreeStats {
  const steps = rows.filter((row) => row.kind === 'tool' || row.kind === 'skill');
  const agents = rows.filter((row) => row.kind === 'agent');
  return {
    steps: steps.length,
    failed: steps.filter((row) => row.status === 'error').length,
    denied: steps.filter((row) => row.status === 'denied').length,
    workers: agents.length,
    types: [...new Set(agents.map((row) => agentType(row.name)))],
  };
}

/**
 * The lead's side of the conversation, turn by turn: your message, then the lead's messages built from its text and its own steps,
 * with every agent the lead called as a message of its own. What an agent did lives in its thread, not here.
 */
export function transcriptItems(messages: readonly ChatMessage[], byTurn: ReadonlyMap<number, ChatActivity[]>): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let index = 0;
  while (index < messages.length) {
    const head = messages[index];
    let end = index + 1;
    while (end < messages.length && messages[end].role !== 'user') end += 1;
    const turn = messages.slice(index, end);
    index = end;
    const rows = head.role === 'user' && !isOptimistic(head) ? byTurn.get(head.id) ?? [] : [];
    const rest = head.role === 'user' ? turn.slice(1) : turn;
    if (head.role === 'user') items.push({ kind: 'user', key: `user-${head.id}`, message: head });

    const held = new Set(rows.map((row) => row.eventId));
    type Entry = { time: number; id: number; part: LeadPart };
    const entries: Entry[] = rest
      .filter((message) => rows.length === 0 || message.role !== 'tool')
      .map((message) => ({ time: timeOf(message.at), id: message.id, part: { kind: 'text', message } }));
    for (const row of rows) {
      if (!shownRow(row) || (row.parentId && held.has(row.parentId))) continue;
      entries.push({ time: timeOf(row.startedAt), id: row.id, part: { kind: 'event', event: row } });
    }
    entries.sort(byTime((entry) => entry.time, (entry) => entry.id));

    let group: { item: Extract<TranscriptItem, { kind: 'lead' }>; last: number } | null = null;
    for (const entry of entries) {
      const { part } = entry;
      if (part.kind === 'event' && part.event.kind === 'agent') {
        group = null;
        items.push({ kind: 'call', key: `call-${head.id}-${part.event.eventId}`, event: part.event, rows: descendantsOf(rows, part.event.eventId) });
        continue;
      }
      if (!group || entry.time - group.last > GROUP_GAP_MS) {
        const key = part.kind === 'text' ? `lead-${head.id}-m${part.message.id}` : `lead-${head.id}-${part.event.eventId}`;
        group = { item: { kind: 'lead', key, at: part.kind === 'text' ? part.message.at : part.event.startedAt, parts: [] }, last: entry.time };
        items.push(group.item);
      }
      group.item.parts.push(part);
      group.last = entry.time;
    }
  }
  return items;
}

/** One agent's own work as messages: its steps and the agents it called, in order. Rows of the agents it called stay in their threads. */
export function threadMessages(rows: readonly ChatActivity[], agentId: string): ThreadMessage[] {
  const own = rows.filter((row) => row.parentId === agentId && shownRow(row)).sort(byTime((row) => timeOf(row.startedAt), (row) => row.id));
  const out: ThreadMessage[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const row of own) {
    const time = timeOf(row.startedAt);
    if (out.length === 0 || time - last > GROUP_GAP_MS) out.push({ key: `${agentId}-${row.eventId}`, at: row.startedAt, parts: [] });
    out[out.length - 1].parts.push(row.kind === 'agent' ? { kind: 'call', event: row } : { kind: 'event', event: row });
    last = time;
  }
  return out;
}

const numberAfter = (text: string, key: string) => {
  const match = text.match(new RegExp(`${key}:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
};

/** The kit stores an agent row's detail as its prompt, then `--- report ---`, the report and the usage block. */
export function agentDetail(text: string | null): AgentDetail {
  const source = text ?? '';
  const split = source.indexOf('--- report ---');
  const prompt = (split < 0 ? source : source.slice(0, split)).trim();
  const tail = split < 0 ? '' : source.slice(split + '--- report ---'.length);
  const report = tail.replace(/agentId:[\s\S]*$/, '').replace(/<usage>[\s\S]*$/, '').trim();
  return {
    prompt,
    report: report && !/delivered to you as a message/.test(report) ? report : null,
    tools: numberAfter(tail, 'tool_uses'),
    tokens: numberAfter(tail, 'subagent_tokens'),
    durationMs: numberAfter(tail, 'duration_ms'),
  };
}

const MCP = /^mcp__([^_]+)__/;

export function toolName(event: ChatActivity): string {
  if (event.kind === 'skill') return 'Skill';
  const mcp = event.name.match(MCP);
  return mcp ? `MCP ${mcp[1]}` : event.name || event.label;
}

const labelRest = (label: string) => label.replace(/^[^:]{1,32}:\s*/, '');

/** What goes between the brackets, like Claude Code: the command, the path, the pattern. */
export function toolArg(event: ChatActivity): string {
  if (event.kind === 'skill') return event.name;
  if (MCP.test(event.name)) return labelRest(event.label);
  const fine = event.status === 'ok' || event.status === 'running';
  if (event.name === 'Bash') return (fine && event.summary) || labelRest(event.label);
  return (fine && event.summary) || labelRest(event.label);
}

/** The line under a step: only what a reader needs without opening it, the reason a step failed or was blocked. */
export function toolOutcome(event: ChatActivity): string | null {
  if (event.status === 'denied') return event.summary || 'Blocked';
  if (event.status === 'error') return event.summary && event.summary !== toolArg(event) ? event.summary : 'Failed';
  if (event.status === 'stopped') return 'Stopped';
  return null;
}

const LOOK: Record<string, [string, string]> = {
  lead: ['L', '#e08a5c'],
  'sous-ticket-runner': ['R', '#8c9bf0'],
  'sous-ticket-worker': ['W', '#5cc0e0'],
  'sous-reviewer': ['Rv', '#e8c56c'],
  'sous-verifier': ['V', '#62cf9f'],
  'sous-publisher': ['P', '#a8a8a8'],
  'sous-arbiter': ['A', '#f08cb4'],
  'sous-planner': ['Pl', '#6f8fe8'],
  'browser-verifier': ['B', '#e0a84a'],
  'general-purpose': ['G', '#b48cf0'],
};

export interface StoredAgentLook { initials?: string | null; color?: string | null; avatarUrl?: string | null }

function defaultLook(type: string): { initials: string; color: string } {
  const known = LOOK[type];
  if (known) return { initials: known[0], color: known[1] };
  let hash = 0;
  for (const char of type) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return { initials: type.slice(0, 2).replace(/^./, (char) => char.toUpperCase()), color: `hsl(${hash} 45% 65%)` };
}

/** One initial and one colour per kind of agent, the same in every session. A look saved in DOCK wins; LOOK fills what it leaves out. */
export function agentLook(name: string, stored: Readonly<Record<string, StoredAgentLook>> = {}): { initials: string; color: string; avatarUrl?: string } {
  const type = agentType(name);
  const fallback = defaultLook(type);
  const saved = Object.prototype.hasOwnProperty.call(stored, type) ? stored[type] : undefined;
  if (!saved) return fallback;
  const look: { initials: string; color: string; avatarUrl?: string } = { initials: saved.initials || fallback.initials, color: saved.color || fallback.color };
  if (saved.avatarUrl) look.avatarUrl = saved.avatarUrl;
  return look;
}

/** "sous-ticket-runner" reads as "runner" where the space is short. */
export const shortAgent = (name: string) => (agentType(name) === 'sous-ticket-runner' ? 'runner' : agentType(name));

const FILE_TOOLS = /^(Read|Write|Edit|MultiEdit|NotebookEdit)$/;

/** Files an agent and its workers read or changed, from the paths their steps name. */
export function threadFiles(rows: readonly ChatActivity[]): Array<{ path: string; changed: boolean }> {
  const files = new Map<string, boolean>();
  for (const row of rows) {
    if (!FILE_TOOLS.test(row.name)) continue;
    const path = row.summary.split('\n')[0].replace(/\s*\(lines.*$/, '').trim();
    if (path) files.set(path, (files.get(path) ?? false) || row.name !== 'Read');
  }
  return [...files].map(([path, changed]) => ({ path, changed })).sort((a, b) => Number(b.changed) - Number(a.changed) || a.path.localeCompare(b.path));
}

/** The agent at the top of a worker's chain: the thread the lead started. */
export function threadRoot(workers: ReadonlyArray<{ id: string; parentId: string | null }>, id: string): string | null {
  const byId = new Map(workers.map((worker) => [worker.id, worker]));
  const seen = new Set<string>();
  let cursor = byId.get(id);
  while (cursor?.parentId && byId.has(cursor.parentId) && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    cursor = byId.get(cursor.parentId);
  }
  return cursor?.id ?? null;
}
