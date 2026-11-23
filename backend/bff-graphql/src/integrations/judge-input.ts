// The condensed transcript Judge reads, written to a file on the machine the bridge runs on. The owner and assistant
// text goes in whole; tool calls go in as one line each and are the first thing dropped when the input is too long.
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CAUSE_LABELS, type JudgeCause } from './judge';

export const MAX_INPUT_CHARS = 60000;
const TOOL_RESULT_CHARS = 300;
const MAX_SECTION_LINES = 60;
export const INPUT_KEEP_MS = 7 * 24 * 3600 * 1000;
const WIB_OFFSET_MS = 7 * 3600 * 1000;

export const judgeInputDir = () => path.join(path.resolve(process.env.JIDIS_DATA_DIR || 'data'), 'judge-input');

const clock = (at: Date) => new Date(at.getTime() + WIB_OFFSET_MS).toISOString().slice(11, 16);
const stamp = (at: Date) => `${new Date(at.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')} WIB`;
const oneLine = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);

export interface InputMessage { id: number; role: string; text: string; at: Date }
export interface InputTool { name: string; label: string; summary: string; detail: string | null; status: string; agent: string; startedAt: Date }
export interface InputLedger { stage: string; rounds: number; failures: string[]; findings: string[]; ownerIssues: string[] }
export interface InputCheckpoint { at: string; step: string; agent: string | null; text: string }
export interface InputCoverage { covered: number; total: number; missing: string[] }
export interface InputDiscord { at: string; author: string; text: string; url: string }
export interface InputJira { at: string; from: string | null; to: string | null }
export interface InputExample { cause: string; text: string; note: string | null }

export interface SessionInput {
  session: { id: string; title: string; ticketKey: string | null; origin: string; startedAt: Date };
  /** The last message judged before; only later messages go in. */
  since: number | null;
  messages: InputMessage[];
  tools: InputTool[];
  ledger: InputLedger | null;
  checkpoints: InputCheckpoint[];
  execLog: string[];
  coverage: InputCoverage | null;
  discord: InputDiscord[];
  jira: InputJira[];
  examples: InputExample[];
}

const causeLabel = (cause: string) => CAUSE_LABELS[cause as JudgeCause] ?? cause;

export function examplesSection(examples: InputExample[]): string[] {
  if (!examples.length) return [];
  return ['## Examples (not a mistake)', ...examples.map((example) => `- ${causeLabel(example.cause)}: ${oneLine(example.text, 400)}${example.note ? ` · owner: ${oneLine(example.note, 300)}` : ''}`), ''];
}

const section = (title: string, lines: string[]) => (lines.length ? [`## ${title}`, ...lines.slice(0, MAX_SECTION_LINES), ''] : []);

const refused = (status: string) => status === 'denied' || status === 'error';

