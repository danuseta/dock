import React, { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Plus, X } from 'lucide-react';
import { CREATE_CHAT_SESSION, DELETE_CHAT_SESSION, RENAME_CHAT_SESSION } from '../graphql/mutations';
import { GET_CHAT_MACHINES, GET_CHAT_SESSION, GET_CHAT_SESSIONS, SEARCH_CHAT } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { BubblesScene } from '../components/empty/scenes/BubblesScene';
import { SearchScene } from '../components/empty/scenes/SearchScene';
import { SkeletonScene } from '../components/empty/scenes/SkeletonScene';
import { Toast } from '../components/Toast';
import { Button, Card, Dialog, Input, Page } from '../components/ui';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { ChatThread } from '../chat/ChatThread';
import { LimitMeters } from '../chat/StatusLine';
import { useChatStatus } from '../chat/useChatStatus';
import { useFullViewport } from '../chat/useFullViewport';
import { SLOW_POLL_MS, machineOf, sessionTitle as titleOf, type ChatMachine, type ChatSession } from '../chat/messages';
import { SessionSidebar } from '../chat/SessionSidebar';
import { SessionRow } from '../chat/SessionRow';
import { useNow } from '../chat/activity/useNow';
import { SessionHeaderBar } from '../chat/SessionHeaderBar';
import { SessionInspector } from '../chat/SessionInspector';
import { sessionStats, type ChatActivity } from '../chat/activity/activity';
import { AgentLanes } from '../chat/activity/AgentLanes';
import { chatStore } from '../chat/store';
import { SESSIONS_PATH, sessionIdFromSearch, sessionUrl } from '../chat/sessionRoute';

interface SearchHit { session: ChatSession; messageId: number; snippet: string; at: string }

const WIDE_QUERY = '(min-width: 901px)';
const SEARCH_MIN = 2;
const TITLE_MAX = 120;

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

