import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import type { Components } from 'react-markdown';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FileText, RefreshCw, Settings2, Trash2, X } from 'lucide-react';
import { GET_DISCORD_THREADS } from '../graphql/queries';
import { ADD_DISCORD_CHANNEL, DISMISS_DISCORD_THREAD, REFRESH_DISCORD, REMOVE_DISCORD_CHANNEL, UPDATE_DISCORD_CHANNEL } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button, Dialog, IconButton, Input, Page, Select } from '../components/ui';
import { Markdown } from '../chat/Markdown';
import { changesHref } from '../changes/href';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import {
  ALL, KINDS, MENTION_LINK, STATE_LABEL, VIEWS, ago, channelLabel, channelTabs, countFor, discordFileUrl, discordMarkdown, fileOpening, fileSize, isDone, kindLabel, matchesSearch, needsYou, progressOf, slotsOf, sprintGroups, threadsFor, titleParts, wib, wibDay, wibTime,
  type ChannelKind, type ChannelTab, type DiscordChannel, type DiscordMessage, type DiscordThread, type MentionKind, type Progress, type Slot, type ThreadView,
} from '../lib/discordThreads';

interface DiscordPageProps { onTicketClick: (key: string) => void; onNavigate: (path: string) => void }

const PROGRESS_STYLE: Record<Progress, string> = {
  open: 'bg-status-discord-bg text-status-discord',
  progress: 'bg-status-warn/15 text-status-warn',
  done: 'bg-status-merged/15 text-status-merged',
};

const ProgressChip: React.FC<{ progress: Progress }> = ({ progress }) => (
  <span className={cn('shrink-0 rounded-[3px] px-1 py-px font-mono text-[0.58rem] font-bold max-[760px]:text-xs', PROGRESS_STYLE[progress])}>{progress}</span>
);

const SLOT_STYLE: Record<Slot, string> = { pass: 'bg-status-merged', onit: 'bg-status-warn', free: 'bg-border-glow' };

/** A pull request's reviewer slots: green passed, yellow on it, grey free. */
const Slots: React.FC<{ thread: DiscordThread; large?: boolean }> = ({ thread, large }) => {
  const slots = slotsOf(thread);
  const label = `On it ${Math.min(thread.onIt.length, thread.slots)}/${thread.slots} · Pass ${Math.min(thread.passes.length, thread.slots)}/${thread.slots}`;
  return (
    <span className="inline-flex shrink-0 gap-0.5" role="img" aria-label={label} title={label}>
      {slots.map((slot, index) => <span key={index} className={cn('rounded-[1px]', large ? 'h-1.5 w-6' : 'h-1.5 w-[11px]', SLOT_STYLE[slot])} />)}
    </span>
  );
};

/** The title with its ticket keys in the accent colour. */
const Title: React.FC<{ text: string }> = ({ text }) => (
  <>{titleParts(text).map((part, index) => (part.ticket ? <span key={index} className="font-mono text-accent">{part.text}</span> : <React.Fragment key={index}>{part.text}</React.Fragment>))}</>
);

const selectedFromUrl = () => new URLSearchParams(window.location.search).get('thread');

const writeFeed = (field: string) => (cache: any, result: any) => {
  if (result.data?.[field]) cache.writeQuery({ query: GET_DISCORD_THREADS, data: { discordThreads: result.data[field] } });
};

