import axios, { AxiosError } from 'axios';

interface PullRequestSummary {
  repo: string;
  title: string;
  url: string;
  status: string;
  type?: string;
}

export interface DiscordSummary {
  ticket: { key: string; title: string; url: string };
  relatedTickets?: Array<{ key: string; title: string; url: string }>;
  prs: PullRequestSummary[];
  demoUrl?: string;
}

export const DEFAULT_DISCORD_MESSAGE_TEMPLATE = `🚀 **Update: {{ticketKey}} - {{ticketTitle}}**

**Jira Ticket:** [{{ticketKey}}]({{ticketUrl}})

{{relatedTickets}}
{{pullRequests}}
{{demoUrl}}`;

const ALLOWED_TEMPLATE_FIELDS = new Set(['ticketKey', 'ticketTitle', 'ticketUrl', 'relatedTickets', 'pullRequests', 'demoUrl']);
const MAX_DISCORD_MESSAGE_LENGTH = 2_000;
const MAX_DISCORD_THREAD_NAME_LENGTH = 100;
const DISCORD_FORUM_THREAD_REQUIRED_CODE = 220001;

export function buildDiscordForumTitle(ticket: DiscordSummary['ticket']): string {
  const title = [...`[${ticket.key}] ${ticket.title}`]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return title.slice(0, MAX_DISCORD_THREAD_NAME_LENGTH);
}

export function describeDiscordError(error: unknown): Record<string, string | number | undefined> {
  if (!axios.isAxiosError(error)) return { message: error instanceof Error ? error.message : 'Unknown Discord error' };
  return {
    status: error.response?.status,
    code: error.response?.data?.code,
    message: error.response?.data?.message || error.message,
  };
}

export function normalizeDiscordMessageTemplate(value?: string | null): string {
  const template = value?.trim() || DEFAULT_DISCORD_MESSAGE_TEMPLATE;
  if (template.length > MAX_DISCORD_MESSAGE_LENGTH) throw new Error('Discord message template is too long');
  const fields = template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);
  for (const field of fields) {
    if (!ALLOWED_TEMPLATE_FIELDS.has(field[1])) throw new Error(`Unsupported Discord template field: ${field[1]}`);
  }
  return template;
}

function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    OPEN: '🟢 `OPEN`', MERGED: '🟣 `MERGED`', CLOSED: '🔴 `CLOSED`',
    CONFLICT: '🔴 `CONFLICT`', DRAFT: '⚪ `DRAFT`',
  };
  return badges[(status || '').toUpperCase()] || '⚪ `UNKNOWN`';
}

function formatPullRequests(prs: PullRequestSummary[]): string {
  let message = '';
  const sections = [
    { label: 'Frontend Repositories', items: prs.filter((pr) => pr.type?.toUpperCase() === 'FE') },
    { label: 'Backend Repositories', items: prs.filter((pr) => pr.type?.toUpperCase() === 'BE') },
    { label: 'Pull Requests', items: prs.filter((pr) => !['FE', 'BE'].includes(pr.type?.toUpperCase() || '')) },
  ];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    message += `**${section.label}:**\n`;
    for (const pr of section.items) {
      message += `- [${pr.repo}] ${statusBadge(pr.status)} - [${pr.title}](${pr.url})\n`;
    }
    message += '\n';
  }
  return message.trim();
}

function formatRelatedTickets(tickets: DiscordSummary['relatedTickets']): string {
  if (!tickets || tickets.length < 2) return '';
  return `**Related Tickets:**\n${tickets.map((ticket) => `- [${ticket.key}](${ticket.url}) — ${ticket.title}`).join('\n')}`;
}

export function formatDiscordMessage(summary: DiscordSummary, messageTemplate?: string | null): string {
  const template = normalizeDiscordMessageTemplate(messageTemplate);
  const values: Record<string, string> = {
    ticketKey: summary.ticket.key,
    ticketTitle: summary.ticket.title,
    ticketUrl: summary.ticket.url,
    relatedTickets: formatRelatedTickets(summary.relatedTickets),
    pullRequests: formatPullRequests(summary.prs),
    demoUrl: summary.demoUrl ? `🎬 **Demo Video:**\n${summary.demoUrl}` : '',
  };
  const message = template
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, field: string) => values[field] || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!message || message.length > MAX_DISCORD_MESSAGE_LENGTH) throw new Error('Discord message must be between 1 and 2000 characters');
  return message;
}

export class DiscordService {
  private delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async sendSummary(
    payload: DiscordSummary,
    webhookUrl: string,
    options: { customMessage?: string; messageTemplate?: string; threadId?: string; threadName?: string } = {},
    retryCount = 0,
    forumFallbackAttempted = false,
  ): Promise<void> {
    const message = options.customMessage?.trim() || formatDiscordMessage(payload, options.messageTemplate);
    if (message.length > MAX_DISCORD_MESSAGE_LENGTH) throw new Error('Discord message must not exceed 2000 characters');
    const targetUrl = options.threadId?.trim()
      ? `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}thread_id=${encodeURIComponent(options.threadId.trim())}`
      : webhookUrl;
    const body: { content: string; thread_name?: string; allowed_mentions: { parse: string[] } } = {
      content: message,
      allowed_mentions: { parse: [] },
    };
    if (options.threadName?.trim() && !options.threadId?.trim()) body.thread_name = options.threadName.trim();

    try {
      await axios.post(targetUrl, body, { timeout: 10000 });
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 429 && retryCount < 3) {
        const header = Number.parseFloat(String(error.response.headers['retry-after'] || ''));
        const retryAfter = Number.isFinite(header) ? header * 1000 : (2 ** retryCount) * 1000;
        await this.delay(retryAfter);
        return this.sendSummary(payload, webhookUrl, options, retryCount + 1, forumFallbackAttempted);
      }
      if (axios.isAxiosError(error)
        && error.response?.status === 400
        && error.response?.data?.code === DISCORD_FORUM_THREAD_REQUIRED_CODE
        && !options.threadId?.trim()
        && !options.threadName?.trim()
        && !forumFallbackAttempted) {
        return this.sendSummary(
          payload,
          webhookUrl,
          { ...options, threadName: buildDiscordForumTitle(payload.ticket) },
          retryCount,
          true,
        );
      }
      throw error;
    }
  }

  async validateWebhook(webhookUrl: string) {
    try {
      const response = await axios.get(webhookUrl, { timeout: 10000 });
      return response.status === 200;
    } catch { return false; }
  }
}