const SessionsPage: React.FC<{ onTicketClick?: (key: string) => void }> = ({ onTicketClick }) => {
  const { data, loading, error, refetch } = useQuery<{ chatSessions: ChatSession[] }>(GET_CHAT_SESSIONS, { ...CACHED_QUERY_OPTIONS, variables: { limit: 300 }, pollInterval: SLOW_POLL_MS });
  const [createSession, { loading: creating }] = useMutation<{ createChatSession: ChatSession }>(CREATE_CHAT_SESSION);
  const [deleteSession, { loading: deleting }] = useMutation(DELETE_CHAT_SESSION);
  const [renameSession, { loading: renaming }] = useMutation(RENAME_CHAT_SESSION);
  const [selectedId, setSelectedId] = useState<string | null>(() => sessionIdFromSearch(window.location.search));
  const [searchText, setSearchText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState('');
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [renameError, setRenameError] = useState('');
  const { status: liveStatus } = useChatStatus();
  const { data: machinesData } = useQuery<{ chatMachines: ChatMachine[] | null }>(GET_CHAT_MACHINES, { pollInterval: SLOW_POLL_MS });
  const [gone, setGone] = useState(false);
  const [events, setEvents] = useState<ChatActivity[]>([]);
  const [lanesOn, setLanesOn] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const closeGone = useCallback(() => setGone(false), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const searching = query.length >= SEARCH_MIN;
  const { data: searchData, loading: searchLoading, error: searchError } = useQuery<{ chatSearch: SearchHit[] }>(SEARCH_CHAT, {
    variables: { query, limit: 30 },
    skip: !searching,
    fetchPolicy: 'network-only',
  });

  const sessions = data?.chatSessions || [];
  const hits = searchData?.chatSearch || [];
  const listed = sessions.find((session) => session.id === selectedId) || hits.find((hit) => hit.session.id === selectedId)?.session || null;
  // A link to a session outside the list: ask for it, and leave for the list when DOCK no longer has it.
  const { data: lookup } = useQuery<{ chatSession: ChatSession | null }>(GET_CHAT_SESSION, {
    variables: { id: selectedId },
    skip: !selectedId || !data || Boolean(listed),
    fetchPolicy: 'network-only',
  });
  const selected = listed || lookup?.chatSession || null;
  useEffect(() => {
    if (!selectedId || listed || lookup?.chatSession !== null) return;
    window.history.replaceState({}, '', sessionUrl(null));
    setSelectedId(null);
    setGone(true);
  }, [selectedId, listed, lookup]);
  useEffect(() => {
    const handlePopState = () => {
      if (window.location.pathname === SESSIONS_PATH) setSelectedId(sessionIdFromSearch(window.location.search));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const select = (id: string | null) => {
    if (id !== sessionIdFromSearch(window.location.search)) window.history.pushState({}, '', sessionUrl(id));
    setSelectedId(id);
    setWorkerId(null);
    setActionError('');
    if (!window.matchMedia(WIDE_QUERY).matches) setInspectorOpen(false);
  };

  const selectWorker = (sessionId: string, id: string | null) => {
    if (sessionId !== selectedId) select(sessionId);
    setWorkerId(id);
  };

  const create = async (variables: { title?: string; ticketKey?: string | null; forkFrom?: string }) => {
    setActionError('');
    try {
      const result = await createSession({ variables });
      const created = result.data?.createChatSession;
      if (!created) throw new Error('DOCK did not return a session');
      await refetch();
      select(created.id);
    } catch (createError) {
      setActionError(errorText(createError, 'The session could not be created'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionError('');
    try {
      await deleteSession({ variables: { id: deleteTarget.id } });
      chatStore.closeTab(deleteTarget.id);
      setDeleteTarget(null);
      if (deleteTarget.id === selectedId) select(null);
      await refetch();
    } catch (deleteError) {
      setActionError(errorText(deleteError, 'The session could not be deleted'));
    }
  };

  const openRename = (session: ChatSession) => {
    setRenameError('');
    setTitleDraft(session.title);
    setRenameTarget(session);
  };

  const handleRename = async () => {
    const title = titleDraft.trim();
    if (!renameTarget || !title) return;
    setRenameError('');
    try {
      await renameSession({ variables: { id: renameTarget.id, title } });
      setRenameTarget(null);
    } catch (error) {
      setRenameError(errorText(error, 'The session could not be renamed'));
    }
  };

  useFullViewport(Boolean(selected), '(max-width: 900px)');
  const stats = sessionStats(events);
  const now = useNow(searching);
  const liveSession = liveStatus?.sessions.find((item) => item.sessionId === selectedId);
  const files = liveSession?.files ?? [];
  // Lanes earn their room only while two or more subagents run at once.
  const lanesReady = stats.runningAgents >= 2;
  const showLanes = lanesOn && lanesReady;

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const lanesToggle = lanesReady ? (
    <span className="inline-flex flex-none overflow-hidden whitespace-nowrap rounded-xs border border-border-glow font-mono text-[0.66rem] max-[900px]:hidden" role="group" aria-label="View">
      <button type="button" aria-pressed={!showLanes} className={cn('px-2 py-1', !showLanes ? 'bg-surface-hover font-bold text-foreground' : 'text-secondary-foreground hover:bg-surface-1')} onClick={() => setLanesOn(false)}>Chat</button>
      <button type="button" aria-pressed={showLanes} className={cn('px-2 py-1', showLanes ? 'bg-surface-hover font-bold text-foreground' : 'text-secondary-foreground hover:bg-surface-1')} onClick={() => setLanesOn(true)}>Swimlanes<span className="max-[1500px]:hidden"> · {stats.runningAgents} running</span></button>
    </span>
  ) : null;

  const message = (text: React.ReactNode, props: React.HTMLAttributes<HTMLParagraphElement> = {}) => <p className="px-3 py-6 text-center text-pretty text-sm text-muted-foreground" {...props}>{text}</p>;
  let results: React.ReactNode;
  if (searching && searchError) results = <p className="px-3 py-2 text-pretty text-xs text-status-conflict" role="alert">The search failed: {searchError.message}</p>;
  else if (searching && hits.length === 0) results = searchLoading ? message('Searching...', { role: 'status' }) : <EmptyState size="panel" scene={<SearchScene />} description={`No message contains "${query}".`} />;
  else if (searching) {
    results = (
      <div className="p-2" role="list" aria-label="Search results">
        {hits.map((hit) => (
          <div key={hit.messageId} role="listitem">
            <SessionRow session={hit.session} selected={hit.session.id === selectedId} now={now} snippet={hit.snippet} snippetAt={hit.at} onSelect={() => select(hit.session.id)} />
          </div>
        ))}
      </div>
    );
  } else if (sessions.length === 0) results = <EmptyState size="panel" scene={<SkeletonScene />} description={<>No session yet. Start one here, or run <span className="font-mono text-xs">node dock-push.cjs sessions</span> on the workspace to bring in the history.</>} />;

  return (
    <Page width="full">
      {error && !data && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">Sessions failed to load: {error.message}</Card>}

      <div className="grid h-[calc(100dvh-112px)] min-h-[420px] grid-cols-[290px_minmax(0,1fr)] items-stretch gap-4 max-[760px]:h-[calc(100dvh-96px-env(safe-area-inset-bottom))] max-[900px]:grid-cols-1">
        <Card className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-0 p-0', selected && 'max-[900px]:hidden')}>
          <div className="min-h-0 flex-1">
            <SessionSidebar
              sessions={sessions}
              live={liveStatus?.sessions ?? []}
              machines={machinesData?.chatMachines}
              activeId={selectedId}
              activeWorkerId={workerId}
              onSelect={select}
              onSelectWorker={selectWorker}
              onNew={() => void create({})}
              onRename={openRename}
              onDelete={(session) => { setActionError(''); setDeleteTarget(session); }}
              searchOpen={searchOpen}
              onToggleSearch={() => { if (searchOpen) setSearchText(''); setSearchOpen(!searchOpen); }}
              search={(
                <>
                  <Input className="h-9 text-[0.82rem] max-[900px]:h-11" type="search" value={searchText} placeholder="Search every message..." aria-label="Search messages" autoFocus onChange={(event) => setSearchText(event.target.value)} />
                  {searchText.trim().length === 1 && <p className="px-1 pt-2 text-xs text-muted-foreground">Type at least {SEARCH_MIN} characters to search.</p>}
                </>
              )}
              limits={<LimitMeters machine={selected ? machineOf(selected) : undefined} />}
              results={results}
            />
          </div>
        </Card>

        <Card className={cn('flex min-h-0 min-w-0 flex-col bg-surface-0 p-0', !selected && 'max-[900px]:hidden', selected && 'max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:top-[var(--vv-top,0px)] max-[900px]:z-[45] max-[900px]:h-[var(--vv-h,100dvh)] max-[900px]:min-h-0 max-[900px]:rounded-none max-[900px]:border-0')}>
          {!selected ? (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState
                scene={<BubblesScene />}
                title="Pick a session on the left"
                description="Select a session to read it."
                action={<Button size="sm" variant="primary" disabled={creating} onClick={() => void create({})}><Plus size={14} aria-hidden="true" />New session</Button>}
              />
            </div>
          ) : (
            <>
              {actionError && !deleteTarget && <p className="flex-none border-b border-border px-3.5 py-1.5 text-pretty text-xs break-words text-status-conflict" role="alert">{actionError}</p>}
              <div className="flex min-h-0 flex-1">
                <ChatThread
                  key={selected.id}
                  sessionId={selected.id}
                  className={cn('min-h-0 min-w-0 flex-1', showLanes && 'max-w-[44%]')}
                  hideMachine
                  workerId={workerId}
                  onSelectWorker={setWorkerId}
                  onActivity={setEvents}
                  renderHeader={({ control, dot, delayed, status }) => (
                    <SessionHeaderBar
                      session={selected}
                      dot={dot}
                      status={status}
                      delayed={delayed}
                      control={control}
                      inspectorOpen={inspectorOpen}
                      lanes={inspectorOpen ? null : lanesToggle}
                      onBack={() => select(null)}
                      onToggleInspector={() => setInspectorOpen((open) => !open)}
                    />
                  )}
                  readOnlyAction={<Button size="sm" variant="primary" disabled={creating} onClick={() => void create({ forkFrom: selected.id, title: selected.title || undefined, ticketKey: selected.ticketKey })}>Continue as a DOCK session</Button>}
                />
                {showLanes && <AgentLanes events={events} className="min-w-0 flex-1 max-[900px]:hidden" />}
                {inspectorOpen && <SessionInspector session={selected} files={files} onTicketClick={onTicketClick} className="w-[260px] flex-none border-l border-border max-[900px]:hidden" />}
              </div>
              {inspectorOpen && (
                <div className="fixed inset-x-0 bottom-0 z-[50] max-h-[70dvh] overflow-y-auto rounded-t-lg border-t border-border-glow bg-surface-1 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card min-[901px]:hidden" role="dialog" aria-label="About this session">
                  <div className="mb-2 flex items-center justify-between"><span className="mx-auto h-1.5 w-10 rounded-pill bg-border-glow" aria-hidden="true" /><Button size="sm" variant="ghost" className="h-11 min-w-11" aria-label="Close" onClick={() => setInspectorOpen(false)}><X size={15} aria-hidden="true" /></Button></div>
                  <SessionInspector session={selected} files={files} costUsd={liveSession?.costUsd} onTicketClick={onTicketClick} className="bg-transparent p-0" />
                </div>
              )}
            </>
          )}
        </Card>
      </div>
      {actionError && !selected && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{actionError}</p>}
      {gone && <Toast message="That session no longer exists." type="info" onClose={closeGone} />}

      <Dialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} dismissible={!deleting} labelledBy="delete-session-title" describedBy="delete-session-description">
        <Card className="w-[min(440px,calc(100vw-2rem))] shadow-card">
          <h2 id="delete-session-title" className="text-balance font-display text-xl font-bold">Delete this session?</h2>
          <p id="delete-session-description" className="mt-2 text-pretty text-sm text-muted-foreground">{deleteTarget ? titleOf(deleteTarget) : ''} and its messages are removed from DOCK. {deleteTarget?.source === 'cli' ? 'The session on the workspace is not touched.' : 'This cannot be undone.'}</p>
          {actionError && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{actionError}</p>}
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button><Button variant="danger" onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete session'}</Button></div>
        </Card>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onClose={() => !renaming && setRenameTarget(null)} dismissible={!renaming} labelledBy="rename-session-title">
        <Card className="w-[min(440px,calc(100vw-2rem))] shadow-card">
          <form onSubmit={(event) => { event.preventDefault(); void handleRename(); }}>
            <h2 id="rename-session-title" className="text-balance font-display text-xl font-bold">Rename session</h2>
            <p className="mt-2 text-pretty text-sm text-muted-foreground">Shown in the sidebar and the header.</p>
            <Input className="mt-4 h-10 max-[900px]:h-11" value={titleDraft} maxLength={TITLE_MAX} aria-label="Session title" autoFocus onChange={(event) => setTitleDraft(event.target.value)} />
            {renameError && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{renameError}</p>}
            <div className="mt-6 flex justify-end gap-2"><Button type="button" onClick={() => setRenameTarget(null)} disabled={renaming}>Cancel</Button><Button type="submit" variant="primary" disabled={renaming || !titleDraft.trim()}>{renaming ? 'Saving...' : 'Save'}</Button></div>
          </form>
        </Card>
      </Dialog>
    </Page>
  );
};

export default SessionsPage;
