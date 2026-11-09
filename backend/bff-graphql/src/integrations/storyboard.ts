// The epic's storyboard, kept on Confluence as a page titled "Storyboard" with one HTML attachment per version (the
// claude.ai artifact saved as HTML). DOCK saves every version under the blackboard, where sous already reads
// materials, and compares the newest with the one before it frame by frame (F<n>.<m>), so a frame that changed mid
// sprint flags the tickets that name it.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cqlText, type ConfluenceAttachment, type ConfluenceClient, type ConfluencePage } from './confluence';

export interface StoryboardFrame { id: string; text: string }
export interface StoryboardResult { epic: string; version: number; path: string; page: string; frames: StoryboardFrame[]; changed: string[]; previous: number | null }

export class StoryboardMissing extends Error {}

export type StoryboardClient = Pick<ConfluenceClient, 'search' | 'children' | 'attachments' | 'download'>;

const EPIC = /^[A-Z][A-Z0-9_]*-\d+$/;
const FRAME = /\bF(\d{1,3})\.(\d{1,3})\b/g;
const MAX_FRAME_TEXT = 8000;
const MAX_DOWNLOADS = 20;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** The readable text of a saved artifact: markup and styles dropped, the script source (where an artifact keeps its screens) kept with its string escapes undone. */
export function storyboardText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\(["'`\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const frameId = (major: string, minor: string) => `F${Number(major)}.${Number(minor)}`;
const byFrame = (a: string, b: string) => {
  const [a1, a2] = a.slice(1).split('.').map(Number);
  const [b1, b2] = b.slice(1).split('.').map(Number);
  return a1 - b1 || a2 - b2;
};

/** Every frame id and the text that follows each mention of it up to the next frame id, in frame order. */
export function extractFrames(html: string): StoryboardFrame[] {
  const text = storyboardText(html);
  const marks = [...text.matchAll(FRAME)].map((match) => ({ id: frameId(match[1], match[2]), at: match.index ?? 0 }));
  const parts = new Map<string, string[]>();
  marks.forEach((mark, index) => {
    const piece = text.slice(mark.at, marks[index + 1]?.at ?? text.length).trim();
    parts.set(mark.id, [...(parts.get(mark.id) ?? []), piece]);
  });
  return [...parts.entries()].map(([id, pieces]) => ({ id, text: pieces.join(' ').slice(0, MAX_FRAME_TEXT) })).sort((a, b) => byFrame(a.id, b.id));
}

/** Frames added, removed or reworded between two versions. */
export function changedFrames(before: StoryboardFrame[], after: StoryboardFrame[]): string[] {
  const old = new Map(before.map((frame) => [frame.id, frame.text]));
  const now = new Map(after.map((frame) => [frame.id, frame.text]));
  return [...new Set([...old.keys(), ...now.keys()])].filter((id) => old.get(id) !== now.get(id)).sort(byFrame);
}

/** The frame ids a text names, such as an AC line or a ticket description. */
export function framesIn(lines: string[]): string[] {
  const ids = new Set<string>();
  for (const line of lines) for (const match of line.matchAll(FRAME)) ids.add(frameId(match[1], match[2]));
  return [...ids].sort(byFrame);
}

/** One HTML attachment per version: named v1.html, v2.html, or else the newest attachment version of the one file. */
export function versionsOf(attachments: ConfluenceAttachment[]): Array<{ version: number; attachment: ConfluenceAttachment }> {
  const html = attachments.filter((item) => /\.html?$/i.test(item.title) || /html/i.test(item.mediaType));
  const named = html.map((attachment) => ({ version: Number(/(?:^|[^a-z0-9])v(\d+)\.html?$/i.exec(attachment.title)?.[1]), attachment })).filter((item) => item.version > 0);
  if (named.length) return named.sort((a, b) => a.version - b.version);
  const newest = [...html].sort((a, b) => b.version - a.version)[0];
  return newest ? [{ version: newest.version, attachment: newest }] : [];
}

export class StoryboardReader {
  constructor(private readonly client: () => Promise<StoryboardClient>, private readonly root: () => string) {}

  dir(epic: string): string {
    return path.join(this.root(), epic, 'materials', 'storyboard');
  }

  /** The "Storyboard" page: a child of the epic's contract page, else the newest page the CQL search finds for the epic. */
  async findPage(client: StoryboardClient, epic: string): Promise<ConfluencePage | null> {
    const isStoryboard = (page: ConfluencePage) => /storyboard/i.test(page.title);
    for (const contract of (await client.search(`type = page AND title ~ "contract" AND text ~ ${cqlText(epic)} ORDER BY lastmodified DESC`, 5)).slice(0, 3)) {
      const child = (await client.children(contract.id)).find(isStoryboard);
      if (child) return child;
    }
    return (await client.search(`type = page AND title ~ "Storyboard" AND text ~ ${cqlText(epic)} ORDER BY lastmodified DESC`, 5)).find(isStoryboard) ?? null;
  }

  private async saved(epic: string): Promise<number[]> {
    try {
      return (await fs.readdir(this.dir(epic))).map((name) => Number(/^v(\d+)\.html$/.exec(name)?.[1])).filter((version) => version > 0).sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  /** Saves the versions not on disk yet and compares the newest with the version before it. */
  async sync(epic: string): Promise<StoryboardResult> {
    const key = epic.trim().toUpperCase();
    if (!EPIC.test(key)) throw new StoryboardMissing('epic must be a ticket key such as QRD-1233');
    const client = await this.client();
    const page = await this.findPage(client, key);
    if (!page) throw new StoryboardMissing(`No Confluence page titled "Storyboard" for ${key}. Add one under the epic's contract page and attach the storyboard as HTML (v1.html, v2.html, ...).`);
    const versions = versionsOf(await client.attachments(page.id));
    if (!versions.length) throw new StoryboardMissing(`The Storyboard page of ${key} has no HTML attachment. Attach the storyboard saved as HTML (v1.html, v2.html, ...).`);
    const dir = this.dir(key);
    await fs.mkdir(dir, { recursive: true });
    const onDisk = new Set(await this.saved(key));
    for (const { version, attachment } of versions.filter((item) => !onDisk.has(item.version)).slice(-MAX_DOWNLOADS)) {
      await fs.writeFile(path.join(dir, `v${version}.html`), await client.download(attachment.download), 'utf8');
    }
    const saved = await this.saved(key);
    const latest = saved[saved.length - 1];
    const previous = saved.length > 1 ? saved[saved.length - 2] : null;
    const file = path.join(dir, `v${latest}.html`);
    const frames = extractFrames(await fs.readFile(file, 'utf8'));
    const changed = previous === null ? [] : changedFrames(extractFrames(await fs.readFile(path.join(dir, `v${previous}.html`), 'utf8')), frames);
    return { epic: key, version: latest, path: file, page: page.id, frames, changed, previous };
  }
}
