import type { Blackboard, BlackboardFile } from './blackboard';

/**
 * Tiket → kode: every AC line of a ticket with the code that meets it, read from the ticket's blackboard
 * (the AC file, tasks.md, the review verdicts) and the ledger status.cjs keeps. Sous writes these files in
 * more than one shape over time; a shape this file cannot read gives no line, never an error.
 */

export type AcSide = 'be' | 'fe';
export type AcLineState = 'PASS' | 'FAIL' | 'TODO';
export interface AcRef { path: string; line: number | null; end: number | null; text: string; side: AcSide | null }
export interface AcTask { id: string; title: string | null; done: boolean }
export interface AcTraceLine {
  n: number;
  label: string;
  group: string | null;
  text: string | null;
  state: AcLineState | null;
  tasks: AcTask[];
  refs: AcRef[];
  tests: string[];
  /** The pull requests the line's code sits in, as labels such as "BE #1342". */
  prs: string[];
  note: string | null;
}
export interface AcTracePull { side: AcSide | null; url: string; label: string }
export interface AcTrace {
  key: string;
  readable: boolean;
  total: number;
  covered: number;
  lines: AcTraceLine[];
  pulls: AcTracePull[];
  /** The board files the trace was read from, and the shapes found in them. */
  sources: string[];
  formats: string[];
}
export interface AcTraceLedger {
  ac: Array<{ n: number; state: string; text: string; evidence: string | null }>;
  prBe: string | null;
  prFe: string | null;
}
export interface AcTraceFile { path: string; text: string; updatedAt: string }

const CODE_EXT = 'tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|cs|rb|php|vue|svelte|css|scss|html|json|ya?ml|sql|prisma|graphql|gql|sh|ps1|cjs|mts';
const FILE_NAME = new RegExp(`^(?:[\\w@.-][\\w@./-]*\\.(?:${CODE_EXT})|[A-Za-z_@][\\w@-]*(?:[./][A-Za-z_][\\w@-]*)+)$`, 'i');
const LINE_TOKEN = /(?<![\w@./:-])(?:\b(BE|FE)\s+)?`?([\w@][\w@./-]*)?`?:(\d+)(?:\s*[-–]\s*(\d+))?((?:,\d+(?:-\d+)?)*)(?![\w.:])/g;
const FILE_TOKEN = new RegExp(`(?<![\\w@./:-])(?:\\b(BE|FE)\\s+)?\`?([\\w@-][\\w@./-]*\\.(?:${CODE_EXT}))\`?(?![\\w:./-])`, 'gi');
const ALIAS = new RegExp(`(?:^|[\\s,;(])([A-Za-z][\\w-]{0,15})\\s*=\\s*(?:(FE|BE)\\s+)?([\\w@./-]+\\.(?:${CODE_EXT}))\\b`, 'g');
const REF_COLUMN = /path:line|^where$|satisfied at|^evidence$|^proof$|^fe$|^be$|^code$/i;
const TEST_COLUMN = /^tests?$/i;
const STATE_COLUMN = /^(result|state|status|ok\/missing|met|seen)$/i;
const NOTE_COLUMN = /^what$/i;
const LABEL = /^(?:AC\s*)?([A-Z]{1,3})\s?(\d{1,3}[a-z]?)\b[\s:.)-]*/;
const NUMBERS = /^(?:AC\s*)?(\d{1,3}(?:\s*[/,–-]\s*\d{1,3})*)[a-z]?(?=\s|$|[.:)])/i;
const TICKET = /[A-Z][A-Z0-9]+-\d+/;
const PULL_NUMBER = /\/pull\/(\d+)/;

