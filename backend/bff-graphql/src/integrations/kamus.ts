import type { Blackboard } from './blackboard';

// The pronunciation list `kamus-pengucapan.md` at the blackboard root. The demo-video skill (tts.py load_kamus) reads every
// markdown table row `| Tulisan | Dibaca |` as written -> spoken, header and separator skipped, backticks stripped.
// DOCK parses the same way, and writes the file back as an H1, an intro and one `## title` with a table per section.

export const KAMUS_FILE = 'kamus-pengucapan.md';
export const MAX_KAMUS_ROWS = 500;
export const MAX_CELL = 80;
export const MAX_INTRO = 4000;
const DEFAULT_TITLE = 'Kamus pengucapan';

export interface KamusRow { written: string; spoken: string }
export interface KamusSection { title: string; rows: KamusRow[] }
export interface Kamus { exists: boolean; intro: string; sections: KamusSection[] }
export interface KamusInput { intro: string; sections: KamusSection[] }

export class KamusInputError extends Error {}

const HEADER_WORDS = ['tulisan', 'written'];

/** One table line as tts.py reads it: null for a line that is no row, a header or a separator. */
function rowOf(line: string): KamusRow | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.replace(/^\|+|\|+$/g, '').split('|').map((cell) => cell.trim().replace(/^`+|`+$/g, '').trim());
  if (cells.length < 2 || !cells[0] || !cells[1]) return null;
  if (/^[-: ]+$/.test(cells[0]) || HEADER_WORDS.includes(cells[0].toLowerCase())) return null;
  return { written: cells[0], spoken: cells[1] };
}

const isRowLine = (line: string) => line.trim().startsWith('|');

/** The file as the editor shows it; a file without `##` sections is one untitled section with all its rows. */
export function parseKamus(text: string): Omit<Kamus, 'exists'> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const sections: KamusSection[] = [];
  const intro: string[] = [];
  let current: KamusSection | null = null;
  let seenH1 = false;
  for (const line of lines) {
    const heading = /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading && !line.startsWith('###')) {
      current = { title: heading[1], rows: [] };
      sections.push(current);
      continue;
    }
    if (!seenH1 && /^#\s+/.test(line)) {
      seenH1 = true;
      continue;
    }
    if (isRowLine(line)) {
      const row = rowOf(line);
      if (!row) continue;
      if (!current) {
        current = { title: '', rows: [] };
        sections.push(current);
      }
      current.rows.push(row);
      continue;
    }
    if (!current) intro.push(line);
  }
  return { intro: intro.join('\n').replace(/^\s*\n/, '').trim(), sections };
}

/** The first H1 of the file, kept when it is rewritten. */
export const kamusTitle = (text: string): string => /^#\s+(.+?)\s*$/m.exec(text.replace(/^﻿/, ''))?.[1] ?? DEFAULT_TITLE;

/** Refuses what the table cannot hold or tts.py would read differently; returns the cleaned input. */
export function validateKamus(input: KamusInput): KamusInput {
  const intro = String(input.intro ?? '').replace(/\r\n/g, '\n').trim();
  if (intro.length > MAX_INTRO) throw new KamusInputError(`The intro is at most ${MAX_INTRO} characters`);
  const bad = intro.split('\n').find((line) => /^\s*(\||#)/.test(line));
  if (bad) throw new KamusInputError('The intro cannot start a line with | or #: that would read as a table row or a heading');
  const seen = new Map<string, string>();
  let total = 0;
  const sections = (input.sections ?? []).map((section, index): KamusSection => {
    const title = String(section.title ?? '').trim();
    const name = title ? `Section "${title}"` : `Section ${index + 1}`;
    if (/[\r\n]/.test(title)) throw new KamusInputError(`${name}: the title is one line`);
    if (title.length > MAX_CELL) throw new KamusInputError(`${name}: the title is at most ${MAX_CELL} characters`);
    if (/^#/.test(title)) throw new KamusInputError(`${name}: the title cannot start with #`);
    if (!title && (input.sections.length > 1)) throw new KamusInputError(`${name}: give the section a title`);
    const rows = (section.rows ?? []).map((row, position): KamusRow => {
      const where = `${name}, row ${position + 1}`;
      const written = String(row.written ?? '').trim();
      const spoken = String(row.spoken ?? '').trim();
      for (const [label, value] of [['Written', written], ['Spoken', spoken]] as const) {
        if (!value) throw new KamusInputError(`${where}: ${label.toLowerCase()} is empty`);
        if (/[\r\n]/.test(value)) throw new KamusInputError(`${where}: ${label.toLowerCase()} must be one line`);
        if (value.includes('|')) throw new KamusInputError(`${where}: ${label.toLowerCase()} cannot hold the | character`);
        if (value.includes('`')) throw new KamusInputError(`${where}: ${label.toLowerCase()} cannot hold backticks`);
        if (value.length > MAX_CELL) throw new KamusInputError(`${where}: ${label.toLowerCase()} is at most ${MAX_CELL} characters`);
      }
      if (/^[-: ]+$/.test(written) || HEADER_WORDS.includes(written.toLowerCase())) throw new KamusInputError(`${where}: "${written}" reads as a table header and would be skipped`);
      const folded = written.toLowerCase();
      const first = seen.get(folded);
      if (first) throw new KamusInputError(`${where}: "${written}" is already in the list (${first})`);
      seen.set(folded, where);
      total += 1;
      return { written, spoken };
    });
    return { title, rows };
  });
  if (total > MAX_KAMUS_ROWS) throw new KamusInputError(`The list holds at most ${MAX_KAMUS_ROWS} rows; it has ${total}`);
  return { intro, sections };
}

const table = (rows: KamusRow[]) => ['| Tulisan | Dibaca |', '| --- | --- |', ...rows.map((row) => `| ${row.written} | ${row.spoken} |`)];

/** The file text: the H1, the intro, then one `## title` and table per section. */
export function serializeKamus(input: KamusInput, title = DEFAULT_TITLE): string {
  const blocks: string[][] = [[`# ${title}`]];
  if (input.intro) blocks.push([input.intro]);
  for (const section of input.sections) blocks.push([...(section.title ? [`## ${section.title}`, ''] : []), ...table(section.rows)]);
  return `${blocks.map((block) => block.join('\n')).join('\n\n')}\n`;
}

export async function readKamus(board: Pick<Blackboard, 'readRootText'>): Promise<Kamus> {
  const text = await board.readRootText(KAMUS_FILE);
  return text === null ? { exists: false, intro: '', sections: [] } : { exists: true, ...parseKamus(text) };
}

/** Validates and rewrites the file (temp file, then rename), keeping its H1; answers what the file now parses to. */
export async function saveKamus(board: Pick<Blackboard, 'readRootText' | 'writeRootText'>, input: KamusInput): Promise<Kamus> {
  const clean = validateKamus(input);
  const before = await board.readRootText(KAMUS_FILE);
  await board.writeRootText(KAMUS_FILE, serializeKamus(clean, before === null ? DEFAULT_TITLE : kamusTitle(before)));
  return readKamus(board);
}
