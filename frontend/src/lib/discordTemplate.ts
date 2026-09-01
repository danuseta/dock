export const DEFAULT_DISCORD_MESSAGE_TEMPLATE = `🚀 **Update: {{ticketKey}} - {{ticketTitle}}**

**Jira Ticket:** [{{ticketKey}}]({{ticketUrl}})

{{pullRequests}}
{{demoUrl}}`;

const ALLOWED_TEMPLATE_FIELDS = new Set(['ticketKey', 'ticketTitle', 'ticketUrl', 'relatedTickets', 'pullRequests', 'demoUrl']);
const TICKET_FIELD_PATTERN = /\{\{\s*(ticketKey|ticketTitle|ticketUrl)\s*\}\}/;
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

interface DiscordTemplateTicket { key: string; title: string; url?: string }
interface DiscordTemplateData {
  ticket: DiscordTemplateTicket;
  relatedTickets?: DiscordTemplateTicket[];
  pullRequests: Array<{ repo?: string; title?: string; url?: string; status?: string; type?: string }>;
  demoUrl?: string;
}

const ticketUrl = (ticket: DiscordTemplateTicket) => ticket.url || `https://jira.example.com/browse/${ticket.key}`;

const formatRelatedTickets = (tickets?: DiscordTemplateData['relatedTickets']) => {
  if (!tickets || tickets.length < 2) return '';
  return `**Related Tickets:**\n${tickets.map((ticket) => `- [${ticket.key}](${ticketUrl(ticket)}) — ${ticket.title}`).join('\n')}`;
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

const fillFields = (line: string, values: Record<string, string>) => (
  line.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, field: string) => values[field] || '')
);

export const renderDiscordMessageTemplate = (template: string | null | undefined, data: DiscordTemplateData) => {
  const groupTickets = data.relatedTickets?.length ? data.relatedTickets : [data.ticket];
  const sharedValues: Record<string, string> = {
    relatedTickets: formatRelatedTickets(data.relatedTickets),
    pullRequests: formatPullRequests(data.pullRequests),
    demoUrl: data.demoUrl || '',
  };
  return (template?.trim() || DEFAULT_DISCORD_MESSAGE_TEMPLATE)
    .split('\n')
    .map((line) => (TICKET_FIELD_PATTERN.test(line)
      ? groupTickets.map((ticket) => fillFields(line, {
        ...sharedValues,
        ticketKey: ticket.key,
        ticketTitle: ticket.title,
        ticketUrl: ticketUrl(ticket),
      })).join('\n')
      : fillFields(line, sharedValues)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