/** Threads of the followed Discord channels: a list on the left, the open thread on the right. */
const DiscordPage: React.FC<DiscordPageProps> = ({ onTicketClick, onNavigate }) => {
  // Discord pushes changes to the server, so this only reads DOCK's own copy.
  const { data, loading, error } = useQuery(GET_DISCORD_THREADS, { ...CACHED_QUERY_OPTIONS, pollInterval: 10000 });
  const [refresh, { loading: refreshing }] = useMutation(REFRESH_DISCORD, { update: writeFeed('refreshDiscord') });
  const [dismiss] = useMutation(DISMISS_DISCORD_THREAD, { refetchQueries: ['GetDiscordThreads'] });
  const [chosenTab, setTab] = useState<ChannelTab>(ALL);
  const [managing, setManaging] = useState(false);
  const [view, setView] = useState<ThreadView>('all');
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(selectedFromUrl);
  const now = new Date();

  const feed = data?.discordThreads;
  const all: DiscordThread[] = useMemo(() => feed?.rows ?? [], [feed]);
  const rows = all.filter((row) => matchesSearch(row, query));
  const channels: DiscordChannel[] = useMemo(() => feed?.channels ?? [], [feed]);
  const tabs = channelTabs(channels);
  const tab = tabs.some((entry) => entry.id === chosenTab) ? chosenTab : ALL;
  const shown = threadsFor(rows, tab, view);
  const groups = sprintGroups(shown);
  const selected = all.find((row) => row.id === picked) ?? shown[0] ?? null;

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;
  if (error && !data) return <Page width="full"><p className="rounded-md border border-status-conflict bg-status-conflict-bg p-4 text-sm text-status-conflict" role="alert">Discord threads failed to load: {error.message}</p></Page>;

  const open = (id: string) => {
    setPicked(id);
    window.history.replaceState(window.history.state, '', `/discord?thread=${encodeURIComponent(id)}`);
  };
  const back = () => {
    setPicked(null);
    window.history.replaceState(window.history.state, '', '/discord');
  };
  const toggle = (name: string) => setFolded(folded.includes(name) ? folded.filter((item) => item !== name) : [...folded, name]);
  const turn = countFor(rows, tab, 'needs');

  return (
    <Page width="full">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Discord</h1>
          <p className="mt-1 text-xs text-muted-foreground">{channels.length ? `Threads of ${channels.filter((channel) => channel.enabled).map(channelLabel).join(', ') || 'no channel that is on'}` : 'No channel followed yet'}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {!feed?.configured
            ? <span className="text-status-warn">Bot not set up · <button type="button" className="border-0 bg-transparent p-0 text-status-warn underline" onClick={() => onNavigate('/settings')}>Settings</button></span>
            : feed.error
            ? <span className="text-status-conflict" role="alert">Last sync failed: {feed.error}{feed.syncedAt ? ` · showing ${wib(feed.syncedAt)}` : ''}</span>
            : <span className="flex items-center gap-1.5 text-muted-foreground"><span className={cn('size-1.5 rounded-full', feed.live ? 'bg-status-merged' : 'bg-status-warn')} aria-hidden="true" />{feed.live ? 'Live' : 'Reconnecting'}{feed.syncedAt && <span className="whitespace-nowrap">· <span className="max-[760px]:hidden">updated </span>{wibTime(feed.syncedAt)}</span>}</span>}
          <Button size="sm" variant={managing ? 'primary' : 'default'} onClick={() => setManaging(!managing)} aria-expanded={managing}><Settings2 size={14} aria-hidden="true" /><span className="max-[760px]:sr-only">Channels</span></Button>
          <Button size="sm" onClick={() => void refresh()} disabled={refreshing || !feed?.configured}><RefreshCw size={14} className={cn(refreshing && 'animate-spin')} aria-hidden="true" /><span className="max-[760px]:sr-only">{refreshing ? 'Syncing' : 'Refresh'}</span></Button>
        </div>
      </header>

      {feed?.configured && feed.ownerSet === false && (
        <p className="mb-4 flex flex-wrap items-center gap-2 rounded-sm border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-xs text-status-warn" role="status">
          Add your Discord user id in Settings to see which threads are yours.
          <button type="button" className="border-0 bg-transparent p-0 font-semibold underline" onClick={() => onNavigate('/settings?section=discord')}>Open Settings</button>
        </p>
      )}

      {(managing || channels.length === 0) && <ChannelManager channels={channels} configured={Boolean(feed?.configured)} />}

      <div className="grid min-h-[640px] grid-cols-[400px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-background max-[960px]:grid-cols-1">
        <section className={cn('flex min-w-0 flex-col border-r border-border max-[960px]:border-r-0', picked && 'max-[960px]:hidden')} aria-label="Threads">
          <div className="border-b border-border px-4 py-2.5">
            <Input type="search" aria-label="Search threads" className="h-8 text-xs max-[760px]:h-11" placeholder="Search title, message, person or ticket" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="flex gap-4 overflow-x-auto border-b border-border px-4" role="tablist" aria-label="Forum">
            {tabs.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)} className={cn('min-h-11 whitespace-nowrap border-0 border-b-2 bg-transparent px-0 pt-2 text-xs font-medium', tab === entry.id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {entry.label} <span className="font-mono text-[0.64rem] tabular-nums max-[760px]:text-xs">{countFor(rows, entry.id, view)}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{turn === 0 ? 'Nothing needs you' : `${turn} ${turn === 1 ? 'needs' : 'need'} you`}</span>
            <Select aria-label="Show" className="h-8 w-36 text-xs max-[760px]:h-11" value={view} onValueChange={(value) => setView(value as ThreadView)} options={VIEWS.map((option) => ({ value: option.id, label: option.label }))} />
          </div>
          <div className="max-h-[calc(100dvh-15rem)] min-h-[320px] flex-1 overflow-y-auto max-[960px]:max-h-none">
            {shown.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">{query.trim() ? 'No thread matches.' : view === 'needs' ? 'No thread needs you here.' : 'No threads here.'}</p>}
            {groups.map((group) => {
              const expanded = !folded.includes(group.name);
              return (
                <div key={group.name}>
                  <button type="button" aria-expanded={expanded} onClick={() => toggle(group.name)} className="sticky top-0 z-[1] flex w-full items-center justify-between border-0 border-b border-border bg-surface-0 px-4 py-1.5 text-left font-mono text-[0.64rem] font-bold tracking-wide uppercase max-[760px]:min-h-11 max-[760px]:text-xs">
                    <span className={group.active ? 'text-accent' : 'text-secondary-foreground'}>{group.name}{group.active ? ' · active' : ''}</span>
                    <span className="font-normal text-muted-foreground tabular-nums">{group.threads.length}</span>
                  </button>
                  {expanded && group.threads.map((row) => <ThreadRow key={row.id} row={row} now={now} selected={selected?.id === row.id} onOpen={() => open(row.id)} />)}
                </div>
              );
            })}
          </div>
        </section>

        {selected ? <ThreadPane key={selected.id} thread={selected} onBack={back} picked={Boolean(picked)} onTicketClick={onTicketClick} onNavigate={onNavigate} onDismiss={() => void dismiss({ variables: { id: selected.id, lastActivity: selected.lastActivity } })} />
          : <p className="p-6 text-sm text-muted-foreground max-[960px]:hidden">Pick a thread.</p>}
      </div>
    </Page>
  );
};

/** One thread in the list: who opened it, the title, one chip with why, and when. */
const ThreadRow: React.FC<{ row: DiscordThread; now: Date; selected: boolean; onOpen: () => void }> = ({ row, now, selected, onOpen }) => {
  const fresh = needsYou(row) && !row.older;
  return (
    <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined}
      className={cn('grid w-full grid-cols-[28px_minmax(0,1fr)_auto] gap-2.5 border-0 border-b border-l-2 border-border border-l-transparent bg-transparent py-2.5 pr-4 pl-3.5 text-left text-foreground hover:bg-surface-0', selected && 'border-l-accent bg-surface-1')}>
      <span className="relative mt-0.5 size-7">
        {row.createdByAvatar ? <img src={row.createdByAvatar} alt="" loading="lazy" className="size-7 rounded-full bg-surface-2" /> : <span className="block size-7 rounded-full bg-surface-2" />}
        {needsYou(row) && <span className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background', fresh ? 'bg-status-warn' : 'bg-surface-2 ring-1 ring-status-warn')} aria-label="Needs you" />}
      </span>
      <span className="min-w-0">
        <strong className={cn('block truncate text-[0.8rem] max-[760px]:line-clamp-2 max-[760px]:whitespace-normal', fresh ? 'font-semibold' : 'font-medium')}><Title text={row.title} /></strong>
        <small className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.68rem] text-muted-foreground max-[760px]:text-xs"><ProgressChip progress={progressOf(row)} />{row.kind === 'pr' && <Slots thread={row} />}<span className="truncate">{row.why}</span></small>
      </span>
      <span className="text-right">
        <time className="block font-mono text-[0.62rem] text-secondary-foreground max-[760px]:text-xs">{ago(row.lastActivity, now)}</time>
        <time className="mt-0.5 block font-mono text-[0.58rem] whitespace-nowrap text-muted-foreground max-[760px]:hidden">{wib(row.lastActivity)}</time>
      </span>
    </button>
  );
};

type DiscordFile = DiscordMessage['attachments'][number];
const isImage = (file: DiscordFile) => file.type?.split('/')[0] === 'image';

/**
 * A picture or a video as a thumbnail; anything else, or a link that stopped working, as its name and size. A picture
 * and a text file open in a viewer, a PDF in a new tab, and every other file can be downloaded.
 */
const Attachment: React.FC<{ file: DiscordFile; onView: () => void; onRead: () => void }> = ({ file, onView, onRead }) => {
  const [broken, setBroken] = useState(false);
  const kind = file.type?.split('/')[0];
  const caption = <span className="flex justify-between gap-2 px-2 py-1 text-[0.64rem] text-muted-foreground"><b className="truncate font-medium text-secondary-foreground">{file.name}</b><span className="whitespace-nowrap">{file.width && file.height ? `${file.width}×${file.height} · ` : ''}{fileSize(file.size)}</span></span>;
  if (!broken && kind === 'image') {
    return (
      <button type="button" onClick={onView} className="block w-[220px] overflow-hidden rounded-sm border border-border bg-surface-0 p-0 text-left hover:border-border-glow" aria-label={`Open ${file.name}`}>
        <img src={file.url} alt={file.name} loading="lazy" onError={() => setBroken(true)} className="h-[124px] w-full bg-surface-1 object-cover" />
        {caption}
      </button>
    );
  }
  if (!broken && kind === 'video') {
    return (
      <span className="block w-[260px] overflow-hidden rounded-sm border border-border bg-surface-0">
        <video src={file.url} controls preload="metadata" onError={() => setBroken(true)} className="h-[146px] w-full bg-black" />
        {caption}
      </span>
    );
  }
  const opening = fileOpening(file);
  const action = 'inline-flex h-7 items-center gap-1 rounded-xs px-2 font-medium text-accent hover:bg-surface-1 max-[900px]:h-11';
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 self-start rounded-sm border border-border bg-surface-0 py-1 pr-1 pl-2.5 text-[0.7rem] text-secondary-foreground">
      <FileText size={14} aria-hidden="true" className="flex-none text-muted-foreground" />
      <b className="min-w-0 truncate font-medium text-foreground">{file.name}</b>
      <span className="whitespace-nowrap">{fileSize(file.size)}{file.type ? ` · ${file.type.split('/')[1]?.split(';')[0] ?? file.type}` : ''}</span>
      <span className="flex items-center">
        {opening === 'text' && <button type="button" className={action} onClick={onRead}><Eye size={13} aria-hidden="true" />View</button>}
        {opening === 'pdf' && <a href={discordFileUrl(file.url, file.name)} target="_blank" rel="noopener noreferrer" className={action}><ExternalLink size={13} aria-hidden="true" />Open</a>}
        <a href={opening ? discordFileUrl(file.url, file.name, true) : file.url} download={file.name} target="_blank" rel="noopener noreferrer" className={action} aria-label={`Download ${file.name}`}><Download size={13} aria-hidden="true" />Download</a>
      </span>
    </span>
  );
};

