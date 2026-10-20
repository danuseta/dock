import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_DEMO_STORAGE, GET_INGEST_TOKENS, GET_SETTINGS } from '../graphql/queries';
import { UPDATE_SETTINGS } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { IngestTokensSection } from '../components/IngestTokensSection';
import { ElevenLabsKeysSection } from '../components/ElevenLabsKeysSection';
import { DemoStorageSection } from '../components/DemoStorageSection';
import { ChatDefaultsSection } from '../components/ChatDefaultsSection';
import { normalizeCaveman, normalizeRtk } from '../chat/chatDefaults';
import { Card, Page, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { useDockMode } from '../lib/dockMode';
import { NAVIGATION_PREFERENCES_EVENT, readNavigationPreferences, type NavigationPreferences } from '../lib/navigationPreferences';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import {
  SECTION_GROUPS, changedKeys, isDraftSection, savedValues, sectionErrors, sectionFromSearch, sectionInput, sectionStatus, visibleSections,
  type DraftSectionId, type SavedSettings, type SectionId, type SectionStatus, type SectionValues, type TestResult, type TestedSection,
} from '../settings/sections';
import { SaveBar, type SaveOutcome } from '../settings/SettingsParts';
import { GeneralSection } from '../settings/sections/GeneralSection';
import { SecuritySection } from '../settings/sections/SecuritySection';
import { JiraSection } from '../settings/sections/JiraSection';
import { GitHubSection } from '../settings/sections/GitHubSection';
import { DiscordSection } from '../settings/sections/DiscordSection';
import { CalendarSection, type GoogleReturn } from '../settings/sections/CalendarSection';

const dotClass: Record<Exclude<SectionStatus, null>, string> = {
  ok: 'bg-status-merged', bad: 'bg-status-conflict', off: 'border border-muted-foreground', unsaved: 'bg-status-warn',
};

const dotText: Record<Exclude<SectionStatus, null>, string> = {
  ok: 'connected', bad: 'needs attention', off: 'not set', unsaved: 'unsaved changes',
};

const readGoogleReturn = (): GoogleReturn | null => {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('google');
  return result ? { result, reason: params.get('reason') } : null;
};

/** The shell: the rail, the open section from `?section=`, and one draft per section that has a save bar. */
const SettingsPage: React.FC = () => {
  const mode = useDockMode();
  const sections = visibleSections(mode);
  const [active, setActive] = useState<SectionId>(() => sectionFromSearch(window.location.search, sections));
  const [googleReturn] = useState(readGoogleReturn);
  const [drafts, setDrafts] = useState<Partial<Record<DraftSectionId, SectionValues>>>({});
  const [saving, setSaving] = useState<DraftSectionId | null>(null);
  const [outcome, setOutcome] = useState<{ section: DraftSectionId; result: SaveOutcome } | null>(null);
  const [tests, setTests] = useState<Partial<Record<TestedSection, TestResult>>>({});
  const [navigationMode, setNavigationMode] = useState(() => readNavigationPreferences().mode);
  const { data, loading, error, refetch } = useQuery(GET_SETTINGS, CACHED_QUERY_OPTIONS);
  const { data: tokenData } = useQuery(GET_INGEST_TOKENS, CACHED_QUERY_OPTIONS);
  const { data: storageData } = useQuery(GET_DEMO_STORAGE, CACHED_QUERY_OPTIONS);
  const [updateSettings] = useMutation(UPDATE_SETTINGS);

  const settings: SavedSettings = data?.settings ?? {};
  const saved = useMemo(() => savedValues(data?.settings ?? {}), [data]);
  const valuesOf = (id: DraftSectionId) => drafts[id] ?? saved[id];
  const changesOf = (id: SectionId) => (isDraftSection(id) ? changedKeys(saved[id], valuesOf(id)).length : 0);
  const dirtySections = sections.filter((section) => changesOf(section.id) > 0);

  const save = async (id: DraftSectionId) => {
    const values = valuesOf(id);
    if (!changedKeys(saved[id], values).length || sectionErrors(id, values).length || saving) return;
    setSaving(id);
    setOutcome(null);
    try {
      const result = await updateSettings({ variables: { input: sectionInput(id, values) } });
      if (result.data?.updateSettings !== true) {
        setOutcome({ section: id, result: { ok: false, message: 'Not saved. Unlock DOCK and check the connection, then try again.' } });
        return;
      }
      await refetch();
      setDrafts((current) => { const next = { ...current }; delete next[id]; return next; });
      setTests((current) => { const next = { ...current }; delete next[id as TestedSection]; return next; });
      setOutcome({ section: id, result: { ok: true, message: 'Saved. Blank secrets kept their saved value.' } });
    } catch {
      setOutcome({ section: id, result: { ok: false, message: 'Not saved. Check the connection, then try again.' } });
    } finally {
      setSaving(null);
    }
  };

  const saveActive = useRef<() => void>(() => undefined);
  useEffect(() => {
    saveActive.current = () => { if (isDraftSection(active)) void save(active); };
  });

  useEffect(() => {
    window.history.replaceState(window.history.state, '', `/settings?section=${active}`);
  }, [active]);

  useEffect(() => {
    const handleChange = (event: Event) => setNavigationMode((event as CustomEvent<NavigationPreferences>).detail.mode);
    window.addEventListener(NAVIGATION_PREFERENCES_EVENT, handleChange);
    return () => window.removeEventListener(NAVIGATION_PREFERENCES_EVENT, handleChange);
  }, []);

  const anyDirty = dirtySections.length > 0;
  useEffect(() => {
    if (!anyDirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveActive.current();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (!outcome?.result?.ok) return undefined;
    const timer = setTimeout(() => setOutcome(null), 4000);
    return () => clearTimeout(timer);
  }, [outcome]);

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;
  if (error && !data) return <Page width="full"><Card className="border-status-conflict text-status-conflict" role="alert">Error: {error.message}</Card></Page>;

  const setFields = (id: DraftSectionId, patch: SectionValues) => {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? saved[id]), ...patch } }));
    if (outcome?.section === id) setOutcome(null);
  };
  const setter = (id: DraftSectionId) => (key: string, value: string) => setFields(id, { [key]: value });
  const tested = (id: TestedSection) => (result: TestResult) => setTests((current) => ({ ...current, [id]: result }));
  const statusOf = (id: SectionId) => sectionStatus(id, settings, { dirty: changesOf(id) > 0, tests, demoStorage: Boolean(storageData?.demoStorage?.configured) });
  const sideText = (id: SectionId) => (id === 'security' ? (settings.hasMasterPin ? 'PIN on' : 'PIN off') : id === 'tokens' ? String(tokenData?.ingestTokens?.length ?? 0) : null);
  const info = sections.find((section) => section.id === active) ?? sections[0];
  const chat = valuesOf('chat');

  return (
    <Page width="full" className="pb-28">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-1 text-xs font-semibold text-muted-foreground">SYSTEM</p><h1 className="text-balance font-display text-3xl font-bold">Settings</h1></div>
        <p className={cn('text-xs', anyDirty ? 'text-status-warn' : 'text-muted-foreground')} role="status">{anyDirty ? `Unsaved: ${dirtySections.map((section) => section.label).join(', ')}` : 'All changes saved'}</p>
      </header>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-7 max-[760px]:grid-cols-1">
        <div className="hidden max-[760px]:block">
          <Select aria-label="Settings section" value={active} onValueChange={(value) => setActive(value as SectionId)} options={sections.map((section) => ({ value: section.id, label: `${section.group} · ${section.label}${changesOf(section.id) ? ' · unsaved' : ''}` }))} />
        </div>
        <aside className="sticky top-6 min-w-0 max-[760px]:hidden" aria-label="Settings sections">
          {SECTION_GROUPS.map((group) => {
            const items = sections.filter((section) => section.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="mb-4">
                <p className="mb-2 px-2 text-[0.6875rem] font-semibold text-muted-foreground">{group.toUpperCase()}</p>
                <nav className="flex flex-col gap-1" aria-label={`${group} settings`}>
                  {items.map((section) => {
                    const Icon = section.icon;
                    const on = active === section.id;
                    const status = statusOf(section.id);
                    const side = sideText(section.id);
                    return (
                      <button key={section.id} type="button" onClick={() => setActive(section.id)} aria-current={on ? 'page' : undefined} className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-sm border px-2.5 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60', on ? 'border-border bg-surface-2 text-foreground' : 'border-transparent text-secondary-foreground hover:bg-surface-1 hover:text-foreground')}>
                        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-1"><Icon size={16} aria-hidden="true" /></span>
                        <strong className="flex-1 font-display text-sm">{section.label}</strong>
                        {side && <small className="font-mono text-[0.6875rem] text-muted-foreground">{side}</small>}
                        {status && <span className={cn('size-2 shrink-0 rounded-full', dotClass[status])} title={dotText[status]} aria-hidden="true" />}
                        {status && <span className="sr-only">, {dotText[status]}</span>}
                      </button>
                    );
                  })}
                </nav>
              </div>
            );
          })}
        </aside>

        <main className="min-w-0 max-w-[920px]">
          <header className="mb-5"><h2 className="text-balance font-display text-2xl font-bold">{info.title}</h2><p className="mt-1 text-pretty text-sm text-secondary-foreground">{info.description}</p></header>
          {active === 'general' && <GeneralSection values={valuesOf('general')} set={setter('general')} />}
          {active === 'chat' && (
            <ChatDefaultsSection
              value={{ model: chat.chatDefaultModel, effort: chat.chatDefaultEffort, mode: chat.chatDefaultMode, rtk: normalizeRtk(chat.chatRtk), caveman: normalizeCaveman(chat.chatCaveman) }}
              onChange={(next) => setFields('chat', { chatDefaultModel: next.model, chatDefaultEffort: next.effort, chatDefaultMode: next.mode, chatRtk: next.rtk, chatCaveman: next.caveman })}
            />
          )}
          {active === 'security' && <SecuritySection hasPin={Boolean(settings.hasMasterPin)} />}
          {active === 'jira' && <JiraSection values={valuesOf('jira')} set={setter('jira')} settings={settings} test={tests.jira} onTested={tested('jira')} />}
          {active === 'github' && <GitHubSection values={valuesOf('github')} set={setter('github')} settings={settings} test={tests.github} onTested={tested('github')} />}
          {active === 'discord' && <DiscordSection values={valuesOf('discord')} set={setter('discord')} settings={settings} test={tests.discord} onTested={tested('discord')} />}
          {active === 'calendar' && <CalendarSection values={valuesOf('calendar')} set={setter('calendar')} settings={settings} dirty={changesOf('calendar') > 0} googleReturn={googleReturn} />}
          {active === 'tokens' && <IngestTokensSection />}
          {active === 'demo' && <div className="flex flex-col gap-5"><ElevenLabsKeysSection /><DemoStorageSection /></div>}
        </main>
      </div>

      {isDraftSection(active) && (
        <SaveBar
          section={info.label}
          changes={changesOf(active)}
          errors={sectionErrors(active, valuesOf(active))}
          saving={saving === active}
          outcome={outcome?.section === active ? outcome.result : null}
          navigationMode={navigationMode}
          onSave={() => void save(active)}
          onDiscard={() => setDrafts((current) => { const next = { ...current }; delete next[active]; return next; })}
        />
      )}
    </Page>
  );
};

export default SettingsPage;
