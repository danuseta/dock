// What each agent of a run asked, decided and did, and what happened around it: the Thinking column of the Session
// flow and the Blackboard log. Pure: the caller reads the ledger, the events and the activity.
import type { LedgerDecision, LedgerFinding, LedgerIssue } from './orchestrator';
import { railIndex, type StageEvent, type ToolEvent } from './orchestrator-timeline';

export type ThinkingKind = 'ask' | 'decide' | 'did' | 'event';
export type ThinkingTopic = 'thinking' | 'owner' | 'agent' | 'git' | 'stage';
export interface ThinkingOption { label: string; why: string | null; chosen: boolean }
export interface ThinkingRow {
  id: string;
  at: string;
  stageIndex: number;
  round: number;
  /** The agent or worker the row belongs to: lead, sous-ticket-runner, sous-video, DOCK, owner, ... */
  agent: string;
  kind: ThinkingKind;
  topic: ThinkingTopic;
  text: string;
  answer: string | null;
  options: ThinkingOption[];
  /** Something went wrong here: a release while sous was working, a failed broadcast, a guard block, ... */
  flag: string | null;
}
export interface ThinkingVisit { stageIndex: number; round: number; from: string | null; to: string | null }
export interface GitActivity { at: Date; agent: string; text: string }
export interface ThinkingInput {
  decisions: LedgerDecision[];
  issues: LedgerIssue[];
  findings: LedgerFinding[];
  events: StageEvent[];
  tools: ToolEvent[];
  git: GitActivity[];
  visits: ThinkingVisit[];
}

const SHOWN_EVENTS: Record<string, { agent: string; text: (detail: string) => string; topic: ThinkingTopic }> = {
  STAGE: { agent: 'DOCK', text: (detail) => `Stage: ${detail}`, topic: 'stage' },
  WAITING: { agent: 'DOCK', text: (detail) => `Waiting on the owner: ${detail}`, topic: 'owner' },
  RESUMED: { agent: 'DOCK', text: () => 'Session opened', topic: 'stage' },
  OWNER_REPLY: { agent: 'owner', text: (detail) => `Answered ${detail}`, topic: 'owner' },
  OWNER_CONFIRMED: { agent: 'owner', text: (detail) => `Confirmed ${detail}`, topic: 'owner' },
  APPROVED: { agent: 'owner', text: () => 'LGTM', topic: 'owner' },
  PR_READY: { agent: 'DOCK', text: (detail) => `Marked ready: ${detail}`, topic: 'git' },
  PR_READY_FAILED: { agent: 'DOCK', text: (detail) => `Could not mark ready: ${detail}`, topic: 'git' },
  BROADCAST: { agent: 'DOCK', text: (detail) => `Broadcast: ${detail}`, topic: 'git' },
  BROADCAST_FAILED: { agent: 'DOCK', text: (detail) => `Broadcast failed: ${detail}`, topic: 'git' },
  JIRA: { agent: 'DOCK', text: (detail) => `Jira: ${detail}`, topic: 'stage' },
  STALLED: { agent: 'DOCK', text: (detail) => `Stalled: ${detail}`, topic: 'stage' },
  BLOCKED: { agent: 'sous-guard', text: (detail) => `Blocked: ${detail}`, topic: 'agent' },
  MACHINE: { agent: 'DOCK', text: (detail) => `Machine: ${detail}`, topic: 'stage' },
};
/** Activity flips feed the flags, not the log. */
const HIDDEN_EVENT = /^AGENT_/;
const RELEASES = new Set(['PR_READY', 'BROADCAST']);
const isFailure = (kind: string) => kind.includes('FAIL') || kind === 'STALLED' || kind === 'BLOCKED';

const shortType = (type: string | null) => (type || 'agent').replace(/^[^:]+:/, '');
const time = (value: string | Date) => (value instanceof Date ? value : new Date(value)).getTime();
const validTime = (value: string) => Number.isFinite(Date.parse(value));

/** The rail stop and round a moment belongs to: the visit it falls in, else the last visit that began before it. */
export function placeAt(at: string, visits: ThinkingVisit[]): { stageIndex: number; round: number } {
  const ms = time(at);
  const inside = visits.find((visit) => (visit.from === null || time(visit.from) <= ms) && (visit.to === null || ms < time(visit.to)));
  const before = [...visits].reverse().find((visit) => visit.from !== null && time(visit.from) <= ms);
  const visit = inside ?? before ?? visits[0];
  return visit ? { stageIndex: visit.stageIndex, round: visit.round } : { stageIndex: railIndex('plan'), round: 1 };
}

