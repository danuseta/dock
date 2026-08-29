import axios, { AxiosInstance } from 'axios';
import { StorageService } from '../storage/service';

export interface JiraCredentials {
  domain: string;
  email: string;
  apiToken: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
}

function cleanProjectKeys(projectKeys: string[] = []): string[] {
  return [...new Set(projectKeys
    .map((key) => key.trim().toUpperCase())
    .filter((key) => /^[A-Z][A-Z0-9_]{0,19}$/.test(key)))];
}

export class JiraClient {
  private getClient(credentials: JiraCredentials): AxiosInstance {
    const auth = Buffer.from(`${credentials.email.trim()}:${credentials.apiToken.trim()}`).toString('base64');
    return axios.create({
      baseURL: `https://${cleanDomain(credentials.domain)}`,
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      timeout: 10000,
    });
  }

  async fetchAssignedTickets(credentials: JiraCredentials, projectKeys: string[] = []) {
    const projects = cleanProjectKeys(projectKeys);
    const projectClause = projects.length > 0 ? `project in (${projects.join(',')}) AND ` : '';
    const response = await this.getClient(credentials).post('/rest/api/3/search/jql', {
      jql: `${projectClause}assignee = currentUser() ORDER BY updated DESC`,
      fields: ['*all'],
      maxResults: 100,
    });
    return response.data;
  }

  async getTicketDetails(credentials: JiraCredentials, ticketKey: string) {
    const response = await this.getClient(credentials).get(`/rest/api/3/issue/${encodeURIComponent(ticketKey)}`);
    return response.data;
  }

  async listProjects(credentials: JiraCredentials): Promise<JiraProject[]> {
    const response = await this.getClient(credentials).get('/rest/api/3/project/search', {
      params: { orderBy: 'name', maxResults: 100 },
    });
    return (response.data?.values || []).map((project: any) => ({
      id: String(project.id), key: project.key, name: project.name,
    }));
  }

  async validateCredentials(credentials: JiraCredentials) {
    const response = await this.getClient(credentials).get('/rest/api/3/myself');
    return response.data;
  }
}

export class JiraService {
  constructor(
    private readonly storage = new StorageService(),
    private readonly client = new JiraClient(),
  ) {}

  async getAssignedTickets(credentials: JiraCredentials, projectKeys: string[] = [], forceRefresh = false) {
    const domain = cleanDomain(credentials.domain);
    const projects = cleanProjectKeys(projectKeys);
    const cacheKey = `assigned_tickets_${domain}_${credentials.email.trim()}_${projects.join('-') || 'all'}`;

    if (!forceRefresh) {
      const cached = await this.storage.getCache('jira', cacheKey).catch(() => null);
      if (Array.isArray(cached)) return cached;
    }

    const response = await this.client.fetchAssignedTickets(credentials, projects);
    const tickets = (response?.issues || [])
      .map((issue: any) => this.formatTicket(issue, domain))
      .filter(Boolean);
    await this.storage.upsertCache('jira', cacheKey, tickets, 3600).catch(() => undefined);
    return tickets;
  }

  async getTicketDetails(credentials: JiraCredentials, ticketKey: string) {
    const issue = await this.client.getTicketDetails(credentials, ticketKey);
    return this.formatTicket(issue, cleanDomain(credentials.domain));
  }

  listProjects(credentials: JiraCredentials) { return this.client.listProjects(credentials); }
  validateCredentials(credentials: JiraCredentials) { return this.client.validateCredentials(credentials); }

  formatTicket(issue: any, domain: string) {
    if (!issue) return null;
    const key = issue.key || issue.id || 'UNKNOWN';
    let sprintName = 'No Sprint';
    let sprintState = 'NONE';

    if (issue.fields) {
      for (const fieldKey of Object.keys(issue.fields)) {
        const value = issue.fields[fieldKey];
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (item && typeof item === 'object' && item.name && item.state
            && (item.startDate || item.endDate || fieldKey.includes('customfield'))) {
            sprintName = item.name;
            sprintState = String(item.state).toUpperCase();
            break;
          }
          if (typeof item === 'string' && item.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
            const nameMatch = item.match(/name=([^,\]]+)/);
            const stateMatch = item.match(/state=([^,\]]+)/);
            if (nameMatch) sprintName = nameMatch[1];
            if (stateMatch) sprintState = stateMatch[1].toUpperCase();
            break;
          }
        }
      }
    }

    let description = 'No detailed description provided in this Jira issue.';
    if (typeof issue.fields?.description === 'string') description = issue.fields.description;
    else if (issue.fields?.description && typeof issue.fields.description === 'object') {
      const extractText = (node: any): string => {
        if (!node) return '';
        if (node.type === 'text' && node.text) return node.text;
        const text = Array.isArray(node.content)
          ? node.content.map(extractText).join(node.type === 'listItem' ? ' ' : '')
          : '';
        return ['paragraph', 'heading', 'codeBlock'].includes(node.type) ? `${text}\n\n` : text;
      };
      const extracted = extractText(issue.fields.description).trim();
      if (extracted) description = extracted;
    }

    const fields = issue.fields || {};
    const storyPointValue = fields.story_points
      ?? fields.customfield_10016
      ?? fields.customfield_10028
      ?? fields.customfield_10034;

    return {
      key,
      title: fields.summary || 'Untitled Ticket',
      description,
      status: fields.status?.name || 'Unknown Status',
      assignee: fields.assignee?.displayName || fields.assignee?.emailAddress || 'Unassigned',
      url: `https://${domain}/browse/${key}`,
      projectKey: fields.project?.key || key.split('-')[0] || null,
      projectName: fields.project?.name || null,
      sprintName,
      sprintState,
      storyPoints: typeof storyPointValue === 'number' && !Number.isNaN(storyPointValue) ? storyPointValue : null,
    };
  }
}
