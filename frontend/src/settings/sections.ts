import { Bell, CalendarDays, Gavel, GitBranch, LayoutPanelLeft, Lock, MessageSquare, Mail, MessagesSquare, Monitor, Plug, Route, ScanSearch, ShieldCheck, Users, Workflow, type LucideIcon } from 'lucide-react';
import { normalizeCaveman, normalizeRtk } from '../chat/chatDefaults';
import { hasPage, type DockMode } from '../lib/dockMode';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE, getDiscordTemplateError } from '../lib/discordTemplate';
import { parseNotificationPrefs, prefsToValues, valuesToPrefs } from '../lib/notificationPrefs';
import { isValidServiceHealthRefreshSeconds, normalizeServiceHealthRefreshSeconds } from '../lib/serviceHealthRefresh';

export type SectionId = 'general' | 'chat' | 'notifications' | 'security' | 'jira' | 'github' | 'discord' | 'calendar' | 'machines' | 'claude' | 'review' | 'planflow' | 'sousflow' | 'judge' | 'messages' | 'plugins';
export type DraftSectionId = 'general' | 'chat' | 'notifications' | 'jira' | 'github' | 'discord' | 'calendar' | 'review' | 'messages' | 'plugins';
export type SectionGroup = 'You' | 'Connections' | 'Automation' | 'Messages & plugins';
export type SectionValues = Record<string, string>;
export type SectionStatus = 'ok' | 'bad' | 'off' | 'unsaved' | null;
export type TestedSection = 'jira' | 'github' | 'discord';
export interface TestResult { ok: boolean; message: string }

export interface SectionInfo {
  id: SectionId;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  group: SectionGroup;
}

/** The fields of GET_SETTINGS the page reads. */
export interface SavedSettings {
  jiraUrl?: string | null;
  jiraEmail?: string | null;
  jiraProjectKeys?: string | null;
  planningConfluenceParent?: string | null;
  planningPlanner?: string | null;
  githubRepos?: string | null;
  googleClientId?: string | null;
  googleCalendarId?: string | null;
  hasJiraApiToken?: boolean | null;
  hasGithubToken?: boolean | null;
  hasDiscordWebhookUrl?: boolean | null;
  discordMessageTemplate?: string | null;
  hasDiscordBotToken?: boolean | null;
  discordManagedToken?: boolean | null;
  discordManagedGuild?: string | null;
  discordTeamChannels?: number | null;
  discordGuildId?: string | null;
  discordUserId?: string | null;
  autoReviewOnIt?: boolean | null;
  autoLgtm?: boolean | null;
  reviewFindingsToTask?: boolean | null;
  hasGoogleClientSecret?: boolean | null;
  googleCalendarConnected?: boolean | null;
  googleCalendarError?: string | null;
  serviceHealthRefreshSeconds?: number | null;
  hasMasterPin?: boolean | null;
  chatDefaultModel?: string | null;
  chatDefaultEffort?: string | null;
  chatDefaultMode?: string | null;
  chatRtk?: string | null;
  chatCaveman?: string | null;
  chatParallelTurns?: string | null;
  ownerReplySession?: string | null;
  notificationPrefs?: string | null;
  storagePlugin?: string | null;
  voicePlugin?: string | null;
  storageLocalDir?: string | null;
}

export const SECTION_GROUPS: SectionGroup[] = ['You', 'Connections', 'Automation', 'Messages & plugins'];

const LEGACY_SECTION_IDS: Record<string, SectionId> = { demo: 'plugins', tokens: 'machines' };

