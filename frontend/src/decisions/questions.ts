import type { AgentRun } from '../agents/runs';
import { isGuess, openIssues, reportDecisions } from '../lib/sousReport';

/** One answer the owner can pick; `effect` is what happens once it is submitted. */
export interface QuestionOption { key: string; label: string; effect: string }

/**
 * Something sous needs from the owner on a ticket: an issue it could not decide (its work waits on the answer),
 * or a decision it guessed and went on with (the owner keeps it or changes it).
 */
export interface Question {
  id: string;
  kind: 'issue' | 'decision';
  n: number;
  text: string;
  /** What the guessed decision does, as sous wrote it. */
  detail: string | null;
  at: string;
  blocking: boolean;
  options: QuestionOption[];
}

/** The owner's draft for one question: the picked option, or OWN with the text written. `sent` once it went to sous. */
export interface Draft { choice: string | null; text: string; unsure: boolean; sent?: boolean }

export const OWN = 'own';
export const KEEP = 'keep';

const ISSUE_EFFECT = 'Sous goes on with this answer in a new session.';
const ALT_EFFECT = 'Sous changes the work to this in a new session; the pull requests get the revision.';
export const KEEP_EFFECT = 'Nothing changes; it is recorded as confirmed.';
export const OWN_EFFECT: Record<Question['kind'], string> = {
  issue: 'Sous reads your answer in a new session and goes on.',
  decision: 'Sous reads what you wrote in a new session and changes the work; the pull requests get the revision.',
};

type QuestionFacts = Pick<AgentRun, 'kind' | 'issues' | 'decisions' | 'confirmedDecisions'>;

/**
 * The ticket's questions in the order sous raised them: open owner issues first, then the guessed decisions not confirmed yet.
 * A review gives feedback only, so its guesses are not asked.
 */
export function questionsOf(run: QuestionFacts): Question[] {
  const issues = openIssues(run).owner.map((issue): Question => ({
    id: `I-${issue.n}`,
    kind: 'issue',
    n: issue.n,
    text: issue.text,
    detail: null,
    at: issue.at,
    blocking: true,
    options: issue.options.map((label, index) => ({ key: `o${index}`, label, effect: issue.effects?.[index] || ISSUE_EFFECT })),
  }));
  if (run.kind !== 'build') return issues;
  const confirmed = new Set(run.confirmedDecisions ?? []);
  const guesses = reportDecisions(run).filter((decision) => isGuess(decision) && !confirmed.has(decision.n)).reverse().map((decision): Question => ({
    id: `D-${decision.n}`,
    kind: 'decision',
    n: decision.n,
    text: decision.text,
    detail: decision.effect ?? null,
    at: decision.at,
    blocking: false,
    options: [
      { key: KEEP, label: 'Keep what sous built', effect: KEEP_EFFECT },
      ...(decision.alts ?? []).map((alt, index) => ({ key: `a${index}`, label: alt.label, effect: alt.effect || ALT_EFFECT })),
    ],
  }));
  return [...issues, ...guesses];
}

/** True when the draft holds an answer that can be sent. */
export const isAnswered = (draft?: Draft) => Boolean(draft && (draft.choice === OWN ? draft.text.trim() : draft.choice));

/** What the draft sends, in words, or null when it is not answered yet. */
export function answerText(question: Question, draft?: Draft): string | null {
  if (!draft || !isAnswered(draft)) return null;
  if (draft.choice === OWN) return draft.text.trim();
  return question.options.find((option) => option.key === draft.choice)?.label ?? null;
}

export interface Submission {
  answers: Array<{ issue: number; text: string }>;
  changes: Array<{ n: number; choice: string }>;
  confirms: number[];
}

/** The answered questions as one submitDecisions call: answers to issues, kept decisions confirmed, the rest changed. */
export function submissionOf(questions: Question[], drafts: Record<string, Draft>): Submission {
  const submission: Submission = { answers: [], changes: [], confirms: [] };
  for (const question of questions) {
    const draft = drafts[question.id];
    const text = answerText(question, draft);
    if (!text || draft?.sent) continue;
    if (question.kind === 'issue') submission.answers.push({ issue: question.n, text });
    else if (draft?.choice === KEEP) submission.confirms.push(question.n);
    else submission.changes.push({ n: question.n, choice: text });
  }
  return submission;
}

/** How many questions wait on the owner across the runs, for the Decisions badge. */
export const questionCount = (runs: QuestionFacts[]) => runs.reduce((sum, run) => sum + questionsOf(run).length, 0);
