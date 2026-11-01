import React, { useCallback, useEffect, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { 
  AlertTriangle, 
  Search, 
  RefreshCw, 
  CheckCircle2,
  CircleDot,
  Clock,
  Bug,
  Rocket,
  ShieldCheck,
  FileCheck,
  Circle
} from 'lucide-react';
import { GET_DASHBOARD } from '../graphql/queries';
import { REFRESH_DATA } from '../graphql/mutations';
import { useTicketStore } from '../stores/useTicketStore';
import { TicketCard } from '../components/TicketCard';
import { TicketMenu, type TicketMenuTarget } from '../components/ticket/TicketMenu';
import { Toast } from '../components/Toast';
import { useOpenForTicket } from '../chat/useOpenForTicket';
import { nextWorkOrder } from '../lib/workOrder';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { KanbanScene } from '../components/empty/scenes/KanbanScene';
import { Button, Input, Page, PageHeader, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { isPhone } from '../lib/phone';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';

interface DashboardPageProps {
  onTicketClick: (key: string) => void;
}

const DashboardPage: React.FC<DashboardPageProps> = ({ onTicketClick }) => {
  const { activeFilter, setActiveFilter } = useTicketStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [sprintFilter, setSprintFilter] = useState<string>('CURRENT');
  const [menu, setMenu] = useState<TicketMenuTarget | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const { openForTicket, error: sessionError } = useOpenForTicket();
  useEffect(() => {
    if (sessionError) setToast({ message: sessionError, type: 'error' });
  }, [sessionError]);
  
  const { data, loading, error } = useQuery(GET_DASHBOARD, { 
    ...CACHED_QUERY_OPTIONS,
    pollInterval: 30000,
  });
  const [refreshData, { loading: refreshing }] = useMutation(REFRESH_DATA, {
    refetchQueries: [{ query: GET_DASHBOARD }]
  });

  if (error && !data) return (
    <Page width="full">
      <div className="rounded-md border border-status-conflict bg-status-conflict-bg p-6" role="alert">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle size={20} className="text-status-conflict" aria-hidden="true" />
          <h2 className="text-balance font-display text-status-conflict">Failed to load Jira board data</h2>
        </div>
        <p className="text-pretty font-mono text-secondary-foreground">{error.message}</p>
      </div>
    </Page>
  );

  if (isInitialQueryLoading(loading, data)) return (
    <Page width="full">
      <LoadingSkeleton />
    </Page>
  );

  const rawTickets = Array.isArray(data?.dashboard)
    ? data.dashboard.flatMap((group: any) => group.tickets || [])
    : data?.dashboard?.tickets || [];

  // Extract unique sprint names for Dropdown Selection in alphabetical order
  const availableSprints = (Array.from(new Set(
    rawTickets
      .map((t: any) => t.sprintName)
      .filter((name?: string) => name && name !== 'No Sprint' && name.trim() !== '')
  )) as string[]).sort();
  const hasCurrentSprint = rawTickets.some((ticket: any) => ticket.sprintState?.toUpperCase() === 'ACTIVE');
  const effectiveSprintFilter = sprintFilter === 'CURRENT' && !hasCurrentSprint ? 'ALL' : sprintFilter;
  const sprintOptions = [
    ...(hasCurrentSprint ? [{ value: 'CURRENT', label: 'Current Sprint' }] : []),
    { value: 'ALL', label: 'All Sprints' },
    ...availableSprints.map((sprintName) => ({ value: sprintName, label: sprintName })),
  ];

  // Filter tickets by current sprint, exact sprint name, or all sprints.
  const sprintFilteredTickets = rawTickets.filter((t: any) => {
    if (effectiveSprintFilter === 'ALL') return true;
    if (effectiveSprintFilter === 'CURRENT') return t.sprintState?.toUpperCase() === 'ACTIVE';
    return t.sprintName === effectiveSprintFilter;
  });

  // Canonical Status Order & Styling configuration
  const canonicalColumns = [
    { id: 'TODO', label: 'TODO', icon: Circle, header: 'bg-slate-400/10', tone: 'text-slate-400', badge: 'border-slate-400 text-slate-400' },
    { id: 'IN PROGRESS', label: 'IN PROGRESS', icon: Clock, header: 'bg-sky-400/10', tone: 'text-sky-400', badge: 'border-sky-400 text-sky-400' },
    { id: 'PR PREVIEW', label: 'PR PREVIEW', icon: CircleDot, header: 'bg-indigo-400/10', tone: 'text-indigo-400', badge: 'border-indigo-400 text-indigo-400' },
    { id: 'UAT MERGED', label: 'UAT MERGED', icon: CheckCircle2, header: 'bg-teal-400/10', tone: 'text-teal-400', badge: 'border-teal-400 text-teal-400' },
    { id: 'UAT CHECK', label: 'UAT CHECK', icon: ShieldCheck, header: 'bg-cyan-500/10', tone: 'text-cyan-500', badge: 'border-cyan-500 text-cyan-500' },
    { id: 'UAT/BUGG IMPROVEMENT', label: 'UAT/BUGG IMPROVEMENT', icon: Bug, header: 'bg-orange-400/10', tone: 'text-orange-400', badge: 'border-orange-400 text-orange-400' },
    { id: 'READY FOR PRODUCTION', label: 'READY FOR PRODUCTION', icon: Rocket, header: 'bg-violet-400/10', tone: 'text-violet-400', badge: 'border-violet-400 text-violet-400' },
    { id: 'DONE/MERGED', label: 'DONE/MERGED', icon: FileCheck, header: 'bg-green-400/10', tone: 'text-green-400', badge: 'border-green-400 text-green-400' },
  ];

  const filterTabs = ['ALL', ...canonicalColumns.map(c => c.id)];

  const getCanonicalColumnId = (ticketStatus: string): string => {
    const st = (ticketStatus || '').toUpperCase().trim();
    if (st === 'IN PROGRESS' || st === 'PR PREVIEW' || st === 'UAT MERGED' || st === 'UAT CHECK' || st === 'UAT/BUGG IMPROVEMENT' || st === 'READY FOR PRODUCTION' || st === 'DONE/MERGED') {
      return st;
    }
    if (st.includes('DONE') || st.includes('MERGED') || st.includes('CLOSED') || st === 'RESOLVED' || st === 'COMPLETE' || st.includes('FINISH')) return 'DONE/MERGED';
    if (st.includes('PRODUCTION') || st.includes('PROD') || st.includes('STAGING') || st === 'READY' || st.includes('RELEASE')) return 'READY FOR PRODUCTION';
    if (st.includes('BUG') || st.includes('IMPROVE') || st.includes('FIX') || st.includes('DEFECT') || st.includes('REOPEN')) return 'UAT/BUGG IMPROVEMENT';
    if (st === 'UAT CHECK' || st.includes('TESTING') || st.includes('QA') || st.includes('VERIFICATION') || st.includes('CHECK')) return 'UAT CHECK';
    if (st.includes('UAT')) return 'UAT MERGED';
    if (st.includes('REVIEW') || st.includes('PREVIEW') || st === 'CODE REVIEW' || st.includes('PULL REQUEST')) return 'PR PREVIEW';
    if (st.includes('PROGRESS') || st === 'WORKING' || st === 'ACTIVE' || st.includes('DEVELOP') || st.includes('DOING') || st.includes('DEV')) return 'IN PROGRESS';
    // Fallback to TODO for any unknown, backlog, or new statuses so NO ticket ever vanishes from the Kanban board!
    return 'TODO';
  };

  const matchesCanonicalStatus = (ticketStatus: string, filter: string) => {
    if (filter === 'ALL') return true;
    return getCanonicalColumnId(ticketStatus) === filter;
  };

  const getTabCount = (filter: string) => {
    return sprintFilteredTickets.filter((t: any) => {
      const matchesSearch = t.key.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (t.sprintName || '').toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCanonicalStatus(t.status, filter) && matchesSearch;
    }).length;
  };

  // Check if any ticket at all matches the active filters and search
  const totalMatchingTickets = sprintFilteredTickets.filter((t: any) => {
    const matchesFilter = matchesCanonicalStatus(t.status, activeFilter);
    const matchesSearch = t.key.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (t.sprintName || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  }).length;

  const menuTicket = menu ? rawTickets.find((ticket: any) => ticket.key === menu.key) : undefined;

  const columnsToRender = activeFilter === 'ALL' 
    ? canonicalColumns 
    : canonicalColumns.filter(c => c.id === activeFilter);

  return (
    <Page width="full">
      <PageHeader className="mb-4">
        <h1 className="text-balance font-display text-2xl font-black">Board</h1>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-3 max-[760px]:basis-full max-[760px]:justify-start">
          <div className="relative min-w-60 max-w-md flex-1 max-[760px]:min-w-full max-[760px]:max-w-none">
            <Input
              aria-label="Search Jira tickets"
              type="text" 
              placeholder={isPhone() ? 'Search key, title, sprint' : 'Search by Key, Title, or Sprint...'} 
              className="bg-surface-1 pl-[38px] font-mono"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 items-center text-muted-foreground">
              <Search size={16} aria-hidden="true" />
            </span>
          </div>

          <div className="w-56 shrink-0 max-[760px]:w-auto max-[760px]:min-w-0 max-[760px]:flex-1">
            <Select
              aria-label="Select sprint workload"
              className="bg-surface-1 font-display font-bold"
              value={effectiveSprintFilter}
              onValueChange={setSprintFilter}
              options={sprintOptions}
            />
          </div>

          <Button
            variant="primary"
            onClick={() => refreshData()} 
            disabled={refreshing}
            className="max-[760px]:size-11 max-[760px]:px-0"
          >
            <RefreshCw size={16} className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            <span className="max-[760px]:sr-only">{refreshing ? 'Syncing Jira...' : 'Sync Jira'}</span>
          </Button>
        </div>
      </PageHeader>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1 max-[760px]:snap-x max-[760px]:pr-8 max-[760px]:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
        {filterTabs.map((filter) => {
          const isActive = activeFilter.toUpperCase() === filter.toUpperCase();
          const count = getTabCount(filter);
          return (
            <Button
              key={filter}
              size="sm"
              variant={isActive ? 'primary' : 'default'}
              onClick={() => setActiveFilter(filter.toUpperCase())}
              className="shrink-0 rounded-pill max-[760px]:snap-start"
            >
              <span>{filter}</span>
              <span className={cn('ml-1.5 rounded-pill px-2 py-0.5 font-mono text-xs tabular-nums', isActive ? 'bg-black/20 text-black' : 'bg-surface-2 text-muted-foreground')}>
                {count}
              </span>
            </Button>
          );
        })}
      </div>

      {totalMatchingTickets === 0 ? (
        <div className="flex min-h-[380px] flex-col items-center justify-center rounded-md border border-border bg-surface-1 px-6 py-12">
          <EmptyState scene={<KanbanScene />} title="No tickets found" description={<span className="font-mono">Try adjusting your search query or sprint workload selection.</span>} />
        </div>
      ) : (
        <div className="flex min-h-[650px] w-full items-start gap-5 overflow-x-auto pb-6 max-[760px]:min-h-0 max-[760px]:flex-col max-[760px]:overflow-x-visible">
          {columnsToRender.map((column) => {
            const ColumnIcon = column.icon;
            const columnTickets = sprintFilteredTickets.filter((t: any) => {
              const matchesFilter = matchesCanonicalStatus(t.status, column.id);
              const matchesSearch = t.key.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                    t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                    (t.sprintName || '').toLowerCase().includes(searchTerm.toLowerCase());
              return matchesFilter && matchesSearch;
            });

            const isSingleColumnMode = activeFilter !== 'ALL';

            return (
              <div
                key={column.id}
                className={cn(
                  'flex max-h-[calc(100dvh-220px)] shrink-0 flex-col rounded-md border border-border bg-surface-1 shadow-md',
                  'max-[760px]:max-h-none max-[760px]:w-full max-[760px]:min-w-0',
                  isSingleColumnMode ? 'w-full min-w-full' : 'w-[280px] min-w-[280px]',
                  !isSingleColumnMode && columnTickets.length === 0 && 'max-[760px]:hidden',
                )}
              >
                <div className={cn('flex items-center justify-between rounded-t-md border-b border-border px-4 py-3.5', column.header)}>
                  <div className="flex items-center gap-2.5">
                    <ColumnIcon size={18} className={column.tone} aria-hidden="true" />
                    <span className="font-display text-sm font-extrabold">
                      {column.label}
                    </span>
                  </div>
                  <span className={cn('rounded-pill border bg-surface-0 px-2.5 py-0.5 font-mono text-[0.78rem] font-extrabold tabular-nums', column.badge)}>
                    {columnTickets.length}
                  </span>
                </div>

                <div className={cn('grid grow content-start gap-4 overflow-y-auto px-3.5 py-4', isSingleColumnMode ? 'grid-cols-[repeat(auto-fill,minmax(280px,1fr))]' : 'grid-cols-1')}>
                  {columnTickets.length === 0 ? (
                    <div className="rounded-sm border border-dashed border-border bg-white/[0.01] px-4 py-7 text-center font-mono text-[0.8rem] text-muted-foreground">
                      No tickets in {column.label.toLowerCase()}
                    </div>
                  ) : (
                    columnTickets.map((ticket: any) => (
                      <TicketCard 
                        key={ticket.key} 
                        ticket={ticket} 
                        menuOpen={menu?.key === ticket.key}
                        onClick={() => onTicketClick(ticket.key)} 
                        onMenu={(x, y, sheet) => setMenu({ key: ticket.key, x, y, sheet })}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {menuTicket && menu && (
        <TicketMenu
          target={menu}
          ticket={menuTicket}
          nextOrder={nextWorkOrder(rawTickets, menuTicket.key)}
          refetchQueries={['GetDashboard']}
          onOpen={() => onTicketClick(menuTicket.key)}
          onSession={() => void openForTicket(menuTicket.key)}
          onDone={(message, type) => setToast({ message, type })}
          onClose={closeMenu}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Page>
  );
};

export default DashboardPage;