export const SETTINGS_SECTIONS: SectionInfo[] = [
  { id: 'general', label: 'General', title: 'General', description: 'How DOCK looks on this device, and how often live data refreshes.', icon: LayoutPanelLeft, group: 'You' },
  { id: 'chat', label: 'Chat', title: 'Chat', description: 'Defaults for a chat turn that sets no value of its own.', icon: MessagesSquare, group: 'You' },
  { id: 'notifications', label: 'Notifications', title: 'Notifications', description: 'Which events make a sound and a notification, how loud, and with which sound. Shared by every device.', icon: Bell, group: 'You' },
  { id: 'security', label: 'Security', title: 'Security', description: 'A fallback PIN for access that does not come through Tailscale.', icon: Lock, group: 'You' },
  { id: 'claude', label: 'Claude account', title: 'Claude account', description: "Which Claude account this workspace's chat and cron turns use, and when to move to the next one.", icon: Users, group: 'You' },
  { id: 'jira', label: 'Jira', title: 'Jira Cloud', description: 'The account DOCK reads tickets with, and the projects on the board.', icon: ShieldCheck, group: 'Connections' },
  { id: 'github', label: 'GitHub', title: 'GitHub', description: 'The token DOCK reads pull requests with, and the repositories it watches.', icon: GitBranch, group: 'Connections' },
  { id: 'discord', label: 'Discord', title: 'Discord', description: 'The webhook and the bot DOCK reaches Discord with.', icon: MessageSquare, group: 'Connections' },
  { id: 'calendar', label: 'Calendar', title: 'Google Calendar', description: 'Read-only access for the Calendar page.', icon: CalendarDays, group: 'Connections' },
  { id: 'machines', label: 'Machines', title: 'Machines', description: "What lets a machine's kit report to DOCK.", icon: Monitor, group: 'Connections' },
  { id: 'review', label: 'Review', title: 'Review', description: 'What DOCK does on its own when you say on it in a pr-review thread.', icon: ScanSearch, group: 'Automation' },
  { id: 'planflow', label: 'Planning flow', title: 'Planning flow', description: 'The planning stages from Jira to Publish: which run, who holds each, and which needs approval. Every action here saves immediately.', icon: Workflow, group: 'Automation' },
  { id: 'sousflow', label: 'Sous flow', title: 'Sous flow', description: 'The sous stages from picking the ticket to the Jira status: which run, and after each one whether sous goes on, asks first or stops. Every action here saves immediately.', icon: Route, group: 'Automation' },
  { id: 'judge', label: 'Judge', title: 'Judge', description: "The agent that reads the sprint's sessions for the retro: on or off (off by default), its Claude account, its windows and when a day's answer is due.", icon: Gavel, group: 'Automation' },
  { id: 'messages', label: 'Discord messages', title: 'Discord messages', description: 'How the ticket summary DOCK posts to Discord reads.', icon: Mail, group: 'Messages & plugins' },
  { id: 'plugins', label: 'Plugins', title: 'Plugins', description: 'One choice per kind. An empty choice hides the feature that needs it instead of failing.', icon: Plug, group: 'Messages & plugins' },
];

const SECTION_FIELDS: Record<SectionId, string[]> = {
  general: ['Navigation layout', 'Start with a small sidebar', 'Service health refresh', 'Refresh every'],
  chat: ['Model', 'Effort', 'Mode', 'RTK', 'Caveman', 'Turns at once', 'Answers to sous'],
  notifications: ['Events', 'Volume', 'Sound'],
  security: ['PIN', 'Turn on PIN', 'Change PIN', 'Turn off PIN'],
  claude: ['Accounts', 'Switch account', 'Refresh usage'],
  jira: ['Domain URL', 'User email', 'API token', 'Projects on the board', 'Parent page id', 'Planner', 'Sprint contract'],
  github: ['Personal access token', 'Monitored repositories'],
  discord: ['Webhook URL', 'Bot token', 'Server id', 'Your Discord user id'],
  calendar: ['Client ID', 'Client secret', 'Calendar ID'],
  machines: ['Ingest tokens', 'Create token', 'Kit setup'],
  review: ['Review when I say on it', 'LGTM when the review is clean', 'Send review findings to the Task session'],
  planflow: ['Stages', 'Skip stage', 'Approval'],
  sousflow: ['Stages', 'Skip stage', 'After each stage'],
  judge: ['Judge on or off', 'Judge account', 'Idle minutes', 'Answer cutoff'],
  messages: ['Message template', 'Preview'],
  plugins: ['Storage', 'Voice', 'Harness', 'ElevenLabs keys', 'Demo storage', 'Bucket', 'Local folder'],
};

export const matchSections = (sections: SectionInfo[], query: string) => {
  const needle = query.trim().toLowerCase();
  return needle ? sections.filter((section) => [section.label, ...SECTION_FIELDS[section.id]].some((text) => text.toLowerCase().includes(needle))) : sections;
};

export const DRAFT_SECTIONS: DraftSectionId[] = ['general', 'chat', 'notifications', 'jira', 'github', 'discord', 'calendar', 'review', 'messages', 'plugins'];

export const isDraftSection = (id: SectionId): id is DraftSectionId => (DRAFT_SECTIONS as SectionId[]).includes(id);

/** A section shows only when its page does: a workspace DOCK has no calendar to connect. */
export const visibleSections = (mode: DockMode) => SETTINGS_SECTIONS.filter((section) => (
  (section.id !== 'chat' || hasPage(mode, '/sessions')) && (section.id !== 'calendar' || hasPage(mode, '/calendar')) && (section.id !== 'claude' || hasPage(mode, '/sessions')) && (section.id !== 'planflow' || hasPage(mode, '/planning')) && (section.id !== 'sousflow' || hasPage(mode, '/sessions')) && (section.id !== 'judge' || hasPage(mode, '/sessions'))
));

/** `?section=` picks the section; the Google OAuth redirect (`?google=`) lands on Calendar. */
export function sectionFromSearch(search: string, visible: SectionInfo[]): SectionId {
  const params = new URLSearchParams(search);
  const requested = params.get('section') ?? '';
  const wanted = params.get('google') ? 'calendar' : LEGACY_SECTION_IDS[requested] ?? requested;
  return visible.find((section) => section.id === wanted)?.id ?? 'general';
}