const clean = (text: string) => text.replace(/`/g, '').replace(/\s+/g, ' ').trim();
const norm = (text: string) => clean(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Short names a verdict defines once ("svc = src/services/x.service.ts, D = FE src/x.tsx") and then uses as svc:120. */
export function parseAliases(text: string): Map<string, { path: string; side: AcSide | null }> {
  const found = new Map<string, { path: string; side: AcSide | null }>();
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('|')) continue;
    for (const match of line.matchAll(ALIAS)) {
      found.set(match[1], { path: match[3], side: match[2] ? (match[2].toLowerCase() as AcSide) : null });
    }
  }
  return found;
}

const sideOf = (text: string | undefined | null): AcSide | null => (text ? (/^BE$/i.test(text) ? 'be' : /^FE$/i.test(text) ? 'fe' : null) : null);

/** Every path:line in a cell, a bare `:line` taking the path before it; file names without a line come last. */
export function refsOf(cell: string, aliases: Map<string, { path: string; side: AcSide | null }> = new Map(), side: AcSide | null = null): AcRef[] {
  const out: AcRef[] = [];
  const seen = new Set<string>();
  const add = (ref: AcRef) => {
    const id = `${ref.path}:${ref.line ?? ''}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(ref);
  };
  const text = cell.replace(/`/g, '');
  const cellSide = sideOf(/^\s*(BE|FE)\b/.exec(text)?.[1]) ?? side;
  let last: { path: string; side: AcSide | null } | null = null;
  const covered: Array<[number, number]> = [];
  for (const match of text.matchAll(LINE_TOKEN)) {
    const [whole, prefix, name, from, to, extra] = match;
    let target: { path: string; side: AcSide | null } | null = null;
    if (!name) target = last;
    else if (aliases.has(name)) target = aliases.get(name) ?? null;
    else if (FILE_NAME.test(name)) target = { path: name, side: null };
    if (!target) continue;
    const refSide = sideOf(prefix) ?? target.side ?? cellSide;
    last = target;
    covered.push([match.index ?? 0, (match.index ?? 0) + whole.length]);
    const start = Number(from);
    add({ path: target.path, line: start, end: to ? Number(to) : null, text: clean(whole.replace(/^(BE|FE)\s+/, '')), side: refSide });
    for (const more of (extra || '').split(',').filter(Boolean)) {
      const [a, b] = more.split('-').map(Number);
      add({ path: target.path, line: a, end: b || null, text: `${target.path}:${more}`, side: refSide });
    }
  }
  for (const match of text.matchAll(FILE_TOKEN)) {
    const at = match.index ?? 0;
    if (covered.some(([a, b]) => at >= a && at < b)) continue;
    const name = match[2];
    if (out.some((ref) => ref.path === name)) continue;
    add({ path: name, line: null, end: null, text: name, side: sideOf(match[1]) ?? cellSide });
  }
  return out;
}

interface BaseLine { label: string; group: string | null; text: string | null; local: number }

/** The AC file sous writes: ac.txt one line per AC, or ac.md with numbered or bulleted lines under optional FE / BE headings. */
export function parseAcFile(text: string, name: string): BaseLine[] {
  const out: BaseLine[] = [];
  let group: string | null = null;
  const perGroup = new Map<string | null, number>();
  const plain = name.endsWith('.txt');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('<!--') || /^\|?\s*-{3,}/.test(line)) continue;
    const heading = /^#{1,4}\s+(.+)$/.exec(line);
    if (heading) {
      const title = clean(heading[1]);
      group = TICKET.test(title) || /acceptance criteria|^ac$/i.test(title) ? group : title.length <= 24 ? title : group;
      continue;
    }
    let body: string | null = null;
    const item = /^(?:[-*]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    const row = /^\|\s*(?:AC\s*)?\d{1,3}\s*\|\s*(.+?)\s*\|/.exec(line);
    if (item) body = item[1];
    else if (row) body = row[1];
    else if (plain && !line.startsWith('|')) body = line;
    if (!body) continue;
    body = clean(body);
    const labelled = LABEL.exec(body);
    const local = (perGroup.get(group) ?? 0) + 1;
    perGroup.set(group, local);
    if (labelled && !group) {
      out.push({ label: `${labelled[1]} ${labelled[2]}`, group: labelled[1], text: body.slice(labelled[0].length) || body, local: Number.parseInt(labelled[2], 10) });
    } else {
      out.push({ label: group ? `${group} ${local}` : String(out.length + 1), group, text: body, local });
    }
  }
  return out;
}

/** AC references in a task: "1,2,9 (service side),10-12", "FE 1–5", "6/7". */
export function acKeys(text: string): string[] {
  const keys: string[] = [];
  const stripped = text.replace(/\([^)]*\)/g, ' ');
  for (const part of stripped.split(/[,;]/)) {
    const match = /^\s*(?:AC\s*)?(?:([A-Z]{1,3})\s?)?(\d{1,3})(?:\s*[-–/]\s*(\d{1,3}))?\s*$/i.exec(part);
    if (!match) continue;
    const prefix = match[1] && !/^AC$/i.test(match[1]) ? match[1].toUpperCase() : '';
    const from = Number(match[2]);
    const to = match[3] ? Number(match[3]) : from;
    for (let n = from; n <= Math.min(to, from + 200); n += 1) keys.push(prefix ? `${prefix} ${n}` : String(n));
  }
  return keys;
}

/** tasks.md: "## T1 title" sections with a "Covers AC:" line, or a table with a Task column and an AC column. */
export function parseTasks(text: string): { tasks: Map<string, AcTask[]>; format: string | null } {
  const tasks = new Map<string, AcTask[]>();
  const add = (key: string, task: AcTask) => tasks.set(key, [...(tasks.get(key) ?? []).filter((item) => item.id !== task.id), task]);
  let format: string | null = null;
  let current: AcTask | null = null;
  let header: string[] | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const heading = /^#{2,4}\s+(T\d+)\b[\s:.-]*(.*)$/.exec(line);
    if (heading) { current = { id: heading[1], title: clean(heading[2]) || null, done: false }; header = null; continue; }
    const covers = /^[-*]?\s*Covers AC:\s*(.+)$/i.exec(line);
    if (covers && current) {
      format = format ?? 'tasks-sections';
      for (const key of acKeys(covers[1])) add(key, current);
      continue;
    }
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((cell) => clean(cell));
      if (/^-{3,}/.test(cells[0] ?? '')) continue;
      if (!header && /^task$/i.test(cells[0] ?? '')) { header = cells; continue; }
      if (header) {
        const acAt = header.findIndex((cell) => /^ac/i.test(cell));
        const titleAt = header.findIndex((cell) => /issue|title|what/i.test(cell));
        const id = /^T\d+/.exec(cells[0] ?? '')?.[0];
        if (id && acAt >= 0) {
          format = format ?? 'tasks-table';
          const task = { id, title: titleAt >= 0 ? cells[titleAt] || null : null, done: false };
          for (const key of acKeys(cells[acAt] ?? '')) add(key, task);
        }
      }
    } else header = null;
  }
  return { tasks, format };
}

/** Tasks the ledger marks handed off as done ("HANDOFF · T3 done: ..."). */
export function doneTasks(status: string): Set<string> {
  const done = new Set<string>();
  for (const match of status.matchAll(/HANDOFF\s*·\s*(T\d+)\s+done\b/g)) done.add(match[1]);
  return done;
}

export interface ReviewRow { ac: string; label?: string; refs: AcRef[]; tests: string[]; state: AcLineState | null; note: string | null }

const stateOf = (text: string | null | undefined): AcLineState | null => {
  if (!text) return null;
  if (/\b(missing|fail(ed)?|not met|partial|todo)\b/i.test(text)) return 'FAIL';
  if (/\b(pass(ed)?|ok|met|done|yes|seen)\b/i.test(text)) return 'PASS';
  return null;
};

/** Markdown tables whose first column is AC, in every column layout the verdicts have used. */
export function parseReviewTables(text: string): ReviewRow[] {
  const aliases = parseAliases(text);
  const rows: ReviewRow[] = [];
  let header: string[] | null = null;
  let numbered = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) { header = null; continue; }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    if (!header) {
      numbered = /^#$/.test(clean(cells[0] ?? '')) && /^AC\b/i.test(clean(cells[1] ?? ''));
      if (numbered || /^AC$/i.test(clean(cells[0] ?? ''))) header = cells.map((cell) => clean(cell).replace(/\s*\(.*\)$/, ''));
      continue;
    }
    const refs: AcRef[] = [];
    const tests: string[] = [];
    let state: AcLineState | null = null;
    let note: string | null = null;
    header.forEach((name, index) => {
      const cell = cells[index] ?? '';
      if (index === 0 || (numbered && index === 1) || !cell || cell === '-') return;
      if (REF_COLUMN.test(name)) refs.push(...refsOf(cell, aliases, sideOf(name)));
      else if (TEST_COLUMN.test(name)) tests.push(...cell.split(/,\s*(?![^()]*\))/).map(clean).filter((item) => item && item !== '-' && !/^none$/i.test(item)));
      else if (STATE_COLUMN.test(name)) state = stateOf(cell) ?? state;
      else if (NOTE_COLUMN.test(name)) note = clean(cell);
    });
    rows.push(numbered
      ? { ac: clean(`${cells[0] ?? ''} ${cells[1] ?? ''}`), label: clean(cells[0] ?? ''), refs, tests, state, note }
      : { ac: clean(cells[0] ?? ''), refs, tests, state, note });
  }
  return rows;
}

/** A numbered list under an "## AC ..." heading: "10. Drawer: download icon: utils/node-presentation.ts:42". */
export function parseAcList(text: string): ReviewRow[] {
  const aliases = parseAliases(text);
  const rows: ReviewRow[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^#{1,3}\s/.test(line)) { inside = /^#{2,3}\s+AC\b(?!\s+map)/i.test(line); continue; }
    if (!inside) continue;
    const match = /^\s*(\d{1,3})[.)]\s+(.+)$/.exec(line);
    if (match) rows.push({ ac: `${match[1]} ${clean(match[2])}`, label: match[1], refs: refsOf(match[2], aliases), tests: [], state: /MISSING|not built/i.test(match[2]) ? 'FAIL' : /\bPASS\.?$/.test(match[2]) ? 'PASS' : null, note: null });
  }
  return rows;
}

/** The "## AC map" section of a review: "1 MISSING (why) · 2 file.tsx:12 · 3 structural". */
export function parseAcMap(text: string): ReviewRow[] {
  const at = text.search(/^##\s+AC map\b/im);
  if (at < 0) return [];
  const aliases = parseAliases(text);
  const body = text.slice(at).split('\n').slice(1);
  const rows: ReviewRow[] = [];
  let group: string | null = null;
  for (const line of body) {
    if (/^#{1,3}\s/.test(line)) break;
    const side = /^\s*(FE|BE)\s*$/.exec(line);
    if (side) { group = side[1]; continue; }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      const local = rows.filter((row) => row.label?.startsWith(group ?? '#')).length + 1;
      const text = clean(bullet[1]);
      const head = text.split(/:\s/)[0];
      rows.push({ ac: head, label: group ? `${group} ${local}` : `#${local}`, refs: refsOf(text.slice(head.length), aliases, sideOf(group)), tests: [], state: stateOf(/\s-\s(.+)$/.exec(text)?.[1]), note: text });
      continue;
    }
    for (const part of line.split(/\s+·\s+/)) {
      const match = /^\s*(\d{1,3})\s+(.+)$/.exec(part);
      if (!match) continue;
      rows.push({ ac: match[1], refs: refsOf(match[2], aliases), tests: [], state: /MISSING/.test(match[2]) ? 'FAIL' : null, note: clean(match[2]) });
    }
  }
  return rows;
}

