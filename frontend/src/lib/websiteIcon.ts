export type WebsiteIconKind =
  | 'calendar'
  | 'discord'
  | 'docker'
  | 'figma'
  | 'github'
  | 'gitlab'
  | 'google'
  | 'jira'
  | 'npm'
  | 'server'
  | 'slack'
  | 'trello';

const WEBSITE_ICON_DOMAINS: Record<Exclude<WebsiteIconKind, 'calendar' | 'server'>, readonly string[]> = {
  discord: ['discord.com', 'discordapp.com'],
  docker: ['docker.com', 'docker.io'],
  figma: ['figma.com'],
  github: ['github.com', 'githubusercontent.com'],
  gitlab: ['gitlab.com'],
  google: ['google.com', 'googleapis.com', 'gstatic.com'],
  jira: ['atlassian.com', 'atlassian.net', 'jira.com'],
  npm: ['npmjs.com', 'npmjs.org'],
  slack: ['slack.com'],
  trello: ['trello.com'],
};

function normalizeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function getWebsiteIconKind(url: string, title = ''): WebsiteIconKind | null {
  const hostname = normalizeHostname(url);
  if (hostname === 'calendar.google.com') return 'calendar';

  if (hostname) {
    for (const [kind, domains] of Object.entries(WEBSITE_ICON_DOMAINS) as [Exclude<WebsiteIconKind, 'calendar' | 'server'>, readonly string[]][]) {
      if (domains.some((domain) => matchesDomain(hostname, domain))) return kind;
    }

    if (hostname === 'localhost' || hostname.endsWith('.local') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
      return 'server';
    }
  }

  const normalizedTitle = title.trim().toLowerCase();
  if (normalizedTitle.includes('calendar')) return 'calendar';
  if (normalizedTitle.includes('discord')) return 'discord';
  if (normalizedTitle.includes('docker')) return 'docker';
  if (normalizedTitle.includes('figma')) return 'figma';
  if (normalizedTitle.includes('github')) return 'github';
  if (normalizedTitle.includes('gitlab')) return 'gitlab';
  if (normalizedTitle.includes('google')) return 'google';
  if (normalizedTitle.includes('jira') || normalizedTitle.includes('atlassian')) return 'jira';
  if (normalizedTitle === 'npm' || normalizedTitle.startsWith('npm ')) return 'npm';
  if (normalizedTitle.includes('slack')) return 'slack';
  if (normalizedTitle.includes('trello')) return 'trello';
  return null;
}

export function getWebsiteIconSources(url: string): string[] {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    return [
      `${origin}/favicon-192x192.png`,
      `${origin}/apple-touch-icon.png`,
      `${origin}/favicon-96x96.png`,
      `${origin}/favicon.svg`,
      `${origin}/favicon.ico`,
      `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(origin)}&sz=128`,
    ];
  } catch {
    return [];
  }
}