/** The condensed transcript and the last message id it holds; null when there is nothing after `since`. */
export function buildSessionInput(input: SessionInput, cap = MAX_INPUT_CHARS): { text: string; untilMessageId: number | null } {
  const messages = input.messages.filter((message) => input.since === null || message.id > input.since).sort((a, b) => a.id - b.id);
  const sinceAt = input.since === null ? null : input.messages.find((message) => message.id === input.since)?.at ?? null;
  const tools = input.tools.filter((tool) => !sinceAt || tool.startedAt > sinceAt);
  const untilMessageId = messages.length ? messages[messages.length - 1].id : null;
  type Entry = { at: number; order: number; tool: boolean; text: string };
  const entries: Entry[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'tool') {
      entries.push({ at: message.at.getTime(), order: index, tool: true, text: `· [#${message.id} ${clock(message.at)}] ${oneLine(message.text, TOOL_RESULT_CHARS)}` });
      return;
    }
    entries.push({ at: message.at.getTime(), order: index, tool: false, text: `[#${message.id} ${clock(message.at)} ${message.role === 'user' ? 'owner' : 'assistant'}]\n${message.text.trim()}\n` });
  });
  tools.forEach((tool, index) => {
    const name = [tool.name, tool.label].filter(Boolean).join(' · ');
    const result = refused(tool.status) ? ` → ${tool.status === 'denied' ? 'refused' : 'failed'}: ${oneLine(tool.summary || tool.detail || '', TOOL_RESULT_CHARS)}` : '';
    entries.push({ at: tool.startedAt.getTime(), order: messages.length + index, tool: true, text: `· ${clock(tool.startedAt)} ${tool.agent === 'main' ? '' : `${tool.agent} `}${oneLine(name, 200)}${result}` });
  });
  entries.sort((a, b) => a.at - b.at || a.order - b.order);

  const ledger = input.ledger;
  const head = [
    `# Judge input · session ${input.session.id}`,
    `Title: ${input.session.title || '(none)'}`,
    `Ticket: ${input.session.ticketKey ?? '(none)'}`,
    `Origin: ${input.session.origin}`,
    `Started: ${stamp(input.session.startedAt)}`,
    input.since === null ? 'Judged before: never, the whole session is below' : `Judged before: up to message #${input.since}; only the messages after it are below`,
    `Until: ${untilMessageId === null ? '-' : `#${untilMessageId}`}`,
    'Message lines are [#<message id> <WIB time> <who>]; post that id as messageId. Tool lines start with a dot.',
    '',
  ];
  const tail = [
    ...section('Ledger', ledger ? [
      `Stage ${ledger.stage} · fix rounds ${ledger.rounds} · failures ${ledger.failures.length} · findings ${ledger.findings.length} · owner issues ${ledger.ownerIssues.length}`,
      ...ledger.failures.map((line) => `- failure: ${oneLine(line, 300)}`),
      ...ledger.findings.map((line) => `- finding: ${oneLine(line, 300)}`),
      ...ledger.ownerIssues.map((line) => `- owner issue: ${oneLine(line, 300)}`),
    ] : []),
    ...section('Checkpoints', input.checkpoints.map((card) => `- ${card.at.slice(11, 16)} ${card.agent ?? 'lead'} · ${card.step}: ${oneLine(card.text, 400)}`)),
    ...section('Log eksekusi', input.execLog.map((line) => `- ${oneLine(line, 300)}`)),
    ...section('Tiket → kode', input.coverage ? [`Coverage ${input.coverage.covered}/${input.coverage.total}`, ...input.coverage.missing.map((line) => `- no path:line: ${oneLine(line, 200)}`)] : []),
    ...section('Discord PR thread (other people after their on it)', input.discord.map((message) => `- ${message.at.slice(0, 16).replace('T', ' ')} ${message.author}: ${oneLine(message.text, 600)} (${message.url})`)),
    ...section('Jira status changes since the session start', input.jira.map((change) => `- ${change.at.slice(0, 16).replace('T', ' ')} ${change.from ?? '?'} → ${change.to ?? '?'}`)),
    ...examplesSection(input.examples),
  ];
  const fixed = [...head, '## Transcript', ''].join('\n').length + tail.join('\n').length + 1;
  let total = fixed + entries.reduce((sum, entry) => sum + entry.text.length + 1, 0);
  const kept = [...entries];
  for (let index = 0; total > cap && index < kept.length;) {
    if (kept[index].tool) {
      total -= kept[index].text.length + 1;
      kept.splice(index, 1);
    } else {
      index += 1;
    }
  }
  const dropped = entries.length - kept.length;
  const body = [...head, '## Transcript', ...(dropped ? [`(${dropped} older tool lines left out to stay under ${cap} characters)`] : []), '', ...kept.map((entry) => entry.text), '', ...tail];
  return { text: body.join('\n'), untilMessageId };
}

export interface SprintFinding { day: string; sessionId: string; sessionTitle: string; grade: string | null; cause: string; text: string; quote: string; shouldHave: string; confirmed: boolean }
export interface SprintInput {
  sprint: string;
  days: string[];
  sessionsJudged: number;
  notJudged: number;
  findings: SprintFinding[];
  numbers: Record<string, number | null> | null;
  lastTry: string[];
  previousSprint: string | null;
  examples: InputExample[];
}

/** The sprint summary's input: every finding that stands, the ledger numbers, last sprint's accepted TRY lines and the examples. */
export function buildSprintInput(input: SprintInput): string {
  const findings = input.findings.map((finding) => [
    `- ${finding.day} · ${finding.sessionTitle} (${finding.sessionId.slice(0, 8)}, grade ${finding.grade ?? '?'}) · ${causeLabel(finding.cause)}${finding.confirmed ? '' : ' · Judge\'s call, not confirmed'}`,
    `  ${oneLine(finding.text, 600)}`,
    ...(finding.quote ? [`  quote: ${oneLine(finding.quote, 400)}`] : []),
    ...(finding.shouldHave ? [`  should have: ${oneLine(finding.shouldHave, 400)}`] : []),
  ].join('\n'));
  return [
    `# Judge input · sprint ${input.sprint}`,
    `Days: ${input.days[0] ?? '?'} to ${input.days[input.days.length - 1] ?? '?'}`,
    `Sessions judged: ${input.sessionsJudged}${input.notJudged ? ` · ${input.notJudged} sessions not judged yet` : ''}`,
    'Post each Problem or Try line to the retro with source "judge".',
    '',
    '## Findings',
    ...(findings.length ? findings : ['(none)']),
    '',
    ...section('Ledger retro numbers', input.numbers ? Object.entries(input.numbers).map(([field, value]) => `- ${field}: ${value ?? '-'}`) : []),
    ...section(`Accepted TRY lines of ${input.previousSprint ?? 'the last sprint'} (judge them first: worked or not)`, input.lastTry.map((line) => `- ${oneLine(line, 600)}`)),
    ...examplesSection(input.examples),
  ].join('\n');
}

/** Writes one input file and returns its absolute path. */
export async function writeJudgeInput(dir: string, name: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.resolve(dir, `${name.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
  await writeFile(file, text, 'utf8');
  return file;
}

/** Removes the input files older than `before`. */
export async function cleanJudgeInputs(dir: string, before: Date): Promise<number> {
  let names: string[];
  try { names = await readdir(dir); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => null);
    if (info && info.mtime < before) {
      await rm(file, { force: true });
      removed += 1;
    }
  }
  return removed;
}
