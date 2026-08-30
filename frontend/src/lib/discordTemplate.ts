export const DEFAULT_DISCORD_MESSAGE_TEMPLATE = `🚀 **Update: {{ticketKey}} - {{ticketTitle}}**

**Jira Ticket:** [{{ticketKey}}]({{ticketUrl}})

{{pullRequests}}
{{demoUrl}}`;

const ALLOWED_TEMPLATE_FIELDS = new Set(['ticketKey', 'ticketTitle', 'ticketUrl', 'pullRequests', 'demoUrl']);

export const getDiscordTemplateError = (template: string) => {
  if (!template.trim()) return 'Discord message template cannot be empty.';
  if (template.length > 2000) return 'Discord message template must not exceed 2000 characters.';
  for (const match of template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!ALLOWED_TEMPLATE_FIELDS.has(match[1])) return `Unsupported template field: ${match[1]}`;
  }
  return '';
};

interface DiscordTemplateData {
  ticket: { key: string; title: string; url?: string };
  pullRequests: Array<{ repo?: string; title?: string; url?: string; status?: string; type?: string }>;
  demoUrl?: string;
}

const statusBadge = (status?: string) => {
  const badges: Record<string, string> = {
    OPEN: '🟢 `OPEN`', MERGED: '🟣 `MERGED`', CLOSED: '🔴 `CLOSED`',
    CONFLICT: '🔴 `CONFLICT`', DRAFT: '⚪ `DRAFT`',
  };
  return badges[(status || '').toUpperCase()] || '⚪ `UNKNOWN`';
};

const formatPullRequests = (pullRequests: DiscordTemplateData['pullRequests']) => {
  const sections = [
    { label: 'Frontend Repositories', items: pullRequests.filter((pr) => pr.type?.toUpperCase() === 'FE') },
    { label: 'Backend Repositories', items: pullRequests.filter((pr) => pr.type?.toUpperCase() === 'BE') },
    { label: 'Pull Requests', items: pullRequests.filter((pr) => !['FE', 'BE'].includes(pr.type?.toUpperCase() || '')) },
  ];
  return sections.filter((section) => section.items.length > 0).map((section) => (
    `**${section.label}:**\n${section.items.map((pr) => `- [${pr.repo || 'Repository'}] ${statusBadge(pr.status)} - [${pr.title || 'Pull request'}](${pr.url || '#'})`).join('\n')}`
  )).join('\n\n');
};

export const renderDiscordMessageTemplate = (template: string | null | undefined, data: DiscordTemplateData) => {
  const values: Record<string, string> = {
    ticketKey: data.ticket.key,
    ticketTitle: data.ticket.title,
    ticketUrl: data.ticket.url || `https://jira.example.com/browse/${data.ticket.key}`,
    pullRequests: formatPullRequests(data.pullRequests),
    demoUrl: data.demoUrl ? `🎬 **Demo Video:**\n${data.demoUrl}` : '',
  };
  return (template?.trim() || DEFAULT_DISCORD_MESSAGE_TEMPLATE)
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, field: string) => values[field] || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
