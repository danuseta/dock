import React, { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, Info, MessagesSquare, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { CREATE_CHAT_SESSION, DELETE_CHAT_SESSION, RENAME_CHAT_SESSION } from '../graphql/mutations';
import { GET_CHAT_SESSION, GET_CHAT_SESSIONS, SEARCH_CHAT } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Toast } from '../components/Toast';
import { Button, Card, Dialog, Input, Page, PageHeader } from '../components/ui';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { ChatThread } from '../chat/ChatThread';
import { LimitsLine, SessionStatusView } from '../chat/StatusLine';
import { useChatStatus } from '../chat/useChatStatus';
import { useFullViewport } from '../chat/useFullViewport';
import { MachineChip } from '../chat/MachineControls';
import { useChatMachines } from '../chat/useChatMachines';
import { SLOW_POLL_MS, machineOf, machineOnline, sessionTitle as titleOf, type ChatSession } from '../chat/messages';
import { ReadOnlyChip, SessionRow, SourceChip, TicketChip } from '../chat/SessionRow';
import { SessionInfoCard } from '../chat/SessionInfoCard';
import { filesTouched, sessionStats, type ChatActivity } from '../chat/activity/activity';
import { AgentLanes } from '../chat/activity/AgentLanes';
import { chatStore } from '../chat/store';
import { SESSIONS_PATH, sessionIdFromSearch, sessionUrl } from '../chat/sessionRoute';

interface SearchHit { session: ChatSession; messageId: number; snippet: string; at: string }

const sectionLabel = 'font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const SEARCH_MIN = 2;
const TITLE_MAX = 120;

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

