export const DEFAULT_DISCORD_MESSAGE_TEMPLATE = `🚀 **Update: {{ticketKey}} - {{ticketTitle}}**

**Jira Ticket:** [{{ticketKey}}]({{ticketUrl}})

{{relatedTickets}}
{{pullRequests}}
{{demoUrl}}`;

const ALLOWED_TEMPLATE_FIELDS = new Set(['ticketKey', 'ticketTitle', 'ticketUrl', 'relatedTickets', 'pullRequests', 'demoUrl']);
const MAX_DISCORD_THREAD_NAME_LENGTH = 100;

export const buildDiscordForumTitle = (ticket: { key: string; title: string }) => (
  [...`[${ticket.key}] ${ticket.title}`]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISCORD_THREAD_NAME_LENGTH)
);

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
  relatedTickets?: Array<{ key: string; title: string; url?: string }>;
  pullRequests: Array<{ repo?: string; title?: string; url?: string; status?: string; type?: string }>;
  demoUrl?: string;
}

const formatRelatedTickets = (tickets?: DiscordTemplateData['relatedTickets']) => {
  if (!tickets || tickets.length < 2) return '';
  return `**Related Tickets:**\n${tickets.map((ticket) => `- [${ticket.key}](${ticket.url || '#'}) — ${ticket.title}`).join('\n')}`;
};

const formatPullRequests = (pullRequests: DiscordTemplateData['pullRequests']) => {
  const sections = [
    { label: 'Frontend Repositories', items: pullRequests.filter((pr) => pr.type?.toUpperCase() === 'FE') },
    { label: 'Backend Repositories', items: pullRequests.filter((pr) => pr.type?.toUpperCase() === 'BE') },
    { label: 'Pull Requests', items: pullRequests.filter((pr) => !['FE', 'BE'].includes(pr.type?.toUpperCase() || '')) },
  ];
  return sections.filter((section) => section.items.length > 0).map((section) => (
    `**${section.label}:**\n${section.items.map((pr) => `- [${pr.repo || 'Repository'}] - [${pr.title || 'Pull request'}](${pr.url || '#'})`).join('\n')}`
  )).join('\n\n');
};

export const renderDiscordMessageTemplate = (template: string | null | undefined, data: DiscordTemplateData) => {
  const values: Record<string, string> = {
    ticketKey: data.ticket.key,
    ticketTitle: data.ticket.title,
    ticketUrl: data.ticket.url || `https://jira.example.com/browse/${data.ticket.key}`,
    relatedTickets: formatRelatedTickets(data.relatedTickets),
    pullRequests: formatPullRequests(data.pullRequests),
    demoUrl: data.demoUrl || '',
  };
  return (template?.trim() || DEFAULT_DISCORD_MESSAGE_TEMPLATE)
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, field: string) => values[field] || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
