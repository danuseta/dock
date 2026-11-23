import { acLineRefs, normalizeAcLine } from './ac-scope';

// The one writing checker of DOCK: Planning, the agents (ingest ticket/lint) and the ticket detail use it. A block
// finding keeps a ticket out of Jira unless the owner lets it in with a flag; a warn finding is a note. Fields the
// input leaves out (undefined) are not checked, so a revision that changes only the AC is checked on the AC.

export type LintLevel = 'block' | 'warn';
export interface LintFinding { rule: string; field: string; line: number | null; level: LintLevel; text: string; fix: string }
export interface TicketLint { ok: boolean; findings: LintFinding[] }
export interface LintInput {
  type?: string | null;
  summary?: string | null;
  userStory?: string | null;
  problem?: string | null;
  ac?: string[] | null;
  reference?: string | null;
  openToConfirm?: string | null;
  sp?: number | null;
  blockedBy?: string[] | null;
  decidedRefs?: string[] | null;
  description?: string | null;
  /** The ticket's own key, so an AC line naming it is not a reference to another ticket. */
  key?: string | null;
}

/** The Jira label of a ticket let in with a flag, and of a sprint ticket that fails a block rule when the plan is published. */
export const WRITING_FLAG_LABEL = 'WRITING-FLAG';
export const FLAG_REASON_MIN = 5;
export const FLAG_REASON_MAX = 300;
export const SUMMARY_MAX = 100;
export const AC_WORDS_MAX = 40;
/** A line that joins this many "and"/"dan" reads as several behaviours. */
export const AC_AND_MAX = 4;
export const SP_SPLIT_AT = 5;

export const VAGUE_PHRASES = [
  'works correctly', 'work properly', 'as expected', 'user friendly', 'user-friendly', 'sesuai',
  'dengan baik', 'berjalan normal', 'optimal', 'seamless', 'intuitive',
];
const PLACEHOLDER = /(^|[^\p{L}\p{N}])(tbd|tba|n\/a|to be defined)([^\p{L}\p{N}]|$)|^[-–—.…\s]*$/iu;
const JARGON: Array<[RegExp, string]> = [
  [/\b[\w./-]+\.(?:tsx?|jsx?|cjs|mjs|py|md|json|css):\d+\b/, 'a path:line such as File.tsx:42'],
  [/\bGUESS\b/, 'GUESS'],
  [/\bD-\d+\b/, 'a D-<n> decision id'],
  [/\bT\d+\b/, 'a T<n> task id'],
  [/\bledger\b/i, 'ledger'],
  [/\bsous\b/i, 'sous'],
  [/\bI-\d+\b/, 'an I-<n> issue id'],
];
const IMPLEMENTATION = /^(?:implement|refactor|update)\b.*\b(?:component|resolver|function)\b/i;
/** How a [BE] ticket's AC line is checked: through a page, an endpoint, or proof the developer attaches. */
const CHECK_TAG = /^\[(?:UI|API|Dev evidence)\]/i;
const GROUP_HEADER = /^\**\s*(?:FE|BE)\s*\**\s*:?$/i;

/** FE or BE: a tag in the summary's leading [..] group ([BE][Inbox] ...), else a "Repo: FE" line in the description. */
export function ticketRepo(summary: string | null | undefined, description?: string | null): 'FE' | 'BE' | null {
  const group = String(summary ?? '').match(/^\s*((?:\[[^\]]*\]\s*)+)/);
  const tags = (group?.[1].match(/\[([^\]]*)\]/g) ?? []).map((tag) => tag.slice(1, -1).trim().toUpperCase());
  const tagged = (['FE', 'BE'] as const).filter((side) => tags.includes(side));
  if (tagged.length === 1) return tagged[0];
  const repo = String(description ?? '').match(/\bRepo:\s*\**\s*(FE|BE)\b/i);
  return repo ? (repo[1].toUpperCase() as 'FE' | 'BE') : null;
}