/** What each section's form starts from. Secrets are never sent to the browser, so their fields start blank. */
export function savedValues(settings: SavedSettings): Record<DraftSectionId, SectionValues> {
  const seconds = normalizeServiceHealthRefreshSeconds(settings.serviceHealthRefreshSeconds);
  const minutes = seconds % 60 === 0;
  return {
    general: { healthValue: String(minutes ? seconds / 60 : seconds), healthUnit: minutes ? 'minutes' : 'seconds' },
    chat: {
      chatDefaultModel: settings.chatDefaultModel || '',
      chatDefaultEffort: settings.chatDefaultEffort || '',
      chatDefaultMode: settings.chatDefaultMode || '',
      chatRtk: normalizeRtk(settings.chatRtk),
      chatCaveman: normalizeCaveman(settings.chatCaveman),
      chatParallelTurns: settings.chatParallelTurns || '',
      ownerReplySession: settings.ownerReplySession === 'last' ? 'last' : 'new',
    },
    notifications: prefsToValues(parseNotificationPrefs(settings.notificationPrefs)),
    jira: { jiraUrl: settings.jiraUrl || '', jiraEmail: settings.jiraEmail || '', jiraApiToken: '', jiraProjectKeys: settings.jiraProjectKeys || '', planningConfluenceParent: settings.planningConfluenceParent || '', planningPlanner: settings.planningPlanner || '' },
    github: { githubToken: '', githubRepos: settings.githubRepos || '' },
    discord: {
      discordWebhookUrl: '',
      discordBotToken: '',
      discordGuildId: settings.discordGuildId || '',
      discordUserId: settings.discordUserId || '',
    },
    review: {
      autoReviewOnIt: String(Boolean(settings.autoReviewOnIt)),
      autoLgtm: String(Boolean(settings.autoLgtm)),
      reviewFindingsToTask: String(settings.reviewFindingsToTask !== false),
    },
    messages: { discordMessageTemplate: settings.discordMessageTemplate || DEFAULT_DISCORD_MESSAGE_TEMPLATE },
    plugins: { storagePlugin: settings.storagePlugin || 'none', voicePlugin: settings.voicePlugin || 'none', storageLocalDir: settings.storageLocalDir || '' },
    calendar: { googleClientId: settings.googleClientId || '', googleClientSecret: '', googleCalendarId: settings.googleCalendarId || 'primary' },
  };
}

export const changedKeys = (saved: SectionValues, draft: SectionValues) => Object.keys(saved).filter((key) => draft[key] !== saved[key]);

export const healthSeconds = (values: SectionValues) => Number(values.healthValue) * (values.healthUnit === 'minutes' ? 60 : 1);

/** Errors that stop this section's save; another section's errors never do. */
export function sectionErrors(id: DraftSectionId, values: SectionValues): string[] {
  if (id === 'general') return isValidServiceHealthRefreshSeconds(healthSeconds(values)) ? [] : ['Enter a whole-number interval between 5 seconds and 24 hours.'];
  if (id === 'messages') {
    const error = getDiscordTemplateError(values.discordMessageTemplate);
    return error ? [error] : [];
  }
  if (id === 'discord') {
    const userId = values.discordUserId.trim();
    return userId && !/^\d{5,25}$/.test(userId) ? ['Your Discord user id is digits only.'] : [];
  }
  if (id === 'plugins') return values.storagePlugin === 'local' && !/^([a-zA-Z]:[\\/]|\/)/.test(values.storageLocalDir.trim()) ? ['The local folder is an absolute path.'] : [];
  return [];
}

/** The updateSettings input of one section: only its own keys, so a save never touches another section. */
export function sectionInput(id: DraftSectionId, values: SectionValues): Record<string, string | number> {
  if (id === 'general') return { serviceHealthRefreshSeconds: healthSeconds(values) };
  if (id === 'notifications') return { notificationPrefs: JSON.stringify(valuesToPrefs(values)) };
  return { ...values };
}

export const splitList = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean);

/** The rail dot, from saved data only: a value still being typed never turns a section green. */
export function sectionStatus(
  id: SectionId,
  settings: SavedSettings,
  extra: { dirty: boolean; tests: Partial<Record<TestedSection, TestResult>>; demoStorage: boolean },
): SectionStatus {
  if (extra.dirty) return 'unsaved';
  const failed = (extra.tests[id as TestedSection]?.ok) === false;
  if (id === 'jira') return failed ? 'bad' : settings.hasJiraApiToken && settings.jiraUrl && settings.jiraEmail ? 'ok' : 'off';
  if (id === 'github') return failed ? 'bad' : settings.hasGithubToken ? 'ok' : 'off';
  if (id === 'discord') return failed ? 'bad' : settings.hasDiscordWebhookUrl ? 'ok' : 'off';
  if (id === 'calendar') return settings.googleCalendarConnected ? (settings.googleCalendarError ? 'bad' : 'ok') : 'off';
  if (id === 'plugins') return extra.demoStorage ? 'ok' : 'off';
  return null;
}
