import React, { useEffect, useState } from 'react';
import { Activity, BarChart3, Bot, Box, Bug, CalendarDays, ClipboardList, ChevronLeft, ChevronRight, History, Home as HomeIcon, LayoutDashboard, ListChecks, MessagesSquare, MoreHorizontal, Settings as SettingsIcon, Clapperboard, Server, Stethoscope } from 'lucide-react';
import { useQuery } from '@apollo/client';
import { GET_DISCORD_THREADS, GET_NEEDS_ATTENTION, GET_OWNER_QUESTIONS } from '../graphql/queries';
import { ticketAttention, ticketQuestions } from '../lib/attention';
import { questionCount } from '../decisions/questions';
import { discordAttention, needsYou, type DiscordThread } from '../lib/discordThreads';
import { NAVIGATION_PREFERENCES_EVENT, NavigationPreferences, readNavigationPreferences, saveNavigationPreferences } from '../lib/navigationPreferences';
import { UPDATE_CHECK_MS, applyUpdate, checkForUpdate } from '../lib/appUpdate';
import { cn } from '../lib/cn';
import { PHONE_PRIMARY_PATHS, phoneMore } from '../lib/phoneNavigation';
import { useNotificationEvents } from '../lib/useNotificationEvents';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { ChatDock } from '../chat/ChatDock';
import { ReportDockIssue } from './ReportDockIssue';
import { IconButton } from './ui';
import { hasPage, showsChatDock, useDockMode } from '../lib/dockMode';
import { version as appVersion } from '../../package.json';

const appChannel = import.meta.env.VITE_APP_CHANNEL;
const appCommit = import.meta.env.VITE_APP_COMMIT;
const shortVersionLabel = `v${import.meta.env.VITE_APP_VERSION || appVersion}`;
const versionLabel = `${shortVersionLabel}${appChannel ? ` · ${appChannel}` : ''}`;
const versionTitle = appCommit ? `${versionLabel} (${appCommit})` : versionLabel;

// A phone tab: icon over a short label, 44 px tall.
const PHONE_TAB = 'max-[760px]:h-11 max-[760px]:w-[60px] max-[760px]:flex-col max-[760px]:gap-0.5 max-[760px]:text-[0.6875rem]';

interface AppLayoutProps { currentPath: string; onNavigate: (path: string) => void; unreachable: boolean; onRetry: () => void; children: React.ReactNode; }

