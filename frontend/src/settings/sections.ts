import { CalendarDays, Film, GitBranch, KeyRound, LayoutPanelLeft, Lock, MessageSquare, MessagesSquare, ShieldCheck, type LucideIcon } from 'lucide-react';
import { normalizeCaveman, normalizeRtk } from '../chat/chatDefaults';
import { hasPage, type DockMode } from '../lib/dockMode';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE, getDiscordTemplateError } from '../lib/discordTemplate';
import { isValidServiceHealthRefreshSeconds, normalizeServiceHealthRefreshSeconds } from '../lib/serviceHealthRefresh';

export type SectionId = 'general' | 'chat' | 'security' | 'jira' | 'github' | 'discord' | 'calendar' | 'tokens' | 'demo';
export type DraftSectionId = 'general' | 'chat' | 'jira' | 'github' | 'discord' | 'calendar';
export type SectionGroup = 'Preferences' | 'Integrations' | 'Agents';
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
  githubRepos?: string | null;
  googleClientId?: string | null;
  googleCalendarId?: string | null;
  hasJiraApiToken?: boolean | null;
  hasGithubToken?: boolean | null;
  hasDiscordWebhookUrl?: boolean | null;
  discordMessageTemplate?: string | null;
  hasDiscordBotToken?: boolean | null;
  discordGuildId?: string | null;
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
}

export const SECTION_GROUPS: SectionGroup[] = ['Preferences', 'Integrations', 'Agents'];

export const SETTINGS_SECTIONS: SectionInfo[] = [
  { id: 'general', label: 'General', title: 'General', description: 'How DOCK looks on this device, and how often live data refreshes.', icon: LayoutPanelLeft, group: 'Preferences' },
  { id: 'chat', label: 'Chat', title: 'Chat', description: 'Defaults for a chat turn that sets no value of its own.', icon: MessagesSquare, group: 'Preferences' },
  { id: 'security', label: 'Security', title: 'Security', description: 'A fallback PIN for access that does not come through Tailscale. Every action here saves immediately.', icon: Lock, group: 'Preferences' },
  { id: 'jira', label: 'Jira', title: 'Jira Cloud', description: 'The account DOCK reads tickets with, and the projects on the board.', icon: ShieldCheck, group: 'Integrations' },
  { id: 'github', label: 'GitHub', title: 'GitHub', description: 'The token DOCK reads pull requests with, and the repositories it watches.', icon: GitBranch, group: 'Integrations' },
  { id: 'discord', label: 'Discord', title: 'Discord', description: 'Where ticket summaries are posted, and how they read.', icon: MessageSquare, group: 'Integrations' },
  { id: 'calendar', label: 'Calendar', title: 'Google Calendar', description: 'Read-only access for the Calendar page.', icon: CalendarDays, group: 'Integrations' },
  { id: 'tokens', label: 'Ingest tokens', title: 'Ingest tokens', description: "What lets a machine's kit report to DOCK. Every action here saves immediately.", icon: KeyRound, group: 'Agents' },
  { id: 'demo', label: 'Demo videos', title: 'Demo videos', description: 'The narration keys and the bucket a demo video goes to, shared by both DOCKs. Every action here saves immediately.', icon: Film, group: 'Agents' },
];

export const DRAFT_SECTIONS: DraftSectionId[] = ['general', 'chat', 'jira', 'github', 'discord', 'calendar'];

export const isDraftSection = (id: SectionId): id is DraftSectionId => (DRAFT_SECTIONS as SectionId[]).includes(id);

/** A section shows only when its page does: a workspace DOCK has no calendar to connect. */
export const visibleSections = (mode: DockMode) => SETTINGS_SECTIONS.filter((section) => (
  (section.id !== 'chat' || hasPage(mode, '/sessions')) && (section.id !== 'calendar' || hasPage(mode, '/calendar'))
));

/** `?section=` picks the section; the Google OAuth redirect (`?google=`) lands on Calendar. */
export function sectionFromSearch(search: string, visible: SectionInfo[]): SectionId {
  const params = new URLSearchParams(search);
  const wanted = params.get('google') ? 'calendar' : params.get('section');
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
    },
    jira: { jiraUrl: settings.jiraUrl || '', jiraEmail: settings.jiraEmail || '', jiraApiToken: '', jiraProjectKeys: settings.jiraProjectKeys || '' },
    github: { githubToken: '', githubRepos: settings.githubRepos || '' },
    discord: {
      discordWebhookUrl: '',
      discordMessageTemplate: settings.discordMessageTemplate || DEFAULT_DISCORD_MESSAGE_TEMPLATE,
      discordBotToken: '',
      discordGuildId: settings.discordGuildId || '',
    },
    calendar: { googleClientId: settings.googleClientId || '', googleClientSecret: '', googleCalendarId: settings.googleCalendarId || 'primary' },
  };
}

export const changedKeys = (saved: SectionValues, draft: SectionValues) => Object.keys(saved).filter((key) => draft[key] !== saved[key]);

export const healthSeconds = (values: SectionValues) => Number(values.healthValue) * (values.healthUnit === 'minutes' ? 60 : 1);

/** Errors that stop this section's save; another section's errors never do. */
export function sectionErrors(id: DraftSectionId, values: SectionValues): string[] {
  if (id === 'general') return isValidServiceHealthRefreshSeconds(healthSeconds(values)) ? [] : ['Enter a whole-number interval between 5 seconds and 24 hours.'];
  if (id === 'discord') {
    const error = getDiscordTemplateError(values.discordMessageTemplate);
    return error ? [error] : [];
  }
  return [];
}

/** The updateSettings input of one section: only its own keys, so a save never touches another section. */
export function sectionInput(id: DraftSectionId, values: SectionValues): Record<string, string | number> {
  if (id === 'general') return { serviceHealthRefreshSeconds: healthSeconds(values) };
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
  if (id === 'demo') return extra.demoStorage ? 'ok' : 'off';
  return null;
}