const finding = (rule: string, field: string, line: number | null, text: string, fix: string): LintFinding => ({
  rule, field, line, level: rule <= 'W4' ? 'block' : 'warn', text, fix,
});
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const vagueIn = (line: string) => VAGUE_PHRASES.filter((phrase) => new RegExp(`(^|[^\\p{L}])${escaped(phrase)}($|[^\\p{L}])`, 'iu').test(line));
const hasQuoted = (line: string) => /["“”][^"“”]+["“”]/.test(line);
const jargonIn = (text: string) => JARGON.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);

function bugFinding(input: LintInput, body: string, field: string): LintFinding | null {
  if (!/^bug$/i.test(String(input.type ?? ''))) return null;
  const missing = [!/\b(expected|seharusnya)\b/i.test(body) && 'Expected', !/\b(actual|aktual)\b/i.test(body) && 'Actual'].filter((item): item is string => !!item);
  return missing.length ? finding('W4', field, null, `A Bug needs an Expected and an Actual part; ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing.`, 'Write what should happen (Expected) and what happens now (Actual).') : null;
}

export function lintTicket(input: LintInput): TicketLint {
  const findings: LintFinding[] = [];
  const ac = input.ac === undefined || input.ac === null ? null : input.ac.map(normalizeAcLine);
  if (ac) {
    if (!ac.some((line) => line.trim())) {
      findings.push(finding('W1', 'ac', null, 'The ticket has no acceptance criteria.', 'Write each behaviour a tester can check as one AC line.'));
    }
    ac.forEach((line, index) => {
      const n = index + 1;
      if (PLACEHOLDER.test(line)) {
        findings.push(finding('W1', 'ac', n, `AC ${n} is a placeholder${line.trim() ? ` ("${line.length > 40 ? `${line.slice(0, 40)}...` : line}")` : ''}.`, 'Replace it with a behaviour a tester can check, or take the line out.'));
        return;
      }
      const vague = vagueIn(line);
      if (vague.length && !hasQuoted(line)) {
        findings.push(finding('W2', 'ac', n, `AC ${n} says "${vague[0]}" and shows nothing a tester can observe.`, 'Write what the tester sees or gets: the text, the value or the screen.'));
      }
      const blocked = new Set((input.blockedBy ?? []).map((key) => key.toUpperCase()));
      const decided = new Set((input.decidedRefs ?? []).map((key) => key.toUpperCase()));
      for (const ref of acLineRefs(line, input.key ?? '')) {
        if (blocked.has(ref) || decided.has(ref)) continue;
        findings.push(finding('W3', 'ac', n, `AC ${n} names ${ref}, which has no Blocks link and is not in Reference.`, `Add a Blocks link to ${ref} if this ticket waits on it, or move the line to Reference.`));
      }
    });
    const bug = bugFinding(input, [input.description ?? '', ...ac].join('\n'), 'ac');
    if (bug) findings.push(bug);
  } else if (input.description !== undefined) {
    const bug = bugFinding(input, input.description ?? '', 'description');
    if (bug) findings.push(bug);
  }

  if (input.summary !== undefined && input.summary !== null) {
    const summary = input.summary.trim();
    if (!/^\[[^\]]+\]/.test(summary)) findings.push(finding('W5', 'summary', null, 'The summary has no [FE] or [BE] prefix.', 'Start it with the area, for example [FE][Inbox].'));
    if (summary.length > SUMMARY_MAX) findings.push(finding('W5', 'summary', null, `The summary is ${summary.length} characters; the most is ${SUMMARY_MAX}.`, 'Say in one short sentence what changes.'));
    if (IMPLEMENTATION.test(summary.replace(/^(?:\[[^\]]*\]\s*)+/, ''))) findings.push(finding('W5', 'summary', null, 'The summary reads as an implementation plan.', 'Say what changes for the user, not which code changes.'));
  }

  const human: Array<[string, string | null | undefined]> = [
    ['summary', input.summary], ['userStory', input.userStory], ['problem', input.problem], ['reference', input.reference], ['openToConfirm', input.openToConfirm],
  ];
  for (const [field, value] of human) {
    const found = value ? jargonIn(value) : [];
    if (found.length) findings.push(finding('W6', field, null, `Agent jargon in the ${field}: ${found.join(', ')}.`, 'Write it the way you would tell a teammate; leave out ids and code paths.'));
  }
  ac?.forEach((line, index) => {
    const n = index + 1;
    const found = jargonIn(line);
    if (found.length) findings.push(finding('W6', 'ac', n, `Agent jargon in AC ${n}: ${found.join(', ')}.`, 'Write it the way you would tell a teammate; leave out ids and code paths.'));
    if (words(line) > AC_WORDS_MAX) findings.push(finding('W6', 'ac', n, `AC ${n} has ${words(line)} words; the most is ${AC_WORDS_MAX}.`, 'Cut it down to one behaviour per line.'));
    if ((line.match(/\b(?:and|dan)\b/gi) ?? []).length >= AC_AND_MAX) findings.push(finding('W6', 'ac', n, `AC ${n} joins ${AC_AND_MAX} or more behaviours with "and".`, 'Split it into one line per behaviour.'));
  });

  if (input.userStory !== undefined && !(input.userStory ?? '').trim()) findings.push(finding('W7', 'userStory', null, 'The User Story is empty.', 'Write "As a ..., I want ..., so ...".'));
  if (input.problem !== undefined && !(input.problem ?? '').trim()) findings.push(finding('W7', 'problem', null, 'The Problem Definition is empty.', 'Say what is wrong or missing today, in plain words.'));
  if (typeof input.sp === 'number' && input.sp >= SP_SPLIT_AT) findings.push(finding('W8', 'sp', null, `${input.sp} story points is more than one ticket should hold.`, 'Split the ticket; the team standard is under 5 SP.'));
  if (ac && ticketRepo(input.summary, input.description) === 'BE') {
    ac.forEach((line, index) => {
      const n = index + 1;
      if (!line.trim() || PLACEHOLDER.test(line) || GROUP_HEADER.test(line) || CHECK_TAG.test(line)) return;
      findings.push(finding('W9', 'ac', n, `AC ${n} has no check tag: [UI], [API] or [Dev evidence].`, 'Start the line with [UI] and the page, [API] and the endpoint, or [Dev evidence] for proof the developer attaches.'));
    });
  }

  return { ok: !findings.some((item) => item.level === 'block'), findings };
}

