// The epic's storyboard, kept on Confluence as a page titled "Storyboard" with one HTML attachment per version (the
// claude.ai artifact saved as HTML), or uploaded in Planning until that page exists. DOCK saves every version under
// the blackboard, where sous already reads materials, and compares the newest with the one before it flow by flow,
// so a flow that changed mid sprint flags the tickets it lists.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cqlText, type ConfluenceAttachment, type ConfluenceClient, type ConfluencePage } from './confluence';
import { compareStoryboards, flowsOf, parseStoryboard, type StoryboardScenario } from './storyboard-flows';

export interface StoryboardFrame { id: string; text: string }
export interface StoryboardResult {
  epic: string; version: number; path: string; page: string | null;
  /** One entry per frame of the newest version, id "<flow>/<n>". */
  frames: StoryboardFrame[];
  /** Flow ids changed since the previous version. */
  changed: string[];
  previous: number | null;
  scenarios?: StoryboardScenario[];
  /** The tickets each changed flow lists. */
  tickets?: Record<string, string[]>;
}

export class StoryboardMissing extends Error {}
/** An upload DOCK will not save; the message says why. */
export class StoryboardRefused extends Error {}

export type StoryboardClient = Pick<ConfluenceClient, 'search' | 'children' | 'attachments' | 'download'>;

export const STORYBOARD_EPIC = /^[A-Z][A-Z0-9_]*-\d+$/;
export const STORYBOARD_FILE = /^v(\d{1,13})\.html$/;
export const MAX_STORYBOARD_BYTES = 8 * 1024 * 1024;
const FRAME = /\bF(\d{1,3})\.(\d{1,3})([a-z]?)(?![A-Za-z0-9])/g;
const MAX_FRAME_TEXT = 2000;
const MAX_DOWNLOADS = 20;

const frameId = (major: string, minor: string, letter: string) => `F${Number(major)}.${Number(minor)}${letter}`;
const byFrame = (a: string, b: string) => {
  const [a1, a2] = a.slice(1).split('.').map((part) => parseInt(part, 10));
  const [b1, b2] = b.slice(1).split('.').map((part) => parseInt(part, 10));
  return a1 - b1 || a2 - b2 || a.localeCompare(b);
};

/** The flow ids a text names, such as an AC line or a ticket description: F1.4, F1.1b. */
export function framesIn(lines: string[]): string[] {
  const ids = new Set<string>();
  for (const line of lines) for (const match of line.matchAll(FRAME)) ids.add(frameId(match[1], match[2], match[3]));
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

const epicKey = (epic: string) => {
  const key = epic.trim().toUpperCase();
  if (!STORYBOARD_EPIC.test(key)) throw new StoryboardMissing('epic must be a ticket key such as QRD-1233');
  return key;
};

export class StoryboardReader {
  constructor(
    private readonly client: () => Promise<StoryboardClient>,
    private readonly root: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  dir(epic: string): string {
    return path.join(this.root(), epic, 'materials', 'storyboard');
  }

  /** The saved file of one version, or null when the epic or the file name is not one DOCK writes. */
  file(epic: string, name: string): string | null {
    return STORYBOARD_EPIC.test(epic) && STORYBOARD_FILE.test(name) ? path.join(this.dir(epic), name) : null;
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
      return (await fs.readdir(this.dir(epic))).map((name) => Number(STORYBOARD_FILE.exec(name)?.[1])).filter((version) => version > 0).sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  /** Saves the Confluence versions not on disk yet and compares the newest saved version with the one before it. Uploaded versions stand in when Confluence has none. */
  async sync(epic: string): Promise<StoryboardResult> {
    const key = epicKey(epic);
    let page: string | null = null;
    let missing: string;
    try {
      const client = await this.client();
      const found = await this.findPage(client, key);
      missing = `No Confluence page titled "Storyboard" for ${key}. Add one under the epic's contract page and attach the storyboard as HTML (v1.html, v2.html, ...), or upload the storyboard HTML in Planning.`;
      if (found) {
        page = found.id;
        const versions = versionsOf(await client.attachments(found.id));
        missing = `The Storyboard page of ${key} has no HTML attachment. Attach the storyboard saved as HTML (v1.html, v2.html, ...), or upload it in Planning.`;
        const dir = this.dir(key);
        if (versions.length) await fs.mkdir(dir, { recursive: true });
        const onDisk = new Set(await this.saved(key));
        for (const { version, attachment } of versions.filter((item) => !onDisk.has(item.version)).slice(-MAX_DOWNLOADS)) {
          await fs.writeFile(path.join(dir, `v${version}.html`), await client.download(attachment.download), 'utf8');
        }
      }
    } catch (error) {
      if (!(await this.saved(key)).length) throw error;
      missing = '';
    }
    if (!(await this.saved(key)).length) throw new StoryboardMissing(missing);
    return this.compare(key, page);
  }

  /** Saves an uploaded storyboard as the newest version of the epic, named by the upload time in seconds. */
  async upload(epic: string, html: string): Promise<StoryboardResult> {
    const key = epicKey(epic);
    if (Buffer.byteLength(html, 'utf8') > MAX_STORYBOARD_BYTES) throw new StoryboardRefused(`The storyboard is larger than ${MAX_STORYBOARD_BYTES / 1024 / 1024} MB`);
    if (!html.includes('SCENARIOS')) throw new StoryboardRefused('This file is not a storyboard: it has no SCENARIOS list. Save the storyboard artifact as HTML and upload that file.');
    if (!parseStoryboard(html).length) throw new StoryboardRefused('The SCENARIOS list of this file could not be read. Upload the storyboard artifact saved as HTML.');
    const saved = await this.saved(key);
    const version = Math.max(Math.floor(this.now().getTime() / 1000), (saved[saved.length - 1] ?? 0) + 1);
    await fs.mkdir(this.dir(key), { recursive: true });
    await fs.writeFile(path.join(this.dir(key), `v${version}.html`), html, 'utf8');
    return this.compare(key, null);
  }

  private async compare(key: string, page: string | null): Promise<StoryboardResult> {
    const saved = await this.saved(key);
    const latest = saved[saved.length - 1];
    const previous = saved.length > 1 ? saved[saved.length - 2] : null;
    const read = async (version: number) => parseStoryboard(await fs.readFile(path.join(this.dir(key), `v${version}.html`), 'utf8'));
    const after = await read(latest);
    const { scenarios, changed, tickets } = compareStoryboards(previous === null ? null : await read(previous), after);
    const frames = flowsOf(after).flatMap((flow) => flow.frames.map((frame, index) => ({
      id: `${flow.id}/${index + 1}`,
      text: [frame.title, frame.step, ...frame.notes].filter(Boolean).join(' · ').slice(0, MAX_FRAME_TEXT),
    })));
    return { epic: key, version: latest, path: path.join(this.dir(key), `v${latest}.html`), page, frames, changed, previous, scenarios, tickets };
  }
}