const SessionsPage: React.FC<{ onTicketClick?: (key: string) => void }> = ({ onTicketClick }) => {
  const { data, loading, error, refetch } = useQuery<{ chatSessions: ChatSession[] }>(GET_CHAT_SESSIONS, { ...CACHED_QUERY_OPTIONS, variables: { limit: 300 }, pollInterval: SLOW_POLL_MS });
  const [createSession, { loading: creating }] = useMutation<{ createChatSession: ChatSession }>(CREATE_CHAT_SESSION);
  const [renameSession, { loading: renaming }] = useMutation(RENAME_CHAT_SESSION);
  const [deleteSession, { loading: deleting }] = useMutation(DELETE_CHAT_SESSION);
  const [selectedId, setSelectedId] = useState<string | null>(() => sessionIdFromSearch(window.location.search));
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState('');
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const { status: liveStatus, now: statusNow } = useChatStatus();
  const machines = useChatMachines();
  const [gone, setGone] = useState(false);
  const [events, setEvents] = useState<ChatActivity[]>([]);
  const [lanesOn, setLanesOn] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
    setTitleDraft(null);
    setActionError('');
    setInfoOpen(false);
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

  const saveTitle = async () => {
    const title = (titleDraft || '').trim();
    if (!selected || !title) return;
    setActionError('');
    try {
      await renameSession({ variables: { id: selected.id, title } });
      setTitleDraft(null);
    } catch (renameError) {
      setActionError(errorText(renameError, 'The session could not be renamed'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionError('');
    try {
      await deleteSession({ variables: { id: deleteTarget.id } });
      chatStore.closeTab(deleteTarget.id);
      setDeleteTarget(null);
      select(null);
      await refetch();
    } catch (deleteError) {
      setActionError(errorText(deleteError, 'The session could not be deleted'));
    }
  };

  useFullViewport(Boolean(selected), '(max-width: 900px)');
  const stats = sessionStats(events);
  // Lanes earn their room only while two or more subagents run at once.
  const lanesReady = stats.runningAgents >= 2;
  const showLanes = lanesOn && lanesReady;

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  return (
    <Page width="full">
      <PageHeader>
        <div>
          <h1 className="text-balance font-display text-3xl font-black">Sessions</h1>
          <p className="mt-1 text-pretty text-secondary-foreground">Claude Code history from the workspace, and the sessions you run from DOCK.</p>
          <LimitsLine machine={selected ? machineOf(selected) : undefined} className="mt-2" />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" className="max-[900px]:h-11" disabled={creating} onClick={() => void create({})}><Plus size={14} aria-hidden="true" />New session</Button>
        </div>
      </PageHeader>

      {error && !data && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">Sessions failed to load: {error.message}</Card>}

      <div className="grid grid-cols-[360px_minmax(0,1fr)] items-start gap-4 max-[900px]:grid-cols-1">
        <div className={cn('flex h-[calc(100dvh-196px)] min-h-[420px] max-[900px]:h-[calc(100dvh-320px)] min-w-0 flex-col gap-3', selected && 'max-[900px]:hidden')}>
        <Card className="flex min-h-0 flex-1 flex-col bg-surface-0 p-0">
          <div className="relative flex-none border-b border-border p-3">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-6 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="h-9 pl-9 text-[0.82rem] max-[900px]:h-11" type="search" value={searchText} placeholder="Search every message..." aria-label="Search messages" onChange={(event) => setSearchText(event.target.value)} />
          </div>
          <p className={cn(sectionLabel, 'flex flex-none items-center justify-between px-3.5 pt-3 pb-1.5')}>
            <span>{searching ? `Results for "${query}"` : 'Sessions'}</span>
            <span className="tabular-nums">{searching ? hits.length : sessions.length}</span>
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {searching ? (
              <>
                {searchError && <p className="px-1.5 py-2 text-pretty text-xs text-status-conflict" role="alert">The search failed: {searchError.message}</p>}
                {!searchError && searchLoading && hits.length === 0 && <p className="px-1.5 py-6 text-center text-sm text-muted-foreground" role="status">Searching...</p>}
                {!searchError && !searchLoading && hits.length === 0 && <p className="px-1.5 py-6 text-center text-pretty text-sm text-muted-foreground">No message contains "{query}".</p>}
                {hits.map((hit) => (
                  <SessionRow
                    key={`${hit.session.id}-${hit.messageId}`}
                    session={hit.session}
                    machine={machineOf(hit.session)}
                    online={machineOnline(machines, machineOf(hit.session))}
                    selected={hit.session.id === selectedId}
                    now={now}
                    onSelect={() => select(hit.session.id)}
                    snippet={hit.snippet}
                    snippetAt={hit.at}
                  />
                ))}
              </>
            ) : (
              <>
                {searchText.trim().length === 1 && <p className="px-1.5 pb-2 text-xs text-muted-foreground">Type at least {SEARCH_MIN} characters to search.</p>}
                {sessions.length === 0 && <p className="px-1.5 py-6 text-center text-pretty text-sm text-muted-foreground">No session yet. Start one here, or run <span className="font-mono text-xs">node dock-push.cjs sessions</span> on the workspace to bring in the history.</p>}
                {sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    machine={machineOf(session)}
                    online={machineOnline(machines, machineOf(session))}
                    selected={session.id === selectedId}
                    now={now}
                    onSelect={() => select(session.id)}
                  >
                    {liveStatus?.sessions.filter((item) => item.sessionId === session.id).map((item) => <SessionStatusView key={item.sessionId} status={item} now={statusNow} className="mt-1" />)}
                  </SessionRow>
                ))}
              </>
            )}
          </div>
        </Card>
        {selected && <SessionInfoCard session={selected} files={filesTouched(events)} onTicketClick={onTicketClick} />}
        </div>

        <Card className={cn('flex h-[calc(100dvh-196px)] min-h-[420px] max-[900px]:h-[calc(100dvh-320px)] flex-col bg-surface-0 p-0', !selected && 'max-[900px]:hidden', selected && 'max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:top-[var(--vv-top,0px)] max-[900px]:z-[45] max-[900px]:h-[var(--vv-h,100dvh)] max-[900px]:min-h-0 max-[900px]:rounded-none max-[900px]:border-0')}>
          {!selected ? (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div>
                <MessagesSquare size={28} className="mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
                <p className="text-pretty text-sm text-muted-foreground">Select a session to read it.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border px-3.5 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
                <Button size="sm" variant="ghost" className="hidden h-7 px-2 max-[900px]:inline-flex max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Back to the session list" onClick={() => select(null)}><ArrowLeft size={14} aria-hidden="true" /></Button>
                <div className="contents max-[900px]:order-3 max-[900px]:flex max-[900px]:basis-full max-[900px]:flex-wrap max-[900px]:items-center max-[900px]:gap-2">
                <SourceChip source={selected.source} />
                {selected.source === 'cli' && <ReadOnlyChip />}
                {selected.ticketKey && <TicketChip ticketKey={selected.ticketKey} />}
                <span className="ml-auto flex-none"><MachineChip name={machineOf(selected)} online={machineOnline(machines, machineOf(selected))} /></span>
                </div>
                {titleDraft === null ? (
                  <h2 className="min-w-0 flex-1 truncate font-display text-[0.95rem] font-bold max-[900px]:order-1" title={titleOf(selected)}>{titleOf(selected)}</h2>
                ) : (
                  <form className="flex min-w-0 flex-1 items-center gap-1.5 max-[900px]:order-1" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
                    <Input className="h-8 min-w-0 flex-1 px-2.5 text-[0.82rem] max-[900px]:h-11" value={titleDraft} maxLength={TITLE_MAX} aria-label="Session title" autoFocus onChange={(event) => setTitleDraft(event.target.value)} />
                    <Button size="sm" type="submit" variant="primary" className="max-[900px]:h-11" disabled={renaming || !titleDraft.trim()}>Save</Button>
                    <Button size="sm" variant="ghost" className="max-[900px]:h-11" onClick={() => setTitleDraft(null)}>Cancel</Button>
                  </form>
                )}
                {titleDraft === null && (
                  <div className="flex flex-none items-center gap-1 max-[900px]:order-2">
                    {lanesReady && (
                      <span className="inline-flex overflow-hidden rounded-xs border border-border-glow font-mono text-[0.66rem] max-[900px]:hidden" role="group" aria-label="View">
                        <button type="button" aria-pressed={!showLanes} className={cn('px-2 py-1', !showLanes ? 'bg-surface-hover font-bold text-foreground' : 'text-secondary-foreground hover:bg-surface-1')} onClick={() => setLanesOn(false)}>Chat</button>
                        <button type="button" aria-pressed={showLanes} className={cn('px-2 py-1', showLanes ? 'bg-surface-hover font-bold text-foreground' : 'text-secondary-foreground hover:bg-surface-1')} onClick={() => setLanesOn(true)}>Swimlanes · {stats.runningAgents} running</button>
                      </span>
                    )}
                    <Button size="sm" variant="ghost" className="hidden h-8 px-2 max-[900px]:inline-flex max-[900px]:h-11 max-[900px]:min-w-11" aria-label="About this session" aria-expanded={infoOpen} title="Info" onClick={() => setInfoOpen((open) => !open)}><Info size={13} aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Rename session" title="Rename" onClick={() => setTitleDraft(selected.title)}><Pencil size={13} aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Delete session" title="Delete" onClick={() => { setActionError(''); setDeleteTarget(selected); }}><Trash2 size={13} aria-hidden="true" /></Button>
                  </div>
                )}
              </div>
              {stats.steps > 0 && (
                <p className="flex flex-none flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border px-3.5 py-1.5 font-mono text-[0.66rem] text-muted-foreground" aria-label="Session activity">
                  <span><b className="font-semibold text-secondary-foreground">{stats.steps}</b> steps</span>
                  <span><b className="font-semibold text-secondary-foreground">{stats.skills}</b> {stats.skills === 1 ? 'skill' : 'skills'}</span>
                  <span><b className="font-semibold text-secondary-foreground">{stats.agents}</b> {stats.agents === 1 ? 'agent' : 'agents'}{stats.runningAgents > 0 ? ` (${stats.runningAgents} running)` : ''}</span>
                </p>
              )}
              {actionError && !deleteTarget && <p className="flex-none border-b border-border px-3.5 py-1.5 text-pretty text-xs break-words text-status-conflict" role="alert">{actionError}</p>}
              <div className="flex min-h-0 flex-1">
                <ChatThread
                  key={selected.id}
                  sessionId={selected.id}
                  className={cn('min-h-0 min-w-0 flex-1', showLanes && 'max-w-[44%]')}
                  hideMachine
                  onActivity={setEvents}
                  readOnlyAction={<Button size="sm" variant="primary" disabled={creating} onClick={() => void create({ forkFrom: selected.id, title: selected.title || undefined, ticketKey: selected.ticketKey })}>Continue as a DOCK session</Button>}
                />
                {showLanes && <AgentLanes events={events} className="min-w-0 flex-1 max-[900px]:hidden" />}
              </div>
              {infoOpen && (
                <div className="fixed inset-x-0 bottom-0 z-[50] max-h-[70dvh] overflow-y-auto rounded-t-lg border-t border-border-glow bg-surface-1 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card min-[901px]:hidden" role="dialog" aria-label="About this session">
                  <div className="mb-2 flex items-center justify-between"><span className="mx-auto h-1.5 w-10 rounded-pill bg-border-glow" aria-hidden="true" /><Button size="sm" variant="ghost" className="h-11 min-w-11" aria-label="Close" onClick={() => setInfoOpen(false)}><X size={15} aria-hidden="true" /></Button></div>
                  <SessionInfoCard session={selected} files={filesTouched(events)} onTicketClick={onTicketClick} />
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
    </Page>
  );
};

export default SessionsPage;