export const AppLayout: React.FC<AppLayoutProps> = ({ currentPath, onNavigate, unreachable, onRetry, children }) => {
  const mode = useDockMode();
  const [preferences, setPreferences] = useState(readNavigationPreferences);
  const { data, loading: attentionLoading } = useQuery(GET_NEEDS_ATTENTION, { ...CACHED_QUERY_OPTIONS, pollInterval: 30000 });
  const { data: questionsData } = useQuery(GET_OWNER_QUESTIONS, { ...CACHED_QUERY_OPTIONS, pollInterval: 30000 });
  const decisionCount = questionCount(questionsData?.orchestrations ?? []);
  const { data: discordData, loading: discordLoading } = useQuery(GET_DISCORD_THREADS, { ...CACHED_QUERY_OPTIONS, pollInterval: 60000, skip: !hasPage(mode, '/discord') });
  const discordCount = (discordData?.discordThreads?.rows ?? []).filter((row: DiscordThread) => needsYou(row) && !row.older).length;
  useNotificationEvents(attentionLoading ? undefined : data?.needsAttention, discordLoading ? undefined : discordData?.discordThreads?.rows);
  const attentionCount = ticketAttention([...(data?.needsAttention ?? []), ...discordAttention(discordData?.discordThreads?.rows ?? [])], ticketQuestions(questionsData?.orchestrations ?? [])).length;
  const [moreOpen, setMoreOpen] = useState(false);
  const [updateOffered, setUpdateOffered] = useState(false);
  const [reporting, setReporting] = useState(false);

  // A phone keeps the app alive in the background for days, so a deploy is looked for each time it comes back,
  // and a tab that stays open on a desk looks again every minute.
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') void checkForUpdate().then(setUpdateOffered); };
    const timer = window.setInterval(check, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
    };
  }, []);

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => setPreferences((event as CustomEvent<NavigationPreferences>).detail);
    const handleStorage = () => setPreferences(readNavigationPreferences());
    window.addEventListener(NAVIGATION_PREFERENCES_EVENT, handlePreferenceChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(NAVIGATION_PREFERENCES_EVENT, handlePreferenceChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const navItems = [
    { path: '/', label: 'Home', icon: HomeIcon, badge: attentionCount, group: 'Work' },
    { path: '/dashboard', label: 'Board', icon: LayoutDashboard, badge: 0, group: 'Work' },
    { path: '/agents', label: 'Agents', icon: Bot, badge: 0, group: 'Work' },
    { path: '/blackboard', label: 'Blackboard', icon: ClipboardList, badge: 0, group: 'Work' },
    { path: '/sessions', label: 'Sessions', icon: History, badge: 0, group: 'Work' },
    { path: '/decisions', label: 'Decisions', icon: ListChecks, badge: decisionCount, group: 'Work' },
    { path: '/demo-videos', label: 'Demo Videos', icon: Clapperboard, badge: 0, group: 'Work' },
    { path: '/calendar', label: 'Calendar', icon: CalendarDays, badge: 0, group: 'Work' },
    { path: '/sprint', label: 'Sprint', icon: BarChart3, badge: 0, group: 'Team' },
    { path: '/discord', label: 'Discord', icon: MessagesSquare, badge: discordCount, group: 'Team' },
    { path: '/monitoring', label: 'Monitoring', icon: Activity, badge: 0, group: 'System' },
    { path: '/docker', label: 'Docker Services', icon: Box, badge: 0, group: 'System' },
    { path: '/dev-servers', label: 'Dev Servers', icon: Server, badge: 0, group: 'System' },
    // Not /health: the server answers that path itself for its health check.
    { path: '/machines', label: 'Health', icon: Stethoscope, badge: 0, group: 'System' },
    { path: '/issues', label: 'DOCK Issues', icon: Bug, badge: 0, group: 'System' },
    { path: '/settings', label: 'System Settings', icon: SettingsIcon, badge: 0, group: 'System' },
  ].filter((item) => hasPage(mode, item.path));

  // A phone has room for four destinations and a More button; the rest sit in the sheet that button opens.
  const more = phoneMore(navItems, currentPath);
  // The sidebar titles its groups; a group whose pages are all hidden in this mode is dropped with its title and divider.
  const navGroups = ['Work', 'Team', 'System'].map((title) => ({ title, items: navItems.filter((item) => item.group === title) })).filter((group) => group.items.length > 0);
  const go = (path: string) => { setMoreOpen(false); onNavigate(path); };

  const isSidebar = preferences.mode === 'left' || preferences.mode === 'right';
  const collapse = () => saveNavigationPreferences({ ...preferences, collapsed: !preferences.collapsed });
  const CollapseIcon = preferences.mode === 'right'
    ? (preferences.collapsed ? ChevronLeft : ChevronRight)
    : (preferences.collapsed ? ChevronRight : ChevronLeft);

  const renderNavItem = (item: (typeof navItems)[number]) => {
    const Icon = item.icon;
    const active = currentPath === item.path;
    const iconOnly = preferences.collapsed || !isSidebar;
    return (
      <button
        className={cn(
          'relative flex size-10 min-w-0 items-center justify-center gap-[11px] rounded-[7px] border border-transparent bg-transparent p-0 font-display text-[0.78rem] font-semibold text-secondary-foreground transition-colors duration-150 ease-out hover:border-border hover:bg-surface-1 hover:text-foreground',
          PHONE_TAB,
          !PHONE_PRIMARY_PATHS.includes(item.path) && 'max-[760px]:hidden',
          isSidebar && 'min-[761px]:h-auto min-[761px]:w-full min-[761px]:px-3 min-[761px]:py-[11px] min-[761px]:text-left',
          isSidebar && !preferences.collapsed && 'min-[761px]:justify-start',
          active && 'border-accent bg-accent text-black hover:border-accent hover:bg-accent hover:text-black',
        )}
        type="button"
        key={item.path}
        onClick={() => go(item.path)}
        aria-current={active ? 'page' : undefined}
        aria-label={iconOnly ? item.label : undefined}
        title={iconOnly ? item.label : undefined}
      >
        <Icon size={18} aria-hidden="true" />
        <span className={cn('hidden min-w-0 truncate max-[760px]:block', isSidebar && !preferences.collapsed && 'min-[761px]:inline')}>{item.label}</span>
        {item.badge > 0 && (
          <span className={cn(
            'absolute -right-[3px] -top-[3px] min-w-[18px] rounded-pill bg-status-conflict px-[5px] py-px text-center font-mono text-[0.6rem] font-extrabold text-black tabular-nums',
            isSidebar && !preferences.collapsed && 'min-[761px]:static min-[761px]:ml-auto',
          )}>{item.badge}</span>
        )}
      </button>
    );
  };

  const sidebarPixels = preferences.collapsed ? 72 : 248;
  const chatInset = {
    left: preferences.mode === 'left' ? sidebarPixels : 0,
    right: preferences.mode === 'right' ? sidebarPixels : 0,
    bottom: preferences.mode === 'bottom' ? 82 : 0,
  };
  const sidebarWidth = preferences.collapsed ? 'min-[761px]:w-[72px]' : 'min-[761px]:w-[248px]';
  const mainOffset = isSidebar
    ? preferences.mode === 'left'
      ? (preferences.collapsed ? 'min-[761px]:ml-[72px]' : 'min-[761px]:ml-[248px]')
      : (preferences.collapsed ? 'min-[761px]:mr-[72px]' : 'min-[761px]:mr-[248px]')
    : preferences.mode === 'top'
      ? 'min-[761px]:pt-[82px]'
      : 'min-[761px]:pb-[82px]';

  return (
    <div className="min-h-dvh bg-background">
      <aside
        className={cn(
          'fixed bottom-[max(10px,env(safe-area-inset-bottom))] left-1/2 z-40 flex h-[58px] w-max max-w-[calc(100vw-20px)] -translate-x-1/2 flex-row items-center gap-[7px] overflow-x-auto rounded-[14px] border border-border bg-surface-0 p-[7px_9px] shadow-card max-[760px]:w-[calc(100vw-20px)] max-[760px]:overflow-visible max-[760px]:px-1.5',
          isSidebar && [
            'min-[761px]:inset-y-0 min-[761px]:h-auto min-[761px]:max-w-none min-[761px]:translate-x-0 min-[761px]:flex-col min-[761px]:gap-0 min-[761px]:overflow-visible min-[761px]:rounded-none min-[761px]:px-3 min-[761px]:py-3',
            preferences.mode === 'left'
              ? 'min-[761px]:left-0 min-[761px]:right-auto min-[761px]:border-y-0 min-[761px]:border-l-0'
              : 'min-[761px]:right-0 min-[761px]:left-auto min-[761px]:border-y-0 min-[761px]:border-r-0',
            sidebarWidth,
          ],
          !isSidebar && [
            'min-[761px]:bottom-auto min-[761px]:h-[60px] min-[761px]:max-w-[calc(100vw-32px)] min-[761px]:gap-[9px] min-[761px]:p-[8px_10px]',
            preferences.mode === 'top'
              ? 'min-[761px]:top-[14px]'
              : 'min-[761px]:top-auto min-[761px]:bottom-[max(14px,env(safe-area-inset-bottom))]',
          ],
        )}
        aria-label="Primary navigation"
      >
        <button
          className={cn(
            'flex min-w-0 flex-none items-center gap-2.5 border-0 bg-transparent p-0 text-left text-foreground max-[760px]:hidden',
            isSidebar && 'min-[761px]:w-full min-[761px]:border-b min-[761px]:border-border min-[761px]:px-1.5 min-[761px]:pt-1 min-[761px]:pb-[15px]',
            isSidebar && preferences.collapsed && 'min-[761px]:justify-center min-[761px]:px-0',
          )}
          type="button"
          onClick={() => onNavigate('/')}
          aria-label="Go to Home"
        >
          <img className="size-8 flex-none rounded-sm border border-border object-cover min-[761px]:size-[30px]" src="/dock-logo.svg" alt="" />
          <span className={cn('hidden min-w-0', isSidebar && !preferences.collapsed && 'min-[761px]:block')}>
            <strong className="block font-display leading-none">DOCK</strong>
            <small className="mt-1 block whitespace-nowrap text-[0.61rem] text-muted-foreground">Personal command center</small>
          </span>
        </button>
        <nav aria-label="Primary" className={cn('flex flex-none items-center gap-1 max-[760px]:w-full max-[760px]:justify-around max-[760px]:gap-0', isSidebar && 'min-[761px]:w-full min-[761px]:flex-1 min-[761px]:flex-col min-[761px]:items-stretch min-[761px]:pt-3.5')}>
          {isSidebar ? navGroups.map((group, index) => (
            <div key={group.title} className={cn('max-[760px]:contents', index > 0 && (preferences.collapsed ? 'min-[761px]:mt-2 min-[761px]:border-t min-[761px]:border-border min-[761px]:pt-2' : 'min-[761px]:mt-4'))}>
              {!preferences.collapsed && <p className="mb-1 hidden px-3 font-mono text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground min-[761px]:block" aria-hidden="true">{group.title}</p>}
              <ul aria-label={group.title} className="m-0 flex list-none flex-col gap-1 p-0 max-[760px]:contents">
                {group.items.map((item) => <li key={item.path} className="max-[760px]:contents">{renderNavItem(item)}</li>)}
              </ul>
            </div>
          )) : navItems.map(renderNavItem)}
          <button
            className={cn(
              'relative flex items-center justify-center rounded-[7px] border border-transparent bg-transparent p-0 font-display font-semibold text-secondary-foreground min-[761px]:hidden',
              PHONE_TAB,
              (moreOpen || more.active) && 'border-accent bg-accent text-black',
            )}
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            aria-controls="phone-more"
          >
            <MoreHorizontal size={18} aria-hidden="true" />
            <span>More</span>
            {more.badge > 0 && <span className="absolute right-1 top-0 min-w-[18px] rounded-pill bg-status-conflict px-[5px] py-px text-center font-mono text-[0.6rem] font-extrabold text-black tabular-nums">{more.badge}</span>}
          </button>
        </nav>
        <IconButton variant="ghost" className="hidden size-8 min-[761px]:inline-flex" aria-label="Report bug" title="Report a DOCK bug (opens a GitHub issue on danuseta/dock)" onClick={() => setReporting(true)}><Bug size={16} aria-hidden="true" /></IconButton>
        <span className={cn(
          'hidden whitespace-nowrap font-mono text-[0.67rem] font-bold text-muted-foreground min-[761px]:block',
          isSidebar ? 'min-[761px]:w-full min-[761px]:border-t min-[761px]:border-border min-[761px]:px-2 min-[761px]:pt-[13px] min-[761px]:pb-0.5 min-[761px]:text-center' : 'min-[761px]:border-l min-[761px]:border-border min-[761px]:pl-2',
        )} title={versionTitle}>{isSidebar && preferences.collapsed ? shortVersionLabel : versionLabel}</span>
        {isSidebar && (
          <button
            type="button"
            className={cn(
              'absolute top-[84px] z-40 hidden size-7 place-items-center rounded-[7px] border border-border-glow bg-surface-1 text-secondary-foreground transition-colors duration-150 ease-out hover:text-foreground min-[761px]:grid',
              preferences.mode === 'left' ? '-right-3.5' : '-left-3.5',
            )}
            onClick={collapse}
            aria-label={preferences.collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            title={preferences.collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
          >
            <CollapseIcon size={15} aria-hidden="true" />
          </button>
        )}
      </aside>
      {moreOpen && (
        <div className="fixed inset-0 z-[39] min-[761px]:hidden">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close the menu" onClick={() => setMoreOpen(false)} />
          <nav id="phone-more" aria-label="More pages" className="absolute inset-x-0 bottom-0 rounded-t-[18px] border-t border-border-glow bg-surface-1 px-3 pt-3 pb-[calc(max(10px,env(safe-area-inset-bottom))+70px)]">
            <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-border-glow" aria-hidden="true" />
            {more.items.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.path} type="button" className={cn('flex h-12 w-full items-center gap-3 border-0 border-b border-border bg-transparent px-2.5 text-left font-display text-[0.92rem] font-semibold text-foreground last:border-b-0', currentPath === item.path && 'text-accent')} aria-current={currentPath === item.path ? 'page' : undefined} onClick={() => go(item.path)}>
                  <Icon size={19} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge > 0 && <span className="min-w-[20px] rounded-pill bg-status-conflict px-1.5 py-px text-center font-mono text-[0.66rem] font-extrabold text-black tabular-nums">{item.badge}</span>}
                </button>
              );
            })}
          </nav>
        </div>
      )}
      {/* On a phone the chat button floats above the navigation; the extra room lets the last row scroll clear of it. */}
      <main className={cn('min-h-dvh min-w-0 pb-[150px] min-[761px]:pb-0', mainOffset)}>
        {updateOffered && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border-glow bg-surface-1 px-4 py-2 text-center text-sm text-secondary-foreground" role="status">
            <span>A new version of DOCK is ready.</span>
            <button type="button" className="font-semibold text-accent underline underline-offset-2" onClick={() => applyUpdate()}>Update</button>
          </div>
        )}
        {unreachable && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-status-warn/40 bg-status-warn/10 px-4 py-2 text-center text-sm text-status-warn" role="status">
            <span>DOCK cannot be reached. This is what this device saw last.</span>
            <button type="button" className="font-semibold underline underline-offset-2" onClick={onRetry}>Try again</button>
          </div>
        )}
        {children}
      </main>
      <ReportDockIssue open={reporting} onClose={() => setReporting(false)} onNavigate={onNavigate} />
      {showsChatDock(mode, currentPath) && <ChatDock inset={chatInset} />}
    </div>
  );
};
