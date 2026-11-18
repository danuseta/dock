import { cqlText, type ConfluenceClient } from './confluence';

export const SPLIT_PAGE_KEY = 'planningSplitPage';
const TICKET = /\b[A-Z][A-Z0-9_]*-\d+\b/;
const MAX_WEEK = 50;

export interface SplitRow { key: string; week: number; note: string | null }
export interface SplitTable { rows: SplitRow[]; skipped: number }
export interface SplitState {
  page: string; pageId: string | null; version: number | null; readAt: string; error: string | null;
  weeks: Record<string, { week: number; note: string | null }>;
  /** Tickets whose difference the planner chose to keep, with the split week they kept it against. */
  kept: Record<string, number>;
}
export interface SplitDiff { key: string; draftWeek: number; splitWeek: number; note: string | null }
export interface SplitView { page: string; version: number | null; readAt: string; error: string | null; rows: number; diffs: SplitDiff[]; kept: number }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const cellText = (html: string) => html
  .replace(/<(?:br|\/p|\/li|\/div)\b[^>]*>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? match;
  })
  .replace(/\s+/g, ' ')
  .trim();

const weekOf = (text: string): number | null => {
  const match = /^(?:week|w)?\s*(\d{1,2})$/i.exec(text.trim());
  const week = match ? Number(match[1]) : 0;
  return week >= 1 && week <= MAX_WEEK ? week : null;
};

/** The first table of a page in storage format whose header has Ticket and Week columns; null when there is none. */
export function parseSplitTable(storage: string): SplitTable | null {
  for (const table of storage.match(/<table\b[\s\S]*?<\/table>/gi) ?? []) {
    const lines = (table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []).map((row) => (row.match(/<t[hd]\b[\s\S]*?<\/t[hd]>/gi) ?? []).map(cellText));
    const header = lines.findIndex((cells) => cells.some((cell) => /^ticket$/i.test(cell)) && cells.some((cell) => /^week$/i.test(cell)));
    if (header < 0) continue;
    const names = lines[header].map((cell) => cell.toLowerCase());
    const [ticket, week, note] = [names.indexOf('ticket'), names.indexOf('week'), names.indexOf('note')];
    const rows: SplitRow[] = [];
    let skipped = 0;
    for (const cells of lines.slice(header + 1)) {
      const key = TICKET.exec(cells[ticket] ?? '')?.[0];
      const number = weekOf(cells[week] ?? '');
      if (!key || number === null) { skipped += 1; continue; }
      if (!rows.some((row) => row.key === key)) rows.push({ key, week: number, note: (note >= 0 && cells[note]) || null });
    }
    return { rows, skipped };
  }
  return null;
}

/** A Confluence page id, URL or title as the setting holds it. */
export function pageRef(input: string): { id: string } | { title: string } | null {
  const text = input.trim();
  if (!text) return null;
  if (/^\d{1,20}$/.test(text)) return { id: text };
  const fromUrl = /\/pages\/(\d{1,20})(?:[/?#]|$)/.exec(text) ?? /[?&]pageId=(\d{1,20})/.exec(text);
  if (fromUrl) return { id: fromUrl[1] };
  return /^https?:\/\//i.test(text) ? null : { title: text.slice(0, 200) };
}

const failed = (page: string, error: string, pageId: string | null = null, version: number | null = null): SplitState => ({
  page, pageId, version, readAt: new Date().toISOString(), error, weeks: {}, kept: {},
});

/** Reads the split page; a page that is missing or has no table comes back as a state with the reason, never as a throw. */
export async function readSplitPage(client: ConfluenceClient, input: string, parentId: string | null): Promise<SplitState> {
  const ref = pageRef(input);
  if (!ref) return failed(input.trim(), 'The split page is not a page id, a page URL or a title');
  try {
    let id = 'id' in ref ? ref.id : null;
    if ('title' in ref) {
      const parent = parentId ? await client.page(parentId) : null;
      const title = cqlText(ref.title);
      const found = parent
        ? (await client.search(`type = page AND ancestor = ${parent.id} AND title = ${title}`, 1))[0] ?? (parent.spaceKey ? await client.findPage(parent.spaceKey, ref.title) : null)
        : (await client.search(`type = page AND title = ${title}`, 1))[0];
      id = found?.id ?? null;
    }
    const read = id ? await client.pageBody(id) : null;
    if (!read) return failed(input.trim(), `Split page "${input.trim()}" was not found`);
    const table = parseSplitTable(read.storage);
    if (!table) return failed(read.page.title, 'The page has no table with Ticket and Week columns', read.page.id, read.page.version);
    return {
      page: read.page.title, pageId: read.page.id, version: read.page.version, readAt: new Date().toISOString(), error: null,
      weeks: Object.fromEntries(table.rows.map((row) => [row.key, { week: row.week, note: row.note }])), kept: {},
    };
  } catch (error: any) {
    return failed(input.trim(), `Confluence did not answer: ${error?.message ?? 'unknown error'}`);
  }
}

/** The line Settings shows next to the Test button. */
export const splitTestLine = (state: SplitState) => (state.error ? state.error : `found · v${state.version} · ${Object.keys(state.weeks).length} rows`);

/** What Planning shows: the open tickets whose week differs from the page, minus the differences the planner kept. */
export function splitView(state: SplitState, tickets: Array<{ key: string; wave: number }>): SplitView {
  const diffs = tickets
    .filter((ticket) => state.weeks[ticket.key] && state.weeks[ticket.key].week !== ticket.wave && state.kept[ticket.key] !== state.weeks[ticket.key].week)
    .map((ticket) => ({ key: ticket.key, draftWeek: ticket.wave, splitWeek: state.weeks[ticket.key].week, note: state.weeks[ticket.key].note }));
  return { page: state.page, version: state.version, readAt: state.readAt, error: state.error, rows: Object.keys(state.weeks).length, diffs, kept: Object.keys(state.kept).length };
}