/** A text file of a message over the page, read through DOCK; shown as text, never rendered. */
const TextViewer: React.FC<{ file: DiscordFile; onClose: () => void }> = ({ file, onClose }) => {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    fetch(discordFileUrl(file.url, file.name), { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => (response.ok ? response.text() : Promise.reject(new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `DOCK answered ${response.status}`))))
      .then((body) => { if (!gone) setText(body); }, (error: Error) => { if (!gone) setFailed(error.message); });
    return () => { gone = true; };
  }, [file]);
  return (
    <Dialog open onClose={onClose} labelledBy="discord-text-name" className="h-dvh w-[min(980px,100%)] max-[760px]:p-0">
      <div className="flex h-full max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-md border border-border-glow bg-surface-0 max-[760px]:max-h-dvh max-[760px]:rounded-none max-[760px]:border-0">
        <div className="flex min-w-0 flex-none items-center gap-1.5 border-b border-border px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
          <h2 id="discord-text-name" className="min-w-0 flex-1 truncate font-mono text-[0.78rem] font-semibold">{file.name}</h2>
          <span className="flex-none font-mono text-[0.68rem] text-muted-foreground max-[760px]:hidden">{fileSize(file.size)}</span>
          <a href={discordFileUrl(file.url, file.name, true)} download={file.name} aria-label="Download" title="Download" className="inline-grid size-8 flex-none place-items-center rounded-xs text-secondary-foreground hover:bg-surface-1 hover:text-foreground max-[900px]:size-11"><Download size={14} aria-hidden="true" /></a>
          <IconButton variant="ghost" aria-label="Close" className="max-[900px]:size-11" onClick={onClose}><X size={15} aria-hidden="true" /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-1/40 p-4">
          {failed ? <p className="text-sm text-status-conflict" role="alert">{failed}</p>
            : text === null ? <p className="text-sm text-muted-foreground">Loading...</p>
              : <pre className="m-0 font-mono text-[0.74rem] leading-relaxed whitespace-pre-wrap text-secondary-foreground [overflow-wrap:anywhere]">{text}</pre>}
        </div>
      </div>
    </Dialog>
  );
};

