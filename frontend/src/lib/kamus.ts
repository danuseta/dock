// The pronunciation list (kamus-pengucapan.md) as the editor holds it: sections of written -> spoken rows. The rules here
// mirror the server's (integrations/kamus.ts) so a mistake shows before Save, and tts.py replace_words for "Try a line".

export interface KamusRow { written: string; spoken: string }
export interface KamusSection { title: string; rows: KamusRow[] }
export interface KamusDoc { intro: string; sections: KamusSection[] }

export const MAX_KAMUS_ROWS = 500;
export const MAX_CELL = 80;
const HEADER_WORDS = ['tulisan', 'written'];

/** Python str.isupper(): at least one cased character and no lower case one. */
export const isUpperKey = (key: string) => key !== key.toLowerCase() && key === key.toUpperCase();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The table tts.py builds from the file: written form -> spoken form. */
export function kamusTable(sections: KamusSection[]): Map<string, string> {
  const table = new Map<string, string>();
  for (const section of sections) {
    for (const row of section.rows) {
      const written = row.written.trim();
      const spoken = row.spoken.trim();
      if (written && spoken) table.set(written, spoken);
    }
  }
  return table;
}

/**
 * What the video would say for a line: tts.py replace_words. Longest key first, one key after the other over the text so far,
 * whole words only, case-insensitive unless the key is all upper case.
 */
export function spokenLine(text: string, table: Map<string, string>): string {
  let result = text;
  for (const key of [...table.keys()].sort((a, b) => b.length - a.length)) {
    const spoken = table.get(key)!;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(key)}(?![\\p{L}\\p{N}_])`, isUpperKey(key) ? 'gu' : 'giu');
    result = result.replace(pattern, () => spoken);
  }
  return result;
}

/** What is wrong with one cell, or null. */
export function cellIssue(label: 'Written' | 'Spoken', value: string): string | null {
  const text = value.trim();
  if (!text) return `${label.toLowerCase()} is empty`;
  if (/[\r\n]/.test(value)) return `${label.toLowerCase()} must be one line`;
  if (text.includes('|')) return `${label.toLowerCase()} cannot hold the | character`;
  if (text.includes('`')) return `${label.toLowerCase()} cannot hold backticks`;
  if (text.length > MAX_CELL) return `${label.toLowerCase()} is at most ${MAX_CELL} characters`;
  return null;
}

export interface RowIssue { section: number; row: number; field: 'written' | 'spoken' | 'title' | 'list'; message: string }

/** Every problem Save would be refused for, so the rows can be marked before the call. */
export function kamusIssues(sections: KamusSection[]): RowIssue[] {
  const issues: RowIssue[] = [];
  const seen = new Map<string, string>();
  let total = 0;
  sections.forEach((section, index) => {
    const title = section.title.trim();
    if (!title && sections.length > 1) issues.push({ section: index, row: -1, field: 'title', message: 'give the section a title' });
    if (title.length > MAX_CELL) issues.push({ section: index, row: -1, field: 'title', message: `the title is at most ${MAX_CELL} characters` });
    section.rows.forEach((row, position) => {
      total += 1;
      const written = cellIssue('Written', row.written);
      const spoken = cellIssue('Spoken', row.spoken);
      if (written) issues.push({ section: index, row: position, field: 'written', message: written });
      if (spoken) issues.push({ section: index, row: position, field: 'spoken', message: spoken });
      if (written) return;
      const folded = row.written.trim().toLowerCase();
      if (/^[-: ]+$/.test(folded) || HEADER_WORDS.includes(folded)) issues.push({ section: index, row: position, field: 'written', message: `"${row.written.trim()}" reads as a table header and would be skipped` });
      const first = seen.get(folded);
      if (first) issues.push({ section: index, row: position, field: 'written', message: `"${row.written.trim()}" is already in the list (${first})` });
      else seen.set(folded, `${title || `section ${index + 1}`}, row ${position + 1}`);
    });
  });
  if (total > MAX_KAMUS_ROWS) issues.push({ section: -1, row: -1, field: 'list', message: `the list holds at most ${MAX_KAMUS_ROWS} rows; it has ${total}` });
  return issues;
}

export const issueAt = (issues: RowIssue[], section: number, row: number, field: RowIssue['field']) => issues.find((item) => item.section === section && item.row === row && item.field === field)?.message ?? null;

/** True when the edit differs from what was loaded. */
export const kamusChanged = (before: KamusDoc, after: KamusDoc) => JSON.stringify(before) !== JSON.stringify(after);

export const emptyRow = (): KamusRow => ({ written: '', spoken: '' });

/** The input the save mutation takes: cells trimmed. */
export const kamusInput = (doc: KamusDoc) => ({
  intro: doc.intro.trim(),
  sections: doc.sections.map((section) => ({ title: section.title.trim(), rows: section.rows.map((row) => ({ written: row.written.trim(), spoken: row.spoken.trim() })) })),
});

/** The sections the editor starts from: a list without any section gets one empty untitled section to type into. */
export const editorDoc = (doc: KamusDoc): KamusDoc => ({ intro: doc.intro, sections: doc.sections.length ? doc.sections.map((section) => ({ title: section.title, rows: section.rows.map((row) => ({ ...row })) })) : [{ title: '', rows: [] }] });
