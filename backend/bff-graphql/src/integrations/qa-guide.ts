// The QA guide block DOCK keeps in a ticket's Developer Context field once the ticket goes to UAT: the URL or route of
// the change and the menu path to it. It sits between two marker lines and is replaced, never added twice; whatever
// else the field holds is left as it is. No Jira comment is written.

export const QA_GUIDE_START = 'QA guide (DOCK)';
export const QA_GUIDE_END = '/QA guide';
const ROUTE_PREFIX = 'URL/route:';
const MENU_PREFIX = 'Jalur menu:';
const NOTHING = '-';
const MAX_ROUTES = 3;

export interface QaGuideSettings { enabled: boolean; field: string }
export interface QaGuideDeps {
  settings(): Promise<QaGuideSettings>;
  /** The field's value as Jira holds it now: an ADF document, plain text, or null. */
  read(key: string, field: string): Promise<unknown>;
  write(key: string, field: string, value: unknown): Promise<void>;
  /** The paths the ticket's frontend pull requests change. */
  frontendFiles(key: string): Promise<string[]>;
  /** The menu path sous wrote to the ledger at the video step. */
  menu(key: string): Promise<string | null>;
  event?(key: string, kind: string, detail: string): Promise<unknown>;
}
export interface QaGuideResult { written: boolean; reason: 'off' | 'unchanged' | null; lines: string[] }

const isTest = (path: string) => /(^|\/)(__tests__|tests?|e2e)\//.test(path) || /\.(test|spec|stories)\.[jt]sx?$/.test(path);
const kebab = (segment: string) => segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** The routes a pull request's page files point to, best effort: pages/, routes/ and app/<path>/page files. */
export function routesFromFiles(paths: readonly string[]): string[] {
  const routes: string[] = [];
  for (const path of paths.map((item) => item.replace(/\\/g, '/'))) {
    if (isTest(path)) continue;
    let segments: string[] | null = null;
    const app = /(?:^|\/)app\/(.+)\/page\.[jt]sx?$/.exec(path);
    const page = /(?:^|\/)(?:pages|routes)\/(.+)\.[jt]sx?$/.exec(path);
    if (app) segments = app[1].split('/').filter((segment) => !/^\(.*\)$/.test(segment));
    else if (page) {
      segments = page[1].split('/');
      const last = segments.pop()!.replace(/[-.]?page$/i, '').replace(/^index$/i, '');
      if (last) segments.push(last);
    }
    if (!segments) continue;
    const route = `/${segments.map(kebab).filter(Boolean).join('/')}`;
    if (!routes.includes(route)) routes.push(route);
    if (routes.length >= MAX_ROUTES) break;
  }
  return routes;
}

/** The block's lines, markers included. */
export function guideLines(input: { routes: readonly string[]; menu: string | null }): string[] {
  return [
    QA_GUIDE_START,
    `${ROUTE_PREFIX} ${input.routes.length ? input.routes.join(', ') : NOTHING}`,
    `${MENU_PREFIX} ${input.menu?.trim() || NOTHING}`,
    QA_GUIDE_END,
  ];
}

const isRecord = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

function adfText(node: any): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return String(node.text ?? '');
  return Array.isArray(node.content) ? node.content.map(adfText).join('') : '';
}

const paragraph = (line: string) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] });
const ours = (line: string) => line.startsWith(ROUTE_PREFIX) || line.startsWith(MENU_PREFIX);

/** Where the block sits among the lines: from the start marker to the end marker, or to its last own line when the end is gone. */
function blockRange(lines: readonly string[]): { from: number; to: number } | null {
  const from = lines.findIndex((line) => line.trim() === QA_GUIDE_START);
  if (from < 0) return null;
  const end = lines.findIndex((line, index) => index > from && line.trim() === QA_GUIDE_END);
  if (end >= 0) return { from, to: end };
  let to = from;
  while (to + 1 < lines.length && ours(lines[to + 1].trim())) to += 1;
  return { from, to };
}

/** The block the field holds now, as lines; null when there is none. */
export function currentGuide(value: unknown): string[] | null {
  const lines = isRecord(value) && Array.isArray(value.content) ? value.content.map((block: unknown) => adfText(block)) : typeof value === 'string' ? value.split(/\r?\n/) : [];
  const range = blockRange(lines);
  return range ? lines.slice(range.from, range.to + 1).map((line: string) => line.trim()) : null;
}

/** The field with the block put in: in place of the old one, else after what is there. Nothing else changes. */
export function withGuide(value: unknown, lines: readonly string[]): unknown {
  if (typeof value === 'string' && value.trim()) {
    const rows = value.split(/\r?\n/);
    const range = blockRange(rows);
    if (!range) return [...rows, ...lines].join('\n');
    return [...rows.slice(0, range.from), ...lines, ...rows.slice(range.to + 1)].join('\n');
  }
  if (isRecord(value) && value.type === 'doc' && Array.isArray(value.content)) {
    const blocks = value.content as unknown[];
    const range = blockRange(blocks.map((block) => adfText(block)));
    const added = lines.map(paragraph);
    const content = range ? [...blocks.slice(0, range.from), ...added, ...blocks.slice(range.to + 1)] : [...blocks, ...added];
    return { ...value, content };
  }
  return { type: 'doc', version: 1, content: lines.map(paragraph) };
}

/**
 * Writes the ticket's QA guide block. The move to UAT writes it only when the Sous flow switch is on; the owner's
 * manual action writes it either way. A block already holding the same lines is not written again.
 */
export async function writeQaGuide(deps: QaGuideDeps, key: string, manual = false): Promise<QaGuideResult> {
  const settings = await deps.settings();
  if (!settings.enabled && !manual) return { written: false, reason: 'off', lines: [] };
  const [files, menu, value] = await Promise.all([deps.frontendFiles(key).catch(() => []), deps.menu(key).catch(() => null), deps.read(key, settings.field)]);
  const lines = guideLines({ routes: routesFromFiles(files), menu });
  const now = currentGuide(value);
  if (now && now.length === lines.length && now.every((line, index) => line === lines[index])) return { written: false, reason: 'unchanged', lines };
  await deps.write(key, settings.field, withGuide(value, lines));
  await deps.event?.(key, 'JIRA', `QA guide written to ${settings.field}`).catch(() => undefined);
  return { written: true, reason: null, lines };
}