/** The pictures of one message over the page, like a file in a session; the arrows step through the others. */
const ImageViewer: React.FC<{ files: DiscordFile[]; index: number; onIndex: (index: number) => void; onClose: () => void }> = ({ files, index, onIndex, onClose }) => {
  const file = files[index];
  const many = files.length > 1;
  const step = (delta: number) => onIndex((index + delta + files.length) % files.length);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!many) return;
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  };
  return (
    <Dialog open onClose={onClose} labelledBy="discord-image-name" className="h-dvh w-[min(980px,100%)] max-[760px]:p-0">
      <div className="flex h-full max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-md border border-border-glow bg-surface-0 max-[760px]:max-h-dvh max-[760px]:rounded-none max-[760px]:border-0" onKeyDown={onKeyDown}>
        <div className="flex min-w-0 flex-none items-center gap-1.5 border-b border-border px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
          <h2 id="discord-image-name" className="min-w-0 flex-1 truncate font-mono text-[0.78rem] font-semibold">{file.name}</h2>
          <span className="flex-none font-mono text-[0.68rem] text-muted-foreground max-[760px]:hidden">{fileSize(file.size)}</span>
          {many && <IconButton variant="ghost" aria-label="Previous picture" className="max-[900px]:size-11" onClick={() => step(-1)}><ChevronLeft size={15} aria-hidden="true" /></IconButton>}
          {many && <IconButton variant="ghost" aria-label="Next picture" className="max-[900px]:size-11" onClick={() => step(1)}><ChevronRight size={15} aria-hidden="true" /></IconButton>}
          <a href={file.url} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab" className="inline-grid size-8 flex-none place-items-center rounded-xs text-secondary-foreground hover:bg-surface-1 hover:text-foreground max-[900px]:size-11"><ExternalLink size={14} aria-hidden="true" /></a>
          <IconButton variant="ghost" aria-label="Close" className="max-[900px]:size-11" onClick={onClose}><X size={15} aria-hidden="true" /></IconButton>
        </div>
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-surface-1/40 p-4">
          <img src={file.url} alt={file.name} className="max-h-[calc(100dvh-10rem)] max-w-full object-contain" />
        </div>
        {many && <p className="flex-none border-t border-border px-3 py-1.5 font-mono text-[0.66rem] text-muted-foreground tabular-nums">{index + 1} of {files.length}</p>}
      </div>
    </Dialog>
  );
};

