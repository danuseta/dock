const MOVED: Record<string, string> = {
  '/sprint': '/planning?tab=now',
  '/dev-servers': '/workspace?tab=servers',
  '/machines': '/workspace?tab=health',
  '/issues': '/?report=issues',
};

export function movedPageRedirect(href: string): string {
  return MOVED[href.split('?')[0]] ?? href;
}

export const opensReportedBugs = (search: string) => new URLSearchParams(search).get('report') === 'issues';
