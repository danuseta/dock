import { promises as fs } from 'node:fs';
import { defaultBlackboardRoot, type Blackboard } from './blackboard';
import { lessonsLines } from './lessons';

export interface Scout { line: string; mode: 'light' | 'full'; files: number; repos: string; contractChange: boolean; at: string }

const CONTRACT_FILE = 'materials/contract.md';
const SCOUT_LINE = /^(?:Scout:\s*)?(.+?)\s+·\s+~?(\d+)\s+files?\s+·\s+(no contract change|contract change)\b[^→]*?\s*(?:→|->)\s*(light|full)\s*$/i;
const RUNNING_TTL_MS = 15 * 60 * 1000;

/** One `Scout: <repos> · ~<n> files · <contract change|no contract change> → light|full` line; null when it does not read so. */
export function parseScoutLine(line: string): Omit<Scout, 'at'> | null {
  const match = SCOUT_LINE.exec(line.trim());
  if (!match) return null;
  return { line: line.trim(), repos: match[1].trim(), files: Number(match[2]), contractChange: match[3].toLowerCase() === 'contract change', mode: match[4].toLowerCase() as 'light' | 'full' };
}

/** The last Scout line of the ticket's materials/contract.md; null when the file or a readable line is missing. */
export async function readScout(board: Blackboard, key: string): Promise<Scout | null> {
  const opened = await board.open(key, CONTRACT_FILE).catch(() => null);
  if (!opened) return null;
  const text = await fs.readFile(opened.file, 'utf8').catch(() => null);
  if (text === null) return null;
  const parsed = text.split(/\r?\n/).map(parseScoutLine).filter((item): item is Omit<Scout, 'at'> => !!item).pop();
  if (!parsed) return null;
  const stat = await fs.stat(opened.file);
  return { ...parsed, at: stat.mtime.toISOString() };
}

export function scoutPrompt(key: string, lessons: string | null = null): string {
  const board = `${defaultBlackboardRoot()}/${key}`;
  return [
    `SCOUT ${key}, read only. Dispatch the sous-explorer agent (sonnet) with a SCOUT task for ${key}: BOARD=${board}, the findings or brief on that board, and the ticket's AC.`,
    ...lessonsLines(lessons),
    'It measures the change and answers REPOS, FILES, LINES, CONTRACT and SCOUT as its agent file says.',
    `Then append one line to ${board}/materials/contract.md (create the file when it does not exist): Scout: <repos> · ~<n> files · <contract change|no contract change> → light|full.`,
    'Light only when REPOS is one repo, the change is small and CONTRACT is no contract change; otherwise full. Do not edit code, do not start the ticket, do not touch any other file.',
  ].join('\n');
}

/** One running scout per ticket: it counts as running until its line is newer than the start, or the TTL passes. */
export class ScoutRunner {
  private readonly started = new Map<string, number>();

  constructor(
    private readonly board: Blackboard,
    private readonly open: (key: string, prompt: string) => Promise<string>,
    private readonly now: () => number = Date.now,
    /** The ticket's lessons file for the scout prompt; left out, the prompt names none. */
    private readonly lessons: (key: string) => Promise<string | null> = async () => null,
  ) {}

  async running(key: string): Promise<boolean> {
    const since = this.started.get(key);
    if (since === undefined) return false;
    const scout = await readScout(this.board, key);
    if (this.now() - since > RUNNING_TTL_MS || (scout && Date.parse(scout.at) >= since)) {
      this.started.delete(key);
      return false;
    }
    return true;
  }

  async run(key: string): Promise<boolean> {
    if (await this.running(key)) return false;
    this.started.set(key, this.now());
    try {
      await this.open(key, scoutPrompt(key, await this.lessons(key).catch(() => null)));
    } catch (error) {
      this.started.delete(key);
      throw error;
    }
    return true;
  }
}