/** Whether sous was working at a moment, from the AGENT_ACTIVE / AGENT_IDLE / AGENT_WAITING flips. */
function workingAt(at: Date, flips: StageEvent[]): boolean {
  const last = flips.filter((event) => event.createdAt.getTime() <= at.getTime()).pop();
  return last?.kind === 'AGENT_ACTIVE';
}

export function buildThinking(input: ThinkingInput): ThinkingRow[] {
  const rows: Array<Omit<ThinkingRow, 'stageIndex' | 'round'>> = [];
  for (const decision of input.decisions) {
    if (!validTime(decision.at)) continue;
    const chosen: ThinkingOption = { label: decision.text, why: decision.effect, chosen: true };
    const dropped = [
      ...decision.rejected.map((entry) => ({ label: entry.option, why: entry.why || null, chosen: false })),
      ...decision.alts.map((alt) => ({ label: alt.label, why: alt.effect, chosen: false })),
    ];
    rows.push({
      id: `d${decision.n}`,
      at: new Date(decision.at).toISOString(),
      agent: decision.author || decision.by || 'sous',
      kind: decision.question ? 'ask' : 'decide',
      topic: 'thinking',
      text: decision.question || decision.text,
      answer: decision.question ? decision.text : null,
      options: [chosen, ...dropped],
      flag: null,
    });
  }
  for (const issue of input.issues) {
    if (!validTime(issue.at)) continue;
    rows.push({ id: `i${issue.n}`, at: new Date(issue.at).toISOString(), agent: issue.level === 'owner' ? 'sous' : issue.level || 'sous', kind: 'ask', topic: issue.level === 'owner' ? 'owner' : 'thinking', text: `I-${issue.n} ${issue.type}: ${issue.text}`, answer: issue.status === 'resolved' ? (issue.resolvedBy ? `answered by D-${issue.resolvedBy}` : 'resolved') : null, options: [], flag: null });
  }
  for (const finding of input.findings) {
    if (!validTime(finding.at)) continue;
    rows.push({ id: `f${finding.at}`, at: new Date(finding.at).toISOString(), agent: 'sous-reviewer', kind: 'did', topic: 'agent', text: `Finding (${finding.severity}): ${finding.text}`, answer: finding.resolvedAt ? 'resolved' : null, options: finding.resolvedWhy ? [{ label: 'Resolved', why: finding.resolvedWhy, chosen: true }] : [], flag: null });
  }
  const flips = input.events.filter((event) => event.kind.startsWith('AGENT_')).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const event of input.events) {
    if (HIDDEN_EVENT.test(event.kind)) continue;
    const shown = SHOWN_EVENTS[event.kind] ?? { agent: event.kind.startsWith('APPROVE') ? 'owner' : 'DOCK', text: (detail: string) => `${event.kind.toLowerCase().replace(/_/g, ' ')}: ${detail}`, topic: 'stage' as ThinkingTopic };
    const detail = event.detail || '';
    const flag = RELEASES.has(event.kind) && workingAt(event.createdAt, flips) ? 'while sous was still working' : isFailure(event.kind) ? 'failed' : null;
    rows.push({ id: `e${event.id}`, at: event.createdAt.toISOString(), agent: shown.agent, kind: 'event', topic: shown.topic, text: shown.text(detail).replace(/: $/, ''), answer: null, options: [], flag });
  }
  for (const tool of input.tools) {
    if (tool.kind === 'spawn') {
      rows.push({ id: `s${tool.at.getTime()}${tool.name}`, at: tool.at.toISOString(), agent: tool.agentId === 'main' ? 'lead' : shortType(tool.agentType), kind: 'did', topic: 'agent', text: `Started ${shortType(tool.name)}${tool.detail ? `: ${tool.detail}` : ''}`, answer: null, options: [], flag: null });
    } else if (tool.kind === 'stop' && tool.agentId !== 'main') {
      rows.push({ id: `x${tool.at.getTime()}${tool.agentId}`, at: tool.at.toISOString(), agent: shortType(tool.agentType), kind: 'did', topic: 'agent', text: 'Finished', answer: null, options: [], flag: null });
    }
  }
  for (const git of input.git) {
    rows.push({ id: `g${git.at.getTime()}`, at: git.at.toISOString(), agent: git.agent, kind: 'event', topic: 'git', text: git.text, answer: null, options: [], flag: null });
  }
  return rows
    .map((row) => ({ ...row, ...placeAt(row.at, input.visits) }))
    .sort((a, b) => time(b.at) - time(a.at));
}