const pullOf = (url: string | null, side: AcSide): AcTracePull | null => {
  if (!url) return null;
  const number = PULL_NUMBER.exec(url)?.[1];
  return { side, url, label: `${side.toUpperCase()} ${number ? `#${number}` : url}` };
};

/** Which AC lines a review row speaks for: by number ("12", "6/7", "24-27"), by label ("FE 3"), or by its text. */
function rowTargets(row: ReviewRow, lines: Array<BaseLine & { n: number }>): number[] {
  const labelled = LABEL.exec(row.ac);
  if (labelled && lines.some((line) => line.group)) {
    const label = `${labelled[1]} ${Number.parseInt(labelled[2], 10)}`;
    const hit = lines.find((line) => line.label.toUpperCase() === label.toUpperCase());
    if (hit) return [hit.n];
  }
  const numbers = NUMBERS.exec(row.ac);
  if (numbers) {
    const keys = acKeys(numbers[1].replace(/\//g, ','));
    const hits = keys.map(Number).filter((n) => lines.some((line) => line.n === n));
    if (hits.length) return hits;
  }
  const text = norm(row.ac);
  if (text.length >= 8) {
    const hit = lines.find((line) => line.text && (norm(line.text) === text || norm(line.text).startsWith(text) || text.startsWith(norm(line.text))));
    if (hit) return [hit.n];
  }
  return [];
}

/** The "| AC | State | Text |" table status.cjs renders into NOW.md from the ledger. */
export function nowAc(text: string): AcTraceLedger['ac'] {
  const out: AcTraceLedger['ac'] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^\|\s*AC\s*\|\s*State\s*\|\s*Text\s*\|/i.test(line.trim())) { inside = true; continue; }
    if (!inside) continue;
    if (!line.trim().startsWith('|')) { if (out.length || line.trim()) break; continue; }
    const cells = line.trim().split('|').slice(1, -1).map((cell) => cell.trim());
    const n = Number.parseInt(cells[0] ?? '', 10);
    if (Number.isFinite(n)) out.push({ n, state: (cells[1] ?? '').toUpperCase(), text: cells.slice(2).join(' | '), evidence: null });
  }
  return out;
}

const REVIEW_ORDER: Array<[RegExp, number]> = [[/^review-FINAL[^/]*\.md$/i, 0], [/^review\/final\.md$/i, 1], [/^review-full\.md$/i, 2], [/^review\.md$/i, 3], [/^review-LOOP[^/]*\.md$/i, 4], [/^review\/[^/]+\.md$/i, 5]];
const reviewRank = (path: string) => REVIEW_ORDER.find(([pattern]) => pattern.test(path))?.[1] ?? -1;

export function buildAcTrace(key: string, files: AcTraceFile[], ledger: AcTraceLedger | null): AcTrace {
  const sources: string[] = [];
  const formats: string[] = [];
  const note = (path: string, format: string) => { if (!sources.includes(path)) sources.push(path); if (!formats.includes(format)) formats.push(format); };
  const byPath = new Map(files.map((file) => [file.path, file]));
  const pulls = [pullOf(ledger?.prBe ?? null, 'be'), pullOf(ledger?.prFe ?? null, 'fe')].filter((pull): pull is AcTracePull => Boolean(pull));

  // The AC lines: the AC file gives labels and groups, the ledger gives text and state.
  const acFile = ['ac.md', 'ac.txt', 'materials/ac.md'].map((path) => byPath.get(path)).find(Boolean) ?? null;
  let base: BaseLine[] = acFile ? parseAcFile(acFile.text, acFile.path) : [];
  if (acFile && base.length) note(acFile.path, acFile.path.endsWith('.txt') ? 'ac-txt' : 'ac-md');
  const now = byPath.get('NOW.md');
  const rendered = ledger?.ac?.length || !now ? [] : nowAc(now.text);
  if (rendered.length) note('NOW.md', 'now-table');
  const ledgerAc = (ledger?.ac?.length ? ledger.ac : rendered).filter((item) => item && Number.isFinite(item.n)).sort((a, b) => a.n - b.n);
  if (ledgerAc.length && base.length !== ledgerAc.length) {
    base = ledgerAc.map((item, index) => ({ label: String(index + 1), group: null, text: clean(item.text || '') || null, local: index + 1 }));
  }
  if (ledger?.ac?.length) formats.push('ledger');

  // The review verdict with an AC table or an AC map, the most final one first.
  const reviews = files.filter((file) => reviewRank(file.path) >= 0).sort((a, b) => reviewRank(a.path) - reviewRank(b.path) || b.updatedAt.localeCompare(a.updatedAt));
  let rows: ReviewRow[] = [];
  for (const review of reviews) {
    const table = parseReviewTables(review.text);
    const map = table.length ? [] : parseAcMap(review.text);
    const list = table.length || map.length ? [] : parseAcList(review.text);
    if (table.length || map.length || list.length) {
      rows = table.length ? table : map.length ? map : list;
      note(review.path, table.length ? 'review-table' : map.length ? 'ac-map' : 'ac-list');
      break;
    }
  }

  let lines = base.map((line, index) => ({ ...line, n: index + 1 }));
  // A verdict that speaks for other lines than the ledger's (a review run keeps its own short list) is the list.
  const fromRows = rows.length > 0 && (!lines.length || rows.filter((row) => rowTargets(row, lines).length).length < rows.length / 2);
  if (fromRows) {
    lines = rows.map((row, index) => {
      const labelled = row.label ? null : LABEL.exec(row.ac);
      if (row.label) {
        const text = row.ac.startsWith(row.label) ? row.ac.slice(row.label.length).trim() : row.ac;
        return { label: row.label.replace(/^#/, ''), group: /^([A-Z]{1,3}) \d/.exec(row.label)?.[1] ?? null, text: text || row.ac, local: index + 1, n: index + 1 };
      }
      return labelled
        ? { label: `${labelled[1]} ${Number.parseInt(labelled[2], 10)}`, group: labelled[1], text: row.ac.slice(labelled[0].length) || row.ac, local: Number.parseInt(labelled[2], 10), n: index + 1 }
        : { label: String(index + 1), group: null, text: row.ac || null, local: index + 1, n: index + 1 };
    });
  }

  const tasksFile = byPath.get('tasks.md');
  const parsedTasks = tasksFile ? parseTasks(tasksFile.text) : { tasks: new Map<string, AcTask[]>(), format: null };
  if (tasksFile && parsedTasks.format) note('tasks.md', parsedTasks.format);
  const status = byPath.get('status.md');
  const done = status ? doneTasks(status.text) : new Set<string>();

  const out: AcTraceLine[] = lines.map((line) => {
    const ledgerItem = fromRows ? undefined : ledgerAc[line.n - 1];
    const tasks = [...(parsedTasks.tasks.get(String(line.n)) ?? []), ...(line.group ? parsedTasks.tasks.get(`${line.group.toUpperCase()} ${line.local}`) ?? [] : [])]
      .filter((task, index, all) => all.findIndex((other) => other.id === task.id) === index)
      .map((task) => ({ ...task, done: done.has(task.id) }));
    const state = ledgerItem && /^(PASS|FAIL|TODO)$/.test(ledgerItem.state) ? ledgerItem.state as AcLineState : null;
    return {
      n: line.n, label: line.label, group: line.group, text: line.text ?? (ledgerItem?.text ? clean(ledgerItem.text) : null),
      state, tasks, refs: [], tests: [], prs: [], note: null,
    };
  });

  for (const [index, row] of rows.entries()) {
    const targets = fromRows ? [index + 1] : rowTargets(row, lines);
    for (const n of targets) {
      const line = out[n - 1];
      for (const ref of row.refs) if (!line.refs.some((have) => have.path === ref.path && have.line === ref.line)) line.refs.push(ref);
      for (const test of row.tests) if (!line.tests.includes(test)) line.tests.push(test);
      line.state = row.state ?? line.state;
      line.note = line.note ?? row.note;
    }
  }

  // The ledger's own evidence fills a line the verdict left without code.
  (fromRows ? [] : ledgerAc).forEach((item, index) => {
    const line = out[index];
    if (!line || line.refs.length || !item.evidence) return;
    const refs = refsOf(item.evidence);
    if (refs.length) { line.refs.push(...refs); if (!formats.includes('ledger-evidence')) formats.push('ledger-evidence'); }
    else line.note = line.note ?? clean(item.evidence);
  });

  for (const line of out) {
    const groupSide = sideOf(line.group);
    const sides = new Set(line.refs.map((ref) => ref.side ?? groupSide));
    const known = pulls.filter((pull) => sides.has(pull.side));
    line.prs = (known.length ? known : line.refs.length ? pulls : []).map((pull) => pull.label);
  }

  const covered = out.filter((line) => line.refs.some((ref) => ref.line !== null)).length;
  return { key, readable: out.length > 0, total: out.length, covered, lines: out, pulls, sources, formats };
}

const TRACE_FILES = /^(NOW\.md|ac\.(md|txt)|materials\/ac\.md|tasks\.md|status\.md|review[^/]*\.md|review\/[^/]+\.md)$/i;

/** The trace of one ticket; an empty, unreadable trace when the board has none of the files or they cannot be read. */
export async function loadAcTrace(board: Blackboard, key: string, ledger: AcTraceLedger | null): Promise<AcTrace | null> {
  const listed: BlackboardFile[] | null = await board.files(key).catch(() => null);
  if (!listed) return null;
  try {
    const files: AcTraceFile[] = [];
    for (const file of listed.filter((entry) => TRACE_FILES.test(entry.path))) {
      const text = await board.text(key, file.path);
      if (text !== null) files.push({ path: file.path, text: text.replace(/\r\n/g, '\n'), updatedAt: file.updatedAt });
    }
    return buildAcTrace(key, files, ledger);
  } catch {
    return { key, readable: false, total: 0, covered: 0, lines: [], pulls: [], sources: [], formats: [] };
  }
}
