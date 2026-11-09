// Moving an AC line to a teammate's ticket, across two DOCKs that only share Jira. The sender labels the target
// ticket ac-move-pending and posts a QONFLO-AC-MOVE v1 comment holding the line as JSON; the receiver's DOCK lists it
// as "AC in" and answers with a QONFLO-AC-MOVE accepted or declined comment on both tickets. The sender's DOCK reads
// that answer and takes the line off its own ticket, or shows it Held again.
import { normalizeAcLine } from './ac-scope';
import type { PlanningIssue } from './jira-sprint';
import { SprintInputError } from './sprint-dashboard';
import { acValueLines, rewriteAcValue } from './sprint-draft';

export const MOVE_PENDING_LABEL = 'ac-move-pending';
export const MOVE_MARKER = 'QONFLO-AC-MOVE v1';
export const MOVE_ACCEPTED = 'QONFLO-AC-MOVE accepted';
export const MOVE_DECLINED = 'QONFLO-AC-MOVE declined';

/** The JSON of a move request: the line `line` of `from` offered to `to`. */
export interface MoveRequest { id: string; from: string; to: string; line: number; text: string; by: string | null }
export interface MoveAnswer { id: string; accepted: boolean; reason: string | null; by: string | null }
export interface AcIn extends MoveRequest { at: string }
export interface JiraComment { created: string; body: unknown }

export interface AcMoveJira {
  myself(): Promise<string | null>;
  issueNow(key: string): Promise<PlanningIssue | null>;
  setAc(key: string, value: unknown): Promise<void>;
  /** The owner's tickets that carry the ac-move-pending label. */
  pendingMoveKeys(): Promise<string[]>;
  comments(key: string): Promise<JiraComment[]>;
  markedComment(key: string, marker: string, json: string): Promise<void>;
  removeLabel(key: string, label: string): Promise<void>;
}

const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A stable id for one line offered from one ticket to another. */
export function moveId(from: string, to: string, text: string): string {
  let hash = 0;
  for (const char of `${from}|${to}|${normalizeAcLine(text)}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${from}-${to}-${hash.toString(36)}`;
}

function adfText(node: any): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return String(node.text ?? '');
  return Array.isArray(node.content) ? node.content.map(adfText).join('') : '';
}

/** The marker line and the JSON block of a comment, from Jira's ADF body or a plain text one; null when it is not one of ours. */
export function parseMarkedComment(body: unknown): { marker: string; data: Record<string, unknown> } | null {
  let marker = '';
  let json = '';
  if (typeof body === 'string') {
    const lines = body.split(/\r?\n/);
    marker = lines[0]?.trim() ?? '';
    json = lines.slice(1).join('\n').replace(/^\s*(\{code(:[^}]*)?\}|```\w*)/, '').replace(/(\{code\}|```)\s*$/, '');
  } else if (body && typeof body === 'object' && Array.isArray((body as any).content)) {
    const blocks = (body as any).content as any[];
    marker = adfText(blocks[0]).trim();
    json = adfText(blocks.find((block) => block?.type === 'codeBlock'));
  }
  if (![MOVE_MARKER, MOVE_ACCEPTED, MOVE_DECLINED].includes(marker)) return null;
  try {
    const data = JSON.parse(json);
    return data && typeof data === 'object' && !Array.isArray(data) ? { marker, data } : null;
  } catch {
    return null;
  }
}

function requestOf(data: Record<string, unknown>): MoveRequest | null {
  const { id, from, to, line, text, by } = data;
  if (typeof id !== 'string' || typeof from !== 'string' || typeof to !== 'string' || typeof text !== 'string' || !text.trim()) return null;
  return { id, from, to, line: Number(line) || 0, text, by: typeof by === 'string' ? by : null };
}

/** The requests a ticket's comments hold, and the answers given to them so far. */
export function readMoves(comments: JiraComment[]): { requests: AcIn[]; answers: Map<string, MoveAnswer> } {
  const requests: AcIn[] = [];
  const answers = new Map<string, MoveAnswer>();
  for (const comment of comments) {
    const parsed = parseMarkedComment(comment.body);
    if (!parsed) continue;
    if (parsed.marker === MOVE_MARKER) {
      const request = requestOf(parsed.data);
      if (request && !requests.some((item) => item.id === request.id)) requests.push({ ...request, at: comment.created });
    } else if (typeof parsed.data.id === 'string') {
      answers.set(parsed.data.id, {
        id: parsed.data.id, accepted: parsed.marker === MOVE_ACCEPTED,
        reason: typeof parsed.data.reason === 'string' ? parsed.data.reason : null, by: typeof parsed.data.by === 'string' ? parsed.data.by : null,
      });
    }
  }
  return { requests, answers };
}

/** The answer to request `id` among the target ticket's comments, if any. */
export async function moveAnswer(jira: Pick<AcMoveJira, 'comments'>, target: string, id: string): Promise<MoveAnswer | null> {
  return readMoves(await jira.comments(target)).answers.get(id) ?? null;
}

/** The receiving side: lines offered to the owner's tickets, and the owner's accept or decline. */
export class AcInService {
  constructor(private readonly jira: () => Promise<AcMoveJira>) {}

  async incoming(): Promise<AcIn[]> {
    const jira = await this.jira();
    const rows: AcIn[] = [];
    for (const key of await jira.pendingMoveKeys()) {
      const { requests, answers } = readMoves(await jira.comments(key));
      rows.push(...requests.filter((request) => request.to === key && !answers.has(request.id)));
    }
    return rows.sort((a, b) => a.to.localeCompare(b.to, undefined, { numeric: true }) || a.at.localeCompare(b.at));
  }

  async act(to: string, id: string, action: string, reason: string | null, by: string | null): Promise<AcIn[]> {
    if (action !== 'accept' && action !== 'decline') throw new SprintInputError('action must be accept or decline');
    const why = reason?.trim().slice(0, 1000) || null;
    if (action === 'decline' && !why) throw new SprintInputError('Say why the line is declined');
    const jira = await this.jira();
    const { requests, answers } = readMoves(await jira.comments(to));
    const request = requests.find((item) => item.id === id && item.to === to);
    if (!request) throw new SprintInputError('No such AC move on that ticket');
    if (answers.has(id)) throw new SprintInputError('That AC move was already answered');
    const [target, me] = await Promise.all([jira.issueNow(to), jira.myself()]);
    if (!target) throw new SprintInputError(`${to} is gone from Jira`);
    if (!sameName(target.assignee, me)) throw new SprintInputError(`${to} is not assigned to you in Jira`);
    if (action === 'accept' && !acValueLines(target.acRaw).some((line) => normalizeAcLine(line) === normalizeAcLine(request.text))) {
      await jira.setAc(to, rewriteAcValue(target.acRaw, [], [request.text]));
    }
    const answer = JSON.stringify({ id, from: request.from, to, line: request.line, text: request.text, by, ...(why ? { reason: why } : {}) }, null, 2);
    const marker = action === 'accept' ? MOVE_ACCEPTED : MOVE_DECLINED;
    await jira.markedComment(request.from, marker, answer);
    await jira.markedComment(to, marker, answer);
    const left = requests.filter((item) => item.id !== id && item.to === to && !answers.has(item.id));
    if (!left.length) await jira.removeLabel(to, MOVE_PENDING_LABEL);
    return this.incoming();
  }
}