/** The reason a flagged ticket is let in with: 5 to 300 characters. */
export function flagReason(flag: unknown): string | null {
  const raw = flag && typeof flag === 'object' ? (flag as { reason?: unknown }).reason : null;
  const reason = typeof raw === 'string' ? raw.trim() : '';
  return reason.length >= FLAG_REASON_MIN && reason.length <= FLAG_REASON_MAX ? reason : null;
}

/** What a ticket read from Jira (the ticket detail shape) is checked on. */
export function lintJiraTicket(ticket: {
  key?: string; title?: string | null; issueType?: string | null; userStory?: string | null; problemDefinition?: string | null; acceptanceCriteria?: string | null;
  reference?: string | null; openToConfirm?: string | null; storyPoints?: number | null; description?: string | null; links?: Array<{ key: string; relation: string }> | null;
}, decidedRefs: string[] = []): TicketLint {
  return lintTicket({
    key: ticket.key,
    type: ticket.issueType ?? undefined,
    summary: ticket.title ?? '',
    userStory: ticket.userStory ?? '',
    problem: ticket.problemDefinition ?? '',
    ac: String(ticket.acceptanceCriteria ?? '').split(/\r?\n/).map(normalizeAcLine).filter(Boolean),
    reference: ticket.reference ?? '',
    openToConfirm: ticket.openToConfirm ?? '',
    sp: ticket.storyPoints ?? null,
    blockedBy: (ticket.links ?? []).filter((link) => link.relation === 'blockedBy').map((link) => link.key),
    decidedRefs,
    description: ticket.description && !/^No detailed description/.test(ticket.description) ? ticket.description : '',
  });
}
