import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client';
import {
  Activity, Bot, CalendarDays, CheckCircle2, ChevronRight, Eye, EyeOff, GitBranch,
  KeyRound, LayoutPanelLeft, Lock, MessageSquare, Save, ShieldCheck, Unplug, Zap,
  type LucideIcon,
} from 'lucide-react';
import { GET_SETTINGS, GET_GITHUB_REPOS, GET_JIRA_PROJECTS, GET_INGEST_TOKENS } from '../graphql/queries';
import { UPDATE_SETTINGS, VALIDATE_JIRA, VALIDATE_GITHUB, VALIDATE_DISCORD, SET_MASTER_PIN, CHANGE_MASTER_PIN, REMOVE_MASTER_PIN, DISCONNECT_GOOGLE_CALENDAR } from '../graphql/mutations';
import { Toast } from '../components/Toast';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { IngestTokensSection } from '../components/IngestTokensSection';
import { PushCard } from '../components/PushCard';
import { NAVIGATION_PREFERENCES_EVENT, NavigationMode, NavigationPreferences, readNavigationPreferences, saveNavigationPreferences } from '../lib/navigationPreferences';
import { Badge, Button, Card, Checkbox, IconButton, Input, Page, Select, Textarea } from '../components/ui';
import { cn } from '../lib/cn';
import {
  isValidServiceHealthRefreshSeconds,
  MAX_SERVICE_HEALTH_REFRESH_SECONDS,
  MIN_SERVICE_HEALTH_REFRESH_SECONDS,
  normalizeServiceHealthRefreshSeconds,
} from '../lib/serviceHealthRefresh';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE, getDiscordTemplateError, renderDiscordMessageTemplate } from '../lib/discordTemplate';

type SettingsSection = 'general' | 'security' | 'jira' | 'github' | 'calendar' | 'discord' | 'agents';
type RefreshUnit = 'seconds' | 'minutes';

const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: LucideIcon;
  group: 'Preferences' | 'Connections';
}> = [
  { id: 'general', label: 'General', description: 'Appearance & refresh', icon: LayoutPanelLeft, group: 'Preferences' },
  { id: 'security', label: 'Security', description: 'Fallback PIN', icon: Lock, group: 'Preferences' },
  { id: 'jira', label: 'Jira', description: 'Projects & tickets', icon: ShieldCheck, group: 'Connections' },
  { id: 'github', label: 'GitHub', description: 'Repositories', icon: GitBranch, group: 'Connections' },
  { id: 'calendar', label: 'Calendar', description: 'Google OAuth', icon: CalendarDays, group: 'Connections' },
  { id: 'discord', label: 'Discord', description: 'Notifications', icon: MessageSquare, group: 'Connections' },
  { id: 'agents', label: 'Agents', description: 'Orchestrator ingest', icon: Bot, group: 'Connections' },
];

const navigationPreview: Record<NavigationMode, string> = {
  left: 'h-full w-2', right: 'ml-auto h-full w-2', top: 'h-2 w-3/5', bottom: 'mt-auto h-2 w-3/5',
};

const googleFailureMessages: Record<string, string> = {
  'access-denied': 'Google denied access. Confirm this account is allowed as a test user, then try again.',
  'redirect-uri': 'Google rejected the redirect URI. Register the exact HTTPS callback shown below in Google Cloud.',
  'invalid-client': 'Google rejected the OAuth client. Check the client ID and secret, then save settings again.',
  'state-expired': 'The OAuth request expired or was interrupted. Start the connection again from this page.',
  'refresh-token': 'Google did not return offline access. Revoke DOCK access in Google, then connect again.',
  configuration: 'Google OAuth client credentials are missing. Save the client ID and secret first.',
  'token-exchange': 'Google accepted the redirect but rejected the token exchange. Check the OAuth client configuration.',
  'provider-error': 'Google returned an OAuth error. Confirm the account and OAuth consent-screen settings, then try again.',
};

const discordTemplatePreviewData = {
  ticket: {
    key: 'QRD-1055',
    title: '[BE] Component Template: folder support',
    url: 'https://mysales.atlassian.net/browse/QRD-1055',
  },
  pullRequests: [{
    repo: 'ms-admin-worker-backend',
    title: 'feat(QRD-1055): add folder support to the component template module',
    url: 'https://github.com/qonekid/ms-admin-worker-backend/pull/969',
    status: 'OPEN',
  }],
  demoUrl: '- **QRD-1055:** https://docs.google.com/document/u/0/',
};

const SectionTitle = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <h2 className="mb-4 flex items-center gap-2 border-b border-border pb-2 font-display text-lg font-bold">{icon}{children}</h2>
);

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{hint && <span className="mb-1.5 block text-xs text-muted-foreground">{hint}</span>}{children}</label>
);

const SettingsHeading = ({ title, description }: { title: string; description: string }) => (
  <header className="mb-5"><h2 className="text-balance font-display text-2xl font-bold">{title}</h2><p className="mt-1 text-pretty text-sm text-secondary-foreground">{description}</p></header>
);

const SettingsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [navigationPreferences, setNavigationPreferences] = useState(readNavigationPreferences);
  const { data, loading, error, refetch } = useQuery(GET_SETTINGS, CACHED_QUERY_OPTIONS);
  const { data: ingestTokenData } = useQuery(GET_INGEST_TOKENS, CACHED_QUERY_OPTIONS);
  const [updateSettings] = useMutation(UPDATE_SETTINGS);
  const [validateJira, { loading: testingJira }] = useMutation(VALIDATE_JIRA);
  const [validateGitHub, { loading: testingGitHub }] = useMutation(VALIDATE_GITHUB);
  const [validateDiscord, { loading: testingDiscord }] = useMutation(VALIDATE_DISCORD);
  
  const [setMasterPinMutation, { loading: settingPin }] = useMutation(SET_MASTER_PIN, { refetchQueries: [{ query: GET_SETTINGS }] });
  const [changeMasterPinMutation, { loading: changingPin }] = useMutation(CHANGE_MASTER_PIN, { refetchQueries: [{ query: GET_SETTINGS }] });
  const [removeMasterPinMutation, { loading: removingPin }] = useMutation(REMOVE_MASTER_PIN, { refetchQueries: [{ query: GET_SETTINGS }] });
  const [disconnectGoogleCalendar, { loading: disconnectingGoogle }] = useMutation(DISCONNECT_GOOGLE_CALENDAR, { refetchQueries: [{ query: GET_SETTINGS }] });

  const [jiraUrl, setJiraUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraApiToken, setJiraApiToken] = useState('');
  const [jiraProjectKeys, setJiraProjectKeys] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [githubRepos, setGithubRepos] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [discordMessageTemplate, setDiscordMessageTemplate] = useState(DEFAULT_DISCORD_MESSAGE_TEMPLATE);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleCalendarId, setGoogleCalendarId] = useState('primary');
  const [serviceHealthRefreshValue, setServiceHealthRefreshValue] = useState('1');
  const [serviceHealthRefreshUnit, setServiceHealthRefreshUnit] = useState<RefreshUnit>('minutes');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Password Visibility Toggles
  const [showJiraToken, setShowJiraToken] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showDiscordWebhook, setShowDiscordWebhook] = useState(false);
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => setNavigationPreferences((event as CustomEvent<NavigationPreferences>).detail);
    window.addEventListener(NAVIGATION_PREFERENCES_EVENT, handlePreferenceChange);
    return () => window.removeEventListener(NAVIGATION_PREFERENCES_EVENT, handlePreferenceChange);
  }, []);

  const updateNavigation = (mode: NavigationMode) => {
    const next = { mode, collapsed: mode === 'left' || mode === 'right' ? navigationPreferences.collapsed : false };
    setNavigationPreferences(next);
    saveNavigationPreferences(next);
  };

  const updateSidebarSize = (collapsed: boolean) => {
    const next = { ...navigationPreferences, collapsed };
    setNavigationPreferences(next);
    saveNavigationPreferences(next);
  };

  // PIN Form State
  const [isPinActive, setIsPinActive] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [changeNewPin, setChangeNewPin] = useState('');
  const [removePinCurrent, setRemovePinCurrent] = useState('');
  const [showChangePinForm, setShowChangePinForm] = useState(false);

  // GitHub Repos Picker State
  const [fetchRepos, { data: reposData, loading: loadingRepos }] = useLazyQuery(GET_GITHUB_REPOS, { fetchPolicy: 'network-only' });
  const [repoSearch, setRepoSearch] = useState('');
  const [fetchJiraProjects, { data: jiraProjectsData, loading: loadingJiraProjects }] = useLazyQuery(GET_JIRA_PROJECTS, { fetchPolicy: 'network-only' });

  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    if (data?.settings && !hasUnsavedChanges) {
      setJiraUrl(data.settings.jiraUrl || '');
      setJiraEmail(data.settings.jiraEmail || '');
      setJiraProjectKeys(data.settings.jiraProjectKeys || '');
      setGithubRepos(data.settings.githubRepos || '');
      setDiscordMessageTemplate(data.settings.discordMessageTemplate || DEFAULT_DISCORD_MESSAGE_TEMPLATE);
      setGoogleClientId(data.settings.googleClientId || '');
      setGoogleCalendarId(data.settings.googleCalendarId || 'primary');
      const refreshSeconds = normalizeServiceHealthRefreshSeconds(data.settings.serviceHealthRefreshSeconds);
      const useMinutes = refreshSeconds % 60 === 0;
      setServiceHealthRefreshUnit(useMinutes ? 'minutes' : 'seconds');
      setServiceHealthRefreshValue(String(useMinutes ? refreshSeconds / 60 : refreshSeconds));
      setIsPinActive(!!data.settings.hasMasterPin);
      setHasUnsavedChanges(false);
    }
  }, [data, hasUnsavedChanges]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google');
    if (result === 'connected') setToast({ message: 'Google Calendar connected successfully.', type: 'success' });
    if (result === 'failed') {
      const reason = params.get('reason') || 'token-exchange';
      setToast({ message: googleFailureMessages[reason] || googleFailureMessages['token-exchange'], type: 'error' });
    }
    if (result === 'configuration-required') setToast({ message: 'Save the Google OAuth client ID and secret first.', type: 'error' });
  }, []);

  // Auto-fetch when user pastes/types a token
  useEffect(() => {
    if (githubToken && githubToken.length > 15) {
      const timer = setTimeout(() => {
        fetchRepos({ variables: { token: githubToken } });
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [githubToken, fetchRepos]);

  if (isInitialQueryLoading(loading, data)) return <Page width="medium"><LoadingSkeleton /></Page>;
  if (error && !data) return <Page width="medium"><Card className="border-status-conflict text-status-conflict" role="alert">Error: {error.message}</Card></Page>;

  const hasMasterPin = isPinActive || data?.settings?.hasMasterPin || false;
  const serviceHealthRefreshSeconds = Number(serviceHealthRefreshValue)
    * (serviceHealthRefreshUnit === 'minutes' ? 60 : 1);
  const isRefreshIntervalValid = isValidServiceHealthRefreshSeconds(serviceHealthRefreshSeconds);
  const discordTemplateError = getDiscordTemplateError(discordMessageTemplate);
  const discordTemplatePreview = discordTemplateError
    ? ''
    : renderDiscordMessageTemplate(discordMessageTemplate, discordTemplatePreviewData);
  const refreshMinimum = serviceHealthRefreshUnit === 'minutes' ? 1 : MIN_SERVICE_HEALTH_REFRESH_SECONDS;
  const refreshMaximum = serviceHealthRefreshUnit === 'minutes'
    ? MAX_SERVICE_HEALTH_REFRESH_SECONDS / 60
    : MAX_SERVICE_HEALTH_REFRESH_SECONDS;

  const markUnsaved = () => setHasUnsavedChanges(true);

  const handleSave = async (showSuccessToast = true): Promise<boolean> => {
    if (!isRefreshIntervalValid) {
      setActiveSection('general');
      setToast({ message: 'Service health refresh must be a whole number between 5 seconds and 24 hours.', type: 'error' });
      return false;
    }
    if (discordTemplateError) {
      setActiveSection('discord');
      setToast({ message: discordTemplateError, type: 'error' });
      return false;
    }
    try {
      const result = await updateSettings({
        variables: {
          input: {
            jiraUrl,
            jiraEmail,
            jiraApiToken,
            jiraProjectKeys,
            githubToken,
            githubRepos,
            discordWebhookUrl,
            discordMessageTemplate,
            googleClientId,
            googleClientSecret,
            googleCalendarId,
            serviceHealthRefreshSeconds
          }
        }
      });
      if (result.data?.updateSettings !== true) {
        setToast({ message: 'Settings could not be saved. Unlock DOCK and check the connection, then try again.', type: 'error' });
        return false;
      }
      await refetch();
      setHasUnsavedChanges(false);
      if (showSuccessToast) setToast({ message: 'Settings saved. Existing secret values are retained when their fields are left blank.', type: 'success' });
      return true;
    } catch (err) {
      setToast({ message: 'Failed to save settings', type: 'error' });
      return false;
    }
  };

  const handleConnectGoogle = async () => {
    if (!googleClientId || (!googleClientSecret && !data?.settings?.hasGoogleClientSecret)) {
      setToast({ message: 'Google OAuth client ID and secret are required.', type: 'error' });
      return;
    }
    if (await handleSave(false)) window.location.assign('/auth/google/start');
  };

  const handleDisconnectGoogle = async () => {
    await disconnectGoogleCalendar();
    await refetch();
    setToast({ message: 'Google Calendar disconnected.', type: 'info' });
  };

  const handleTestJira = async () => {
    try {
      const res = await validateJira({ variables: { url: jiraUrl, email: jiraEmail, token: jiraApiToken } });
      const result = res.data?.validateJira;
      setToast({ message: result.message, type: result.success ? 'success' : 'error' });
      if (result.success) {
        fetchJiraProjects({ variables: { url: jiraUrl, email: jiraEmail, token: jiraApiToken } });
      }
    } catch (err: any) {
      setToast({ message: 'Jira test failed', type: 'error' });
    }
  };

  const selectedJiraProjects = jiraProjectKeys.split(',').map((key) => key.trim()).filter(Boolean);
  const handleToggleJiraProject = (key: string) => {
    const next = selectedJiraProjects.includes(key)
      ? selectedJiraProjects.filter((item) => item !== key)
      : [...selectedJiraProjects, key];
    setJiraProjectKeys(next.join(', '));
    markUnsaved();
  };

  const handleTestGitHub = async () => {
    try {
      const res = await validateGitHub({ variables: { token: githubToken } });
      const result = res.data?.validateGitHub;
      setToast({ message: result.message, type: result.success ? 'success' : 'error' });
      if (result.success) {
        fetchRepos({ variables: { token: githubToken } });
      }
    } catch (err: any) {
      setToast({ message: 'GitHub test failed', type: 'error' });
    }
  };

  const selectedReposList = githubRepos
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  const handleToggleRepo = (fullName: string) => {
    let current = [...selectedReposList];
    if (current.includes(fullName)) {
      current = current.filter((r) => r !== fullName);
    } else {
      current.push(fullName);
    }
    setGithubRepos(current.join(', '));
    markUnsaved();
  };

  const handleTestDiscord = async () => {
    try {
      const res = await validateDiscord({ variables: { webhookUrl: discordWebhookUrl } });
      const result = res.data?.validateDiscord;
      setToast({ message: result.message, type: result.success ? 'success' : 'error' });
    } catch (err: any) {
      setToast({ message: 'Discord test failed', type: 'error' });
    }
  };

  const handleSetPin = async () => {
    if (!newPin || newPin.length < 4) {
      setToast({ message: 'PIN must be at least 4 digits', type: 'error' });
      return;
    }
    try {
      const res = await setMasterPinMutation({ variables: { pin: newPin } });
      if (res.data?.setMasterPin) {
        setToast({ message: 'Master Passcode PIN saved to DB (SHA-256)!', type: 'success' });
        setNewPin('');
        setIsPinActive(true);
        await refetch();
      } else {
        setToast({ message: 'Server failed to save PIN to database', type: 'error' });
      }
    } catch (err: any) {
      console.error('setMasterPin error:', err);
      setToast({ message: err?.message || 'Failed to set PIN', type: 'error' });
    }
  };

  const handleChangePin = async () => {
    if (!currentPin || !changeNewPin || changeNewPin.length < 4) {
      setToast({ message: 'Current PIN and valid New PIN (>=4 digits) are required', type: 'error' });
      return;
    }
    try {
      const res = await changeMasterPinMutation({ variables: { oldPin: currentPin, newPin: changeNewPin } });
      if (res.data?.changeMasterPin) {
        setToast({ message: 'Master Passcode PIN changed successfully!', type: 'success' });
        setCurrentPin('');
        setChangeNewPin('');
        setShowChangePinForm(false);
        await refetch();
      } else {
        setToast({ message: 'Incorrect Current PIN!', type: 'error' });
      }
    } catch (err: any) {
      console.error('changeMasterPin error:', err);
      setToast({ message: err?.message || 'Failed to change PIN', type: 'error' });
    }
  };

  const handleRemovePin = async () => {
    if (!removePinCurrent) {
      setToast({ message: 'Enter your Current PIN to remove lock', type: 'error' });
      return;
    }
    try {
      const res = await removeMasterPinMutation({ variables: { oldPin: removePinCurrent } });
      if (res.data?.removeMasterPin) {
        setToast({ message: 'Master Passcode PIN removed from DB', type: 'info' });
        setRemovePinCurrent('');
        setIsPinActive(false);
        await refetch();
      } else {
        setToast({ message: 'Incorrect Current PIN!', type: 'error' });
      }
    } catch (err: any) {
      console.error('removeMasterPin error:', err);
      setToast({ message: err?.message || 'Failed to remove PIN', type: 'error' });
    }
  };

  const connectionStatus: Record<SettingsSection, boolean> = {
    general: true,
    security: hasMasterPin,
    jira: Boolean(data?.settings?.hasJiraApiToken && jiraUrl && jiraEmail),
    github: Boolean(data?.settings?.hasGithubToken),
    calendar: Boolean(data?.settings?.googleCalendarConnected),
    discord: Boolean(data?.settings?.hasDiscordWebhookUrl),
    agents: (ingestTokenData?.ingestTokens?.length || 0) > 0,
  };

  return (
    <Page width="wide" className="pb-28">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-1 text-xs font-semibold text-muted-foreground">SYSTEM</p><h1 className="text-balance font-display text-3xl font-bold">Settings</h1><p className="mt-2 max-w-2xl text-pretty text-sm text-secondary-foreground">Manage your DOCK experience, security, and connected services from one place.</p></div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={cn('size-2 rounded-full', hasUnsavedChanges ? 'bg-status-conflict' : 'bg-status-merged')} aria-hidden="true" />{hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}</div>
      </header>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-7 max-[800px]:grid-cols-1">
        <div className="hidden max-[760px]:block">
          <Select aria-label="Settings section" value={activeSection} onValueChange={(value) => setActiveSection(value as SettingsSection)} options={settingsSections.map((section) => ({ value: section.id, label: section.label }))} />
        </div>
        <aside className="sticky top-6 min-w-0 max-w-full max-[800px]:static max-[800px]:overflow-x-auto max-[760px]:hidden" aria-label="Settings categories">
          {(['Preferences', 'Connections'] as const).map((group) => (
            <div key={group} className="mb-4 max-[800px]:mb-0 max-[800px]:inline-block max-[800px]:align-top">
              <p className="mb-2 px-2 text-[0.6875rem] font-semibold text-muted-foreground max-[800px]:sr-only">{group.toUpperCase()}</p>
              <nav className="flex flex-col gap-1 max-[800px]:flex-row" aria-label={`${group} settings`}>
                {settingsSections.filter((section) => section.group === group).map((section) => {
                  const Icon = section.icon;
                  const active = activeSection === section.id;
                  return <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} aria-current={active ? 'page' : undefined} className={cn('grid min-h-12 w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[800px]:w-auto max-[800px]:grid-cols-[28px_auto]', active ? 'border-border bg-surface-2 text-foreground' : 'border-transparent text-secondary-foreground hover:bg-surface-1 hover:text-foreground')}>
                    <span className="grid size-8 place-items-center rounded-sm bg-surface-1 max-[800px]:size-7"><Icon size={16} aria-hidden="true" /></span>
                    <span><strong className="block font-display text-sm">{section.label}</strong><small className="block whitespace-nowrap text-[0.6875rem] text-muted-foreground max-[800px]:hidden">{section.description}</small></span>
                    <span className={cn('size-2 rounded-full max-[800px]:hidden', connectionStatus[section.id] ? 'bg-status-merged' : 'bg-muted-foreground')} aria-hidden="true" />
                  </button>;
                })}
              </nav>
            </div>
          ))}
        </aside>

        <main className="min-w-0 max-w-[860px]">
          {activeSection === 'general' && <section>
            <SettingsHeading title="General" description="Control how DOCK looks and how often live service data is updated." />
            <div className="flex flex-col gap-5">
              <Card aria-labelledby="appearance-title">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 id="appearance-title" className="font-display text-lg font-bold">Navigation layout</h3><p className="mt-1 text-pretty text-sm text-muted-foreground">Choose where primary navigation appears across DOCK.</p></div><Badge>INTERFACE</Badge></div>
                <div className="grid grid-cols-4 gap-3 max-[960px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[620px]:grid-cols-1" role="radiogroup" aria-label="Navigation layout">
                  {([['left', 'Left', 'Sidebar'], ['right', 'Right', 'Sidebar'], ['top', 'Top', 'Floating dock'], ['bottom', 'Bottom', 'Floating dock']] as const).map(([mode, label, description]) => {
                    const active = navigationPreferences.mode === mode;
                    return <button type="button" role="radio" aria-checked={active} key={mode} className={cn('rounded-sm border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60', active ? 'border-accent bg-accent-dim' : 'border-border bg-surface-0 hover:border-border-glow')} onClick={() => updateNavigation(mode)}>
                      <span className="mb-3 flex h-10 rounded-sm border border-border bg-background p-1" aria-hidden="true"><span className={cn('block rounded-[2px] bg-accent/70', navigationPreview[mode])} /></span>
                      <strong className="block font-display text-sm">{label}</strong><small className="mt-1 block text-muted-foreground">{description}</small>
                    </button>;
                  })}
                </div>
                {(navigationPreferences.mode === 'left' || navigationPreferences.mode === 'right') && <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-sm border border-border bg-surface-0 p-3"><Checkbox checked={navigationPreferences.collapsed} onChange={(event) => updateSidebarSize(event.target.checked)} /><span><strong className="block text-sm">Start with minimized sidebar</strong><small className="text-muted-foreground">Show icons only until you expand it.</small></span></label>}
              </Card>

              <PushCard />

              <Card aria-labelledby="service-health-title">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-accent"><Activity size={18} aria-hidden="true" /></span><div><h3 id="service-health-title" className="font-display text-lg font-bold">Service health</h3><p className="mt-1 text-pretty text-sm text-muted-foreground">Set how often Home and Services automatically check upstream health.</p></div></div><Badge variant="success">ACTIVE</Badge></div>
                <div className="grid max-w-xl grid-cols-[minmax(180px,1fr)_minmax(150px,0.7fr)] gap-3 max-[520px]:grid-cols-1">
                  <Field label="Refresh every"><Input type="number" min={refreshMinimum} max={refreshMaximum} step={1} inputMode="numeric" className="font-mono tabular-nums" value={serviceHealthRefreshValue} aria-invalid={!isRefreshIntervalValid} aria-describedby="refresh-interval-hint refresh-interval-error" onChange={(event) => { setServiceHealthRefreshValue(event.target.value); markUnsaved(); }} /></Field>
                  <Field label="Time unit"><Select value={serviceHealthRefreshUnit} onValueChange={(value) => { setServiceHealthRefreshUnit(value as RefreshUnit); markUnsaved(); }} aria-label="Service health refresh unit" options={[{ value: 'seconds', label: 'Seconds' }, { value: 'minutes', label: 'Minutes' }]} /></Field>
                </div>
                <p id="refresh-interval-error" role="alert" className="mt-2 min-h-4 text-xs text-status-conflict">{isRefreshIntervalValid ? '' : 'Enter a whole-number interval between 5 seconds and 24 hours.'}</p>
                <p id="refresh-interval-hint" className="text-pretty text-xs text-muted-foreground">Minimum interval: 5 seconds. Longer intervals reduce upstream requests.</p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-0 p-3 text-sm"><span className="text-secondary-foreground">Effective refresh interval</span><strong className="font-mono text-accent tabular-nums">{isRefreshIntervalValid ? `${serviceHealthRefreshSeconds.toLocaleString()} seconds` : 'Invalid interval'}</strong></div>
              </Card>

              <Card aria-labelledby="connection-overview-title">
                <div className="mb-4"><h3 id="connection-overview-title" className="font-display text-lg font-bold">Connection overview</h3><p className="mt-1 text-pretty text-sm text-muted-foreground">Review integration status without opening every category.</p></div>
                <div className="grid grid-cols-2 gap-3 max-[620px]:grid-cols-1">{settingsSections.filter(({ group }) => group === 'Connections').map((section) => { const Icon = section.icon; return <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} className="flex items-center gap-3 rounded-sm border border-border bg-surface-0 p-3 text-left hover:border-border-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2"><Icon size={17} aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong className="block font-display text-sm">{section.label}</strong><small className={connectionStatus[section.id] ? 'text-status-merged' : 'text-muted-foreground'}>{connectionStatus[section.id] ? 'Connected' : 'Not configured'}</small></span><ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" /></button>; })}</div>
              </Card>
            </div>
          </section>}

          {activeSection === 'security' && <section><SettingsHeading title="Security" description="Protect non-Tailscale access to your dashboard and stored integration credentials." /><Card className={cn(hasMasterPin && 'border-status-merged')}>
            <SectionTitle icon={<Lock size={20} className={hasMasterPin ? 'text-status-merged' : 'text-secondary-foreground'} aria-hidden="true" />}>Master App Passcode (Local Lock PIN)</SectionTitle>
            <p className="mb-4 text-pretty text-sm text-secondary-foreground">Protect non-Tailscale access with a 4–6 digit fallback PIN. Requests through a trusted <span className="font-mono text-xs">.ts.net</span> address stay unlocked while the PIN remains available for local or other network access.<span className="mt-1 block font-mono text-xs text-muted-foreground">Stored securely in the database as a salted SHA-256 hash.</span></p>
            {hasMasterPin ? <div className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-status-merged bg-surface-0 p-4"><div className="flex items-center gap-2 font-semibold text-status-merged"><CheckCircle2 size={18} aria-hidden="true" />Fallback PIN Active for Non-Tailscale Access</div><Button size="sm" onClick={() => setShowChangePinForm(!showChangePinForm)}><KeyRound size={14} aria-hidden="true" />{showChangePinForm ? 'Cancel' : 'Change PIN'}</Button></div>
              {showChangePinForm && <Card className="flex flex-col gap-3 bg-surface-0"><h3 className="font-mono text-sm font-bold">Change Master PIN (Requires Current PIN)</h3><Input aria-label="Current PIN" type="password" className="font-mono" placeholder="Enter Current PIN..." maxLength={6} value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} /><Input aria-label="New PIN" type="password" className="font-mono" placeholder="Enter New PIN..." maxLength={6} value={changeNewPin} onChange={(e) => setChangeNewPin(e.target.value)} /><Button variant="primary" onClick={handleChangePin} disabled={changingPin}>{changingPin ? 'Updating PIN...' : 'Update PIN in DB'}</Button></Card>}
              <div className="mt-2 border-t border-dashed border-border pt-4"><label className="mb-1 block font-mono text-xs text-muted-foreground" htmlFor="remove-pin">To disable PIN Lock, enter the current PIN:</label><div className="flex flex-wrap gap-2"><Input id="remove-pin" type="password" className="w-[220px] font-mono" placeholder="Current PIN..." maxLength={6} value={removePinCurrent} onChange={(e) => setRemovePinCurrent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleRemovePin(); }} /><Button size="sm" variant="danger" onClick={handleRemovePin} disabled={removingPin}>{removingPin ? 'Disabling...' : 'Disable PIN Lock'}</Button></div></div>
            </div> : <div className="flex flex-wrap items-center gap-3"><Input aria-label="New PIN" type="password" className="w-[220px] font-mono" placeholder="Set 4–6 Digit PIN..." maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSetPin(); }} /><Button variant="primary" onClick={handleSetPin} disabled={settingPin}>{settingPin ? 'Saving PIN...' : 'Enable PIN Lock'}</Button></div>}
          </Card></section>}

          {activeSection === 'jira' && <section><SettingsHeading title="Jira Cloud" description="Connect your account and select the projects used by Current Work." /><Card><SectionTitle icon={<ShieldCheck size={20} aria-hidden="true" />}>Account connection</SectionTitle><div className="flex flex-col gap-3">
            <Field label="Jira Domain URL"><Input className="font-mono" placeholder="company.atlassian.net" value={jiraUrl} onChange={(e) => { setJiraUrl(e.target.value); markUnsaved(); }} /></Field>
            <Field label="Jira User Email"><Input type="email" className="font-mono" placeholder="developer@company.com" value={jiraEmail} onChange={(e) => { setJiraEmail(e.target.value); markUnsaved(); }} /></Field>
            <Field label="Jira API Token" hint={data?.settings?.hasJiraApiToken ? 'A token is already configured. Leave this blank to keep it.' : undefined}><div className="relative"><Input type={showJiraToken ? 'text' : 'password'} className="pr-12 font-mono" placeholder="ATATT3xFfGF0..." value={jiraApiToken} onChange={(e) => { setJiraApiToken(e.target.value); markUnsaved(); }} /><IconButton className="absolute top-0 right-0" variant="ghost" aria-label={showJiraToken ? 'Hide Jira token' : 'Show Jira token'} onClick={() => setShowJiraToken(!showJiraToken)}>{showJiraToken ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div></Field>
            <div className="mt-2"><Button onClick={handleTestJira} disabled={testingJira || loadingJiraProjects}><Zap size={16} aria-hidden="true" />{testingJira || loadingJiraProjects ? 'Loading Jira Projects...' : 'Test & Load Jira Projects'}</Button></div>
            <div><p className="mb-1 text-sm font-medium">Jira projects shown on the board</p><p className="mb-2 text-pretty text-xs text-muted-foreground">Use projects as team workspaces. Leave all unchecked to show every ticket assigned to you.</p>{jiraProjectsData?.jiraProjects?.length > 0 ? <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded-md border border-border p-3">{jiraProjectsData.jiraProjects.map((project: any) => { const selected = selectedJiraProjects.includes(project.key); return <label key={project.id} className={cn('flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5', selected && 'bg-accent-dim')}><Checkbox checked={selected} onChange={() => handleToggleJiraProject(project.key)} /><strong className="font-mono text-xs">{project.key}</strong><span className="text-xs text-secondary-foreground">{project.name}</span></label>; })}</div> : selectedJiraProjects.length > 0 ? <div className="font-mono text-xs text-muted-foreground">Saved selection: {selectedJiraProjects.join(', ')}</div> : null}</div>
          </div></Card></section>}

          {activeSection === 'github' && <section><SettingsHeading title="GitHub" description="Manage the repositories included in DOCK monitoring." /><Card><SectionTitle icon={<GitBranch size={20} aria-hidden="true" />}>Repository access</SectionTitle><div className="flex flex-col gap-3">
            <Field label="Personal Access Token (PAT)" hint={data?.settings?.hasGithubToken ? 'A token is already configured. Leave this blank to keep it.' : undefined}><div className="relative"><Input type={showGithubToken ? 'text' : 'password'} className="pr-12 font-mono" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" value={githubToken} onChange={(e) => { setGithubToken(e.target.value); markUnsaved(); }} /><IconButton className="absolute top-0 right-0" variant="ghost" aria-label={showGithubToken ? 'Hide GitHub token' : 'Show GitHub token'} onClick={() => setShowGithubToken(!showGithubToken)}>{showGithubToken ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div></Field>
            <div><p className="mb-2 text-sm font-medium">Monitored Repositories</p>{selectedReposList.length === 0 ? <div className="rounded-sm border border-dashed border-border p-3 text-center font-mono text-xs text-muted-foreground">No repositories selected yet. Add a token to load repositories.</div> : <div className="flex flex-wrap gap-1.5">{selectedReposList.map(repo => <Badge variant="accent" className="gap-1.5" key={repo}>{repo}<button type="button" className="grid size-6 place-items-center rounded-sm text-base leading-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => handleToggleRepo(repo)} aria-label={`Remove ${repo}`}>×</button></Badge>)}</div>}</div>
            {(githubToken || reposData?.githubRepos) && <div className="max-h-[260px] overflow-y-auto rounded-md border border-border bg-surface-0 p-3"><Input aria-label="Filter GitHub repositories" className="mb-2 bg-background font-mono text-xs" placeholder="Filter by repository or organization..." value={repoSearch} onChange={(e) => setRepoSearch(e.target.value)} />{loadingRepos ? <div className="py-3 text-center text-xs text-muted-foreground">Fetching repositories...</div> : reposData?.githubRepos?.length > 0 ? <div className="flex flex-col gap-1">{reposData.githubRepos.filter((repo: any) => repo.fullName.toLowerCase().includes(repoSearch.toLowerCase())).map((repo: any) => { const selected = selectedReposList.includes(repo.fullName); return <label key={repo.id} className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-sm border px-2.5 py-1.5', selected ? 'border-accent/40 bg-accent-dim' : 'border-transparent')}><span className="flex min-w-0 items-center gap-2"><Checkbox checked={selected} onChange={() => handleToggleRepo(repo.fullName)} /><span className={cn('truncate font-mono text-xs', selected && 'text-accent')}>{repo.fullName}</span>{repo.private && <Badge>Private</Badge>}</span>{repo.description && <span className="max-w-[180px] truncate text-xs text-muted-foreground">{repo.description}</span>}</label>; })}</div> : <div className="py-3 text-center text-xs text-muted-foreground">No repositories found. Check the PAT scopes.</div>}</div>}
            <details className="mt-1"><summary className="cursor-pointer font-mono text-xs text-muted-foreground">Advanced: Manual comma-separated input</summary><Input aria-label="Manual monitored repositories" className="mt-1.5 font-mono text-xs" placeholder="myorg/frontend-app, myorg/backend-api" value={githubRepos} onChange={(e) => { setGithubRepos(e.target.value); markUnsaved(); }} /></details>
            <div className="mt-2"><Button onClick={handleTestGitHub} disabled={testingGitHub}><Zap size={16} aria-hidden="true" />{testingGitHub ? 'Testing Token...' : 'Test GitHub Token'}</Button></div>
          </div></Card></section>}

          {activeSection === 'calendar' && <section><SettingsHeading title="Google Calendar" description="Configure read-only calendar access and connection status." /><Card><SectionTitle icon={<CalendarDays size={20} className="text-accent" aria-hidden="true" />}>OAuth connection</SectionTitle><div className="flex flex-col gap-3"><p className="text-pretty text-sm text-secondary-foreground">Register <span className="font-mono">{window.location.origin}/auth/google/callback</span> as an authorized redirect URI in a Google OAuth Web application.</p>
            <Input aria-label="OAuth Client ID" className="font-mono" placeholder="OAuth Client ID" value={googleClientId} onChange={(event) => { setGoogleClientId(event.target.value); markUnsaved(); }} />
            <div className="relative"><Input aria-label="OAuth Client Secret" className="pr-12 font-mono" type={showGoogleSecret ? 'text' : 'password'} placeholder={data?.settings?.hasGoogleClientSecret ? 'Client secret saved — leave blank to retain' : 'OAuth Client Secret'} value={googleClientSecret} onChange={(event) => { setGoogleClientSecret(event.target.value); markUnsaved(); }} /><IconButton className="absolute top-0 right-0" variant="ghost" aria-label={showGoogleSecret ? 'Hide Google secret' : 'Show Google secret'} onClick={() => setShowGoogleSecret(!showGoogleSecret)}>{showGoogleSecret ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div>
            {!data?.settings?.hasGoogleClientSecret && <p className="rounded-sm border-l-[3px] border-status-conflict bg-surface-0 p-3 text-xs text-secondary-foreground">Enter and save the OAuth client secret before connecting Google Calendar.</p>}
            {data?.settings?.googleCalendarConnected && data?.settings?.googleCalendarError && <p role="alert" className="rounded-sm border-l-[3px] border-status-conflict bg-surface-0 p-3 text-xs text-secondary-foreground">{data.settings.googleCalendarError}</p>}
            <Input aria-label="Calendar ID" className="font-mono" placeholder="Calendar ID (default: primary)" value={googleCalendarId} onChange={(event) => { setGoogleCalendarId(event.target.value); markUnsaved(); }} />
            <div className="flex flex-wrap items-center gap-3"><Button variant="primary" onClick={handleConnectGoogle}><CalendarDays size={16} aria-hidden="true" />{data?.settings?.googleCalendarConnected ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</Button>{data?.settings?.googleCalendarConnected && <Button onClick={handleDisconnectGoogle} disabled={disconnectingGoogle}><Unplug size={16} aria-hidden="true" />{disconnectingGoogle ? 'Disconnecting...' : 'Disconnect'}</Button>}<Badge variant={data?.settings?.googleCalendarConnected ? 'success' : 'neutral'}>{data?.settings?.googleCalendarConnected ? 'Connected' : 'Not connected'}</Badge></div>
          </div></Card></section>}

          {activeSection === 'discord' && <section>
            <SettingsHeading title="Discord" description="Configure the webhook and default ticket-summary format." />
            <Card>
              <SectionTitle icon={<MessageSquare size={20} className="text-status-discord" aria-hidden="true" />}>Discord notifications</SectionTitle>
              <div className="flex flex-col gap-4">
                <Field label="Discord Webhook URL" hint={data?.settings?.hasDiscordWebhookUrl ? 'A webhook is already configured. Leave this blank to keep it.' : undefined}>
                  <div className="relative"><Input type={showDiscordWebhook ? 'text' : 'password'} className="pr-12 font-mono" placeholder="https://discord.com/api/webhooks/..." value={discordWebhookUrl} onChange={(e) => { setDiscordWebhookUrl(e.target.value); markUnsaved(); }} /><IconButton className="absolute top-0 right-0" variant="ghost" aria-label={showDiscordWebhook ? 'Hide Discord webhook' : 'Show Discord webhook'} onClick={() => setShowDiscordWebhook(!showDiscordWebhook)}>{showDiscordWebhook ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div>
                </Field>
                <Field label="Default message template" hint="Markdown is supported. The ticket preview remains editable before sending. Any line holding a ticket field repeats once per ticket when the announcement covers a dependency group.">
                  <Textarea className="min-h-[230px] bg-surface-0 font-mono text-xs leading-5" value={discordMessageTemplate} maxLength={2000} aria-invalid={Boolean(discordTemplateError)} aria-describedby={discordTemplateError ? 'discord-template-error' : undefined} onChange={(event) => { setDiscordMessageTemplate(event.target.value); markUnsaved(); }} />
                </Field>
                {discordTemplateError && <p id="discord-template-error" className="text-pretty text-xs text-status-conflict" role="alert">{discordTemplateError}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-pretty text-xs text-muted-foreground">Available fields: <span className="font-mono text-secondary-foreground">{'{{ticketKey}} {{ticketTitle}} {{ticketUrl}} {{relatedTickets}} {{pullRequests}} {{demoUrl}}'}</span></p>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{discordMessageTemplate.length}/2000</span>
                </div>
                <section className="rounded-md border border-border bg-surface-0 p-4" aria-labelledby="discord-template-preview-title">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 id="discord-template-preview-title" className="text-balance font-display text-sm font-bold">Live template preview</h3>
                    <Badge variant="neutral">Sample ticket</Badge>
                  </div>
                  {discordTemplateError
                    ? <p className="text-pretty text-xs text-status-conflict">Fix the template error above to restore the preview.</p>
                    : <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-secondary-foreground" aria-live="polite">{discordTemplatePreview}</pre>}
                </section>
                <div className="flex flex-wrap gap-2"><Button onClick={() => { setDiscordMessageTemplate(DEFAULT_DISCORD_MESSAGE_TEMPLATE); markUnsaved(); }}>Restore default format</Button><Button onClick={handleTestDiscord} disabled={testingDiscord}><Zap size={16} aria-hidden="true" />{testingDiscord ? 'Testing Webhook...' : 'Test Discord Webhook'}</Button></div>
                <div className="rounded-sm border-l-[3px] border-status-discord bg-surface-0 p-3 text-[0.8125rem] text-secondary-foreground"><strong>Discord thread and forum posting:</strong> The ticket detail preview lets you send to an existing thread ID or create a new thread in a forum channel.</div>
              </div>
            </Card>
          </section>}

          {activeSection === 'agents' && <IngestTokensSection />}
        </main>
      </div>

      <div className={cn('fixed right-6 z-20 flex items-center gap-4 rounded-md border border-border-glow bg-surface-2 p-2 pl-4 shadow-card max-[760px]:right-[76px] max-[760px]:bottom-[86px] max-[760px]:left-2.5 max-[760px]:h-12 max-[760px]:justify-between max-[760px]:gap-2 max-[760px]:p-1.5 max-[760px]:pl-3', !hasUnsavedChanges && 'max-[760px]:hidden', navigationPreferences.mode === 'bottom' ? 'bottom-[max(6rem,calc(env(safe-area-inset-bottom)+6rem))]' : 'bottom-[max(1.5rem,env(safe-area-inset-bottom))]')}>
        <span className="text-xs text-muted-foreground max-[420px]:hidden">{hasUnsavedChanges ? 'Unsaved changes' : 'No unsaved changes'}</span>
        <Button variant="primary" className="h-11 px-5 max-[760px]:h-9 max-[760px]:flex-1 max-[760px]:px-3" onClick={() => handleSave()} disabled={!isRefreshIntervalValid || Boolean(discordTemplateError)}><Save size={17} aria-hidden="true" />Save &amp; Encrypt Settings</Button>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Page>
  );
};

export default SettingsPage;
