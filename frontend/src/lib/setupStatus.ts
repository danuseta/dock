export interface SetupGap { section: 'jira' | 'github' | 'security'; label: string; missing: string }

export interface SetupSettings {
  jiraUrl?: string | null;
  jiraEmail?: string | null;
  hasJiraApiToken?: boolean | null;
  hasGithubToken?: boolean | null;
  hasMasterPin?: boolean | null;
}

export function setupGaps(settings: SetupSettings): SetupGap[] {
  const jira = [!settings.jiraUrl && 'URL', !settings.jiraEmail && 'email', !settings.hasJiraApiToken && 'API token'].filter(Boolean).join(', ');
  return [
    ...(jira ? [{ section: 'jira' as const, label: 'Jira', missing: jira }] : []),
    ...(settings.hasGithubToken ? [] : [{ section: 'github' as const, label: 'GitHub', missing: 'Personal access token' }]),
    ...(settings.hasMasterPin ? [] : [{ section: 'security' as const, label: 'Security', missing: 'PIN' }]),
  ];
}
