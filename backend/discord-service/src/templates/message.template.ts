export interface PRInfo {
  repo: string;
  title: string;
  url: string;
  status: string;
  type?: string;
}

export interface SummaryPayload {
  ticket: {
    key: string;
    title: string;
    url: string;
  };
  prs: PRInfo[];
  demoUrl?: string;
}

const getStatusBadge = (status: string) => {
  switch ((status || '').toUpperCase()) {
    case 'OPEN': return '🟢 `OPEN`';
    case 'MERGED': return '🟣 `MERGED`';
    case 'CLOSED': return '🔴 `CLOSED`';
    case 'CONFLICT': return '🔴 `CONFLICT`';
    case 'DRAFT': return '⚪ `DRAFT`';
    default: return '⚪ `UNKNOWN`';
  }
};

export const formatMessage = (payload: SummaryPayload): string => {
  const { ticket, prs, demoUrl } = payload;
  
  let message = `🚀 **Update: ${ticket.key} - ${ticket.title}**\n\n`;
  message += `**Jira Ticket:** [${ticket.key}](${ticket.url})\n\n`;
  
  const sections = [
    { label: 'Frontend Repositories', items: prs.filter(pr => pr.type?.toUpperCase() === 'FE') },
    { label: 'Backend Repositories', items: prs.filter(pr => pr.type?.toUpperCase() === 'BE') },
    { label: 'Pull Requests', items: prs.filter(pr => !['FE', 'BE'].includes(pr.type?.toUpperCase() || '')) },
  ];

  sections.forEach(({ label, items }) => {
    if (items.length === 0) return;
    message += `**${label}:**\n`;
    items.forEach(pr => {
      message += `- [${pr.repo}] ${getStatusBadge(pr.status)} - [${pr.title}](${pr.url})\n`;
    });
    message += `\n`;
  });
  
  if (demoUrl) {
    message += `🎬 **Demo Video:**\n${demoUrl}\n`;
  }
  
  return message;
};
