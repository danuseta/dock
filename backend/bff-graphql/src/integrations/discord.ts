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
  prs: PullRequestSummary[];
  demoUrl?: string;
}

function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    OPEN: '🟢 `OPEN`', MERGED: '🟣 `MERGED`', CLOSED: '🔴 `CLOSED`',
    CONFLICT: '🔴 `CONFLICT`', DRAFT: '⚪ `DRAFT`',
  };
  return badges[(status || '').toUpperCase()] || '⚪ `UNKNOWN`';
}

export function formatDiscordMessage({ ticket, prs, demoUrl }: DiscordSummary): string {
  let message = `🚀 **Update: ${ticket.key} - ${ticket.title}**\n\n`;
  message += `**Jira Ticket:** [${ticket.key}](${ticket.url})\n\n`;
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
  if (demoUrl) message += `🎬 **Demo Video:**\n${demoUrl}\n`;
  return message;
}

export class DiscordService {
  private delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async sendSummary(
    payload: DiscordSummary,
    webhookUrl: string,
    options: { customMessage?: string; threadId?: string; threadName?: string } = {},
    retryCount = 0,
  ): Promise<void> {
    const message = options.customMessage?.trim() || formatDiscordMessage(payload);
    const targetUrl = options.threadId?.trim()
      ? `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}thread_id=${encodeURIComponent(options.threadId.trim())}`
      : webhookUrl;
    const body: { content: string; thread_name?: string } = { content: message };
    if (options.threadName?.trim() && !options.threadId?.trim()) body.thread_name = options.threadName.trim();

    try {
      await axios.post(targetUrl, body, { timeout: 10000 });
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 429 && retryCount < 3) {
        const header = Number.parseFloat(String(error.response.headers['retry-after'] || ''));
        const retryAfter = Number.isFinite(header) ? header * 1000 : (2 ** retryCount) * 1000;
        await this.delay(retryAfter);
        return this.sendSummary(payload, webhookUrl, options, retryCount + 1);
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