const MENTION_STYLE: Record<MentionKind, string> = {
  me: 'bg-status-warn/15 text-status-warn',
  role: 'bg-[oklch(0.70_0.14_305/0.14)] text-[oklch(0.78_0.12_305)]',
  other: 'bg-status-discord-bg text-status-discord',
};

/** A mention link from discordMarkdown is drawn as a highlighted name; any other link opens in a new tab. */
const MESSAGE_MARKDOWN: Components = {
  a: ({ children, href }) => (href?.startsWith(MENTION_LINK)
    ? <span className={cn('rounded-[3px] px-0.5', MENTION_STYLE[href.slice(MENTION_LINK.length) as MentionKind] ?? MENTION_STYLE.other)}>{children}</span>
    : <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:text-accent-hover">{children}</a>),
};

const ChannelManager: React.FC<{ channels: DiscordChannel[]; configured: boolean }> = ({ channels, configured }) => {
  const [input, setInput] = useState('');
  const [kind, setKind] = useState<ChannelKind>('follow');
  const [error, setError] = useState<string | null>(null);
  const [add, { loading: adding }] = useMutation(ADD_DISCORD_CHANNEL, { update: writeFeed('addDiscordChannel') });
  const [change] = useMutation(UPDATE_DISCORD_CHANNEL, { update: writeFeed('updateDiscordChannel') });
  const [remove] = useMutation(REMOVE_DISCORD_CHANNEL, { update: writeFeed('removeDiscordChannel') });
  const kindOptions = KINDS.map((entry) => ({ value: entry.id, label: entry.label }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await add({ variables: { input, kind } });
      setInput('');
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Could not add the channel');
    }
  };

  return (
    <section className="mb-4 rounded-md border border-border bg-surface-0" aria-label="Followed channels">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-display text-sm font-bold">Followed channels</h2>
        <p className="mt-0.5 text-[0.7rem] text-muted-foreground">A forum or text channel brings its threads; a thread link follows that one thread.{configured ? '' : ' The bot is not set up yet, so names show after the first sync.'}</p>
      </div>
      {channels.map((channel) => (
        <div key={channel.id} className="grid grid-cols-[minmax(0,1fr)_170px_auto_auto] items-center gap-3 border-b border-border px-4 py-2 text-xs max-[760px]:grid-cols-[minmax(0,1fr)_auto]">
          <span className="min-w-0"><strong className={cn('block truncate font-medium', !channel.enabled && 'text-muted-foreground line-through')}>{channelLabel(channel)}</strong><small className="font-mono text-[0.62rem] text-muted-foreground">{channel.id}{channel.thread ? ' · thread' : ''}{channel.team ? ' · team' : ''}</small></span>
          <Select aria-label={`Kind of ${channelLabel(channel)}`} className="h-8 text-xs max-[760px]:col-span-2 max-[760px]:h-11" value={channel.kind} onValueChange={(value) => void change({ variables: { id: channel.id, kind: value, enabled: channel.enabled } })} options={kindOptions} />
          <Button size="sm" variant="ghost" onClick={() => void change({ variables: { id: channel.id, kind: channel.kind, enabled: !channel.enabled } })}>{channel.enabled ? 'Turn off' : 'Turn on'}</Button>
          {channel.team
            ? <span className="size-8" title="Comes with the workspace: turn it off instead" aria-hidden="true" />
            : <Button size="sm" variant="ghost" aria-label={`Remove ${channelLabel(channel)}`} onClick={() => void remove({ variables: { id: channel.id } })}><Trash2 size={14} aria-hidden="true" /></Button>}
        </div>
      ))}
      <form className="flex flex-wrap items-end gap-3 px-4 py-3" onSubmit={submit}>
        <label className="min-w-[260px] flex-1 text-xs"><span className="mb-1 block font-medium">Channel or thread</span><Input className="font-mono text-xs" value={input} onChange={(event) => setInput(event.target.value)} placeholder="1525182530184286289 or https://discord.com/channels/..." required /></label>
        <label className="w-44 text-xs"><span className="mb-1 block font-medium">Kind</span><Select aria-label="Kind" value={kind} onValueChange={(value) => setKind(value as ChannelKind)} options={kindOptions} /></label>
        <Button type="submit" variant="primary" disabled={adding || !input.trim()}>{adding ? 'Adding' : 'Add'}</Button>
        <p className="basis-full text-[0.68rem] text-muted-foreground">{KINDS.find((entry) => entry.id === kind)?.help}</p>
        {error && <p className="basis-full text-xs text-status-conflict" role="alert">{error}</p>}
      </form>
    </section>
  );
};

const ThreadPane: React.FC<{ thread: DiscordThread; picked: boolean; onBack: () => void; onTicketClick: (key: string) => void; onNavigate: (path: string) => void; onDismiss: () => void }> = ({ thread, picked, onBack, onTicketClick, onNavigate, onDismiss }) => {
  const [viewing, setViewing] = useState<{ files: DiscordFile[]; index: number } | null>(null);
  const [reading, setReading] = useState<DiscordFile | null>(null);
  const earlier = Math.max(0, thread.messageCount - thread.messages.length);
  const ticket = thread.tickets[0];
  const pr = thread.prs[0];
  const facts: Array<[string, React.ReactNode]> = [
    ['Opened', wib(thread.createdAt)],
    ['Opened by', thread.createdBy ?? 'Unknown'],
    ['Kind', kindLabel(thread.kind)],
    ['Tags', thread.tags.length ? thread.tags.join(', ') : 'None'],
    ['Ticket', thread.tickets.length ? thread.tickets.map((item) => <span key={item.key} className="mr-2"><span className="font-mono text-accent">{item.key}</span>{item.status ? ` · ${item.status}` : ''}{item.assignee ? ` · ${item.assignee}` : ''}</span>) : 'None in the title or tags'],
    ['Sprint', thread.tickets.find((item) => item.sprint)?.sprint ?? 'None'],
    ['Pull request', pr ? <span className="flex items-center gap-2"><a href={pr} target="_blank" rel="noreferrer" className="truncate text-foreground hover:underline">{pr.replace('https://github.com/', '')}</a>{ticket && <button type="button" onClick={() => onNavigate(changesHref(ticket.key, pr, 'discord'))} className="flex-none border-0 bg-transparent p-0 font-semibold text-accent hover:underline">Changes</button>}</span> : '—'],
    thread.kind === 'pr'
      ? ['Reviewers', <span key="slots" className="flex flex-col gap-1"><Slots thread={thread} large /><span className="text-[0.66rem] whitespace-normal text-muted-foreground">{thread.onIt.length ? `On it: ${thread.onIt.join(', ')}` : 'Nobody on it'}</span>{thread.passes.length > 0 && <span className="text-[0.66rem] whitespace-normal text-muted-foreground">Pass: {thread.passes.join(', ')}</span>}</span>]
      : ['On it', thread.claim ? `${thread.claim.mine ? 'You' : thread.claim.author} · ${wib(thread.claim.at)}${thread.claimerRepliedAt ? '' : ' · no update since'}` : 'Nobody yet'],
    ['Your last reply', thread.repliedAt ? wib(thread.repliedAt) : 'None'],
  ];

  return (
    <section className={cn('flex min-w-0 flex-col', !picked && 'max-[960px]:hidden')} aria-label="Thread">
      <div className="border-b border-border px-5 py-4">
        {picked && <button type="button" onClick={onBack} className="mb-2 hidden min-h-11 border-0 bg-transparent p-0 text-xs text-secondary-foreground max-[960px]:block">‹ Discord</button>}
        <h2 className="mb-3 font-display text-lg leading-snug font-bold"><Title text={thread.title} /></h2>
        <dl className="grid grid-cols-5 gap-x-7 gap-y-1 text-[0.72rem] max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
          {facts.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 truncate text-foreground">{value}</dd></div>)}
        </dl>
      </div>
      <div className="flex-1 py-1.5">
        {earlier > 0 && <p className="mx-5 my-1.5 pl-11 text-[0.68rem] text-muted-foreground">{earlier} earlier {earlier === 1 ? 'message' : 'messages'} · Open in Discord to read them</p>}
        {thread.messages.map((message, index) => {
          const label = wibDay(message.at);
          const divider = index === 0 || label !== wibDay(thread.messages[index - 1].at);
          const hit = message.mentions.some((mention) => mention.me) && !message.mine;
          return (
            <React.Fragment key={message.id}>
              {divider && <p className="mx-5 my-2.5 flex items-center gap-2.5 font-mono text-[0.62rem] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">{label.toUpperCase()}</p>}
              <div className={cn('grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-l-2 border-transparent px-5 py-1.5', hit && 'border-status-warn bg-status-warn/[0.08]')}>
                <img src={message.avatar} alt="" loading="lazy" className="size-8 rounded-full bg-surface-2" />
                <div className="min-w-0">
                  <p className="text-[0.76rem] font-semibold">{message.mine ? 'You' : message.author}<time className="ml-2 font-mono text-[0.6rem] font-normal text-muted-foreground">{wibTime(message.at)}</time></p>
                  <div className="mt-0.5 break-words text-[0.8rem] leading-relaxed text-secondary-foreground"><Markdown text={discordMarkdown(message)} overrides={MESSAGE_MARKDOWN} /></div>
                  {message.attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{message.attachments.map((file) => {
                    const images = message.attachments.filter(isImage);
                    return <Attachment key={file.url} file={file} onView={() => setViewing({ files: images, index: images.indexOf(file) })} onRead={() => setReading(file)} />;
                  })}</div>}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-0 px-5 py-3">
        <p className="text-[0.74rem] text-secondary-foreground"><b className={cn('font-semibold', needsYou(thread) ? 'text-status-warn' : 'text-foreground')}>{STATE_LABEL[thread.state] ?? thread.state}.</b> {thread.why}{thread.dismissed ? ' · marked done' : ''}</p>
        <div className="flex flex-wrap gap-2">
          {thread.kind === 'pr' && pr
            ? <Button size="sm" onClick={() => window.open(pr, '_blank', 'noopener')}>Open PR</Button>
            : ticket && <Button size="sm" onClick={() => onTicketClick(ticket.key)}>Open ticket</Button>}
          {!isDone(thread) && <Button size="sm" variant="ghost" onClick={onDismiss}>Mark done</Button>}
          <Button size="sm" variant="primary" onClick={() => window.open(thread.url, '_blank', 'noopener')}>Open in Discord<ExternalLink size={13} aria-hidden="true" /></Button>
        </div>
      </div>
      {reading && <TextViewer file={reading} onClose={() => setReading(null)} />}
      {viewing && <ImageViewer files={viewing.files} index={viewing.index} onIndex={(index) => setViewing({ ...viewing, index })} onClose={() => setViewing(null)} />}
    </section>
  );
};

export default DiscordPage;
