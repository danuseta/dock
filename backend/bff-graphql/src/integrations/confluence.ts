// Confluence Cloud through the same site and API token as Jira (`https://<site>/wiki/rest/api`). Planning writes the
// sprint contract page with it and the storyboard reader fetches the storyboard's HTML attachments.
import { createJiraHttp, type JiraHttp } from './jira-sprint';
import type { JiraCredentials } from './jira';

export interface ConfluencePage { id: string; title: string; version: number; spaceKey: string | null }
export interface ConfluenceAttachment { id: string; title: string; version: number; mediaType: string; download: string }

const API = '/wiki/rest/api';

const pageOf = (raw: any): ConfluencePage => ({
  id: String(raw?.id ?? ''),
  title: String(raw?.title ?? ''),
  version: Number(raw?.version?.number) || 1,
  spaceKey: raw?.space?.key ?? null,
});

/** An HTML-safe text for the storage format. */
export const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A CQL string literal. */
export const cqlText = (value: string) => `"${value.replace(/["\\]/g, ' ').trim()}"`;

export class ConfluenceClient {
  constructor(private readonly http: JiraHttp) {}

  async page(id: string): Promise<ConfluencePage | null> {
    try {
      return pageOf(await this.http.get(`${API}/content/${encodeURIComponent(id)}`, { expand: 'space,version' }));
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }

  async findPage(spaceKey: string, title: string): Promise<ConfluencePage | null> {
    const found = await this.http.get(`${API}/content`, { spaceKey, title, type: 'page', expand: 'space,version', limit: 1 });
    const first = (found?.results || [])[0];
    return first ? pageOf(first) : null;
  }

  async search(cql: string, limit = 10): Promise<ConfluencePage[]> {
    const found = await this.http.get(`${API}/content/search`, { cql, limit, expand: 'space,version' });
    return (found?.results || []).map(pageOf);
  }

  async children(id: string): Promise<ConfluencePage[]> {
    const found = await this.http.get(`${API}/content/${encodeURIComponent(id)}/child/page`, { limit: 100, expand: 'space,version' });
    return (found?.results || []).map(pageOf);
  }

  async createPage(spaceKey: string, parentId: string, title: string, storage: string): Promise<ConfluencePage> {
    return pageOf(await this.http.post(`${API}/content`, {
      type: 'page', title, space: { key: spaceKey }, ancestors: [{ id: parentId }], body: { storage: { value: storage, representation: 'storage' } },
    }));
  }

  async updatePage(page: ConfluencePage, storage: string): Promise<ConfluencePage> {
    if (!this.http.put) throw new Error('This Confluence connection cannot write');
    return pageOf(await this.http.put(`${API}/content/${encodeURIComponent(page.id)}`, {
      type: 'page', title: page.title, version: { number: page.version + 1 }, body: { storage: { value: storage, representation: 'storage' } },
    }));
  }

  async attachments(pageId: string): Promise<ConfluenceAttachment[]> {
    const found = await this.http.get(`${API}/content/${encodeURIComponent(pageId)}/child/attachment`, { limit: 200, expand: 'version' });
    return (found?.results || []).map((raw: any) => ({
      id: String(raw?.id ?? ''),
      title: String(raw?.title ?? ''),
      version: Number(raw?.version?.number) || 1,
      mediaType: String(raw?.metadata?.mediaType ?? raw?.extensions?.mediaType ?? ''),
      download: String(raw?._links?.download ?? ''),
    }));
  }

  /** The attachment's body as text; `download` is the link the attachment list returned. */
  async download(download: string): Promise<string> {
    const path = download.startsWith('/wiki/') ? download : `/wiki${download.startsWith('/') ? '' : '/'}${download}`;
    const body = await this.http.get(path);
    return typeof body === 'string' ? body : JSON.stringify(body);
  }
}

export function confluenceFrom(credentials: JiraCredentials): ConfluenceClient {
  return new ConfluenceClient(createJiraHttp(credentials));
}
