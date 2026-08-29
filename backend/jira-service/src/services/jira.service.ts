import axios from 'axios';
import { JiraClient } from '../clients/jira.client';

export class JiraService {
  private jiraClient: JiraClient;
  private get storageServiceUrl(): string {
    const base = process.env.STORAGE_SERVICE_URL || 'http://localhost:8004/api/cache/jira';
    if (base.includes('/cache/jira')) return base;
    return base.endsWith('/api') ? `${base}/cache/jira` : `${base}/api/cache/jira`;
  }

  private get storageHeaders(): Record<string, string> {
    const token = process.env.INTERNAL_SERVICE_TOKEN;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  constructor() {
    this.jiraClient = new JiraClient();
  }

  async getAssignedTickets(domain: string, email: string, apiToken: string, forceRefresh = false) {
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
    const cacheKey = `assigned_tickets_${cleanDomain}_${email.trim()}`;

    if (!forceRefresh) {
      try {
        const cacheResponse = await axios.get(`${this.storageServiceUrl}/${encodeURIComponent(cacheKey)}`, { headers: this.storageHeaders });
        if (cacheResponse.data && cacheResponse.data.data && Array.isArray(cacheResponse.data.data)) {
          return cacheResponse.data.data;
        }
      } catch (error) {
        console.warn('Cache miss or error fetching from cache');
      }
    }

    const res = await this.jiraClient.fetchAssignedTickets(domain, email, apiToken);
    const issues = res?.issues || [];
    const formattedTickets = issues.map((issue: any) => this.formatTicket(issue, cleanDomain)).filter(Boolean);

    try {
      await axios.post(this.storageServiceUrl, {
        key: cacheKey,
        data: formattedTickets,
        ttl: 3600, // 1 hour cache
      }, { headers: this.storageHeaders });
    } catch (error) {
      console.warn('Error saving to cache:', error);
    }

    return formattedTickets;
  }

  async getTicketDetails(domain: string, email: string, apiToken: string, ticketKey: string) {
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
    const issue = await this.jiraClient.getTicketDetails(domain, email, apiToken, ticketKey);
    return this.formatTicket(issue, cleanDomain);
  }

  async validateCredentials(domain: string, email: string, apiToken: string) {
    return this.jiraClient.validateCredentials(domain, email, apiToken);
  }

  public formatTicket(issue: any, cleanDomain: string) {
    if (!issue) return null;
    const key = issue.key || issue.id || 'UNKNOWN';

    let sprintName = 'No Sprint';
    let sprintState = 'NONE'; // 'ACTIVE' (Current/New), 'CLOSED' (Old), 'FUTURE', or 'NONE'

    if (issue.fields) {
      for (const fieldKey of Object.keys(issue.fields)) {
        const val = issue.fields[fieldKey];
        if (Array.isArray(val) && val.length > 0) {
          for (const item of val) {
            if (item && typeof item === 'object' && item.name && item.state && (item.startDate || item.endDate || fieldKey.includes('customfield'))) {
              sprintName = item.name;
              sprintState = String(item.state).toUpperCase();
              break;
            } else if (typeof item === 'string' && item.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
              const nameMatch = item.match(/name=([^,\]]+)/);
              const stateMatch = item.match(/state=([^,\]]+)/);
              if (nameMatch) sprintName = nameMatch[1];
              if (stateMatch) sprintState = stateMatch[1].toUpperCase();
              break;
            }
          }
        }
      }
    }

    let description = 'No detailed description provided in this Jira issue.';
    if (issue.fields?.description) {
      if (typeof issue.fields.description === 'string') {
        description = issue.fields.description;
      } else if (typeof issue.fields.description === 'object') {
        const extractText = (node: any): string => {
          if (!node) return '';
          if (node.type === 'text' && node.text) return node.text;
          if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
            const contentText = (node.content || []).map(extractText).join(' ');
            return contentText + '\n\n';
          }
          if (Array.isArray(node.content)) {
            return node.content.map(extractText).join(node.type === 'listItem' ? ' ' : '');
          }
          return '';
        };
        const extracted = extractText(issue.fields.description).trim();
        if (extracted) description = extracted;
      }
    }

    // Extract Story Points – Jira stores them in customfield_10016 (Next-gen) or customfield_10028 (classic)
    // Also handles story_points as a fallback key name
    let storyPoints: number | null = null;
    if (issue.fields) {
      const spValue = issue.fields.story_points
        ?? issue.fields.customfield_10016
        ?? issue.fields.customfield_10028
        ?? issue.fields.customfield_10034
        ?? Object.values(issue.fields as Record<string, any>).find(
            (v) => typeof v === 'number' && v > 0 && v <= 200 && Number.isInteger(v)
               && !['priority', 'issuetype'].includes(String(v))
          );
      if (typeof spValue === 'number' && !isNaN(spValue)) {
        storyPoints = spValue;
      }
    }

    return {
      key,
      title: issue.fields?.summary || 'Untitled Ticket',
      description,
      status: issue.fields?.status?.name || 'Unknown Status',
      assignee: issue.fields?.assignee?.displayName || issue.fields?.assignee?.emailAddress || 'Unassigned',
      url: `https://${cleanDomain}/browse/${key}`,
      sprintName,
      sprintState,
      storyPoints,
    };
  }
}
