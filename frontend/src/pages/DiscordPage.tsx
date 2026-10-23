import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { GET_DISCORD_THREADS } from '../graphql/queries';
import { ADD_DISCORD_CHANNEL, DISMISS_DISCORD_THREAD, REFRESH_DISCORD, REMOVE_DISCORD_CHANNEL, UPDATE_DISCORD_CHANNEL } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button, Input, Page, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { pageOf } from '../agents/runs';
import { ALL, KINDS, STATE_LABEL, VIEWS, ago, channelLabel, channelTabs, countFor, fileSize, isDone, mentionParts, needsYou, threadsFor, type ChannelKind, type ChannelTab, type DiscordChannel, type DiscordThread, type ThreadView } from '../lib/discordThreads';

interface DiscordPageProps { onTicketClick: (key: string) => void; onNavigate: (path: string) => void }

const PAGE_SIZE = 20;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const stamp = (iso: string) => `${day(iso)} ${time(iso)}`;
const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

const selectedFromUrl = () => new URLSearchParams(window.location.search).get('thread');

const writeFeed = (field: string) => (cache: any, result: any) => {
  if (result.data?.[field]) cache.writeQuery({ query: GET_DISCORD_THREADS, data: { discordThreads: result.data[field] } });
};

/** Threads of the followed Discord channels: a list on the left, the open thread on the right. */
const DiscordPage: React.FC<DiscordPageProps> = ({ onTicketClick, onNavigate }) => {
  const { data, loading, error } = useQuery(GET_DISCORD_THREADS, { ...CACHED_QUERY_OPTIONS, pollInterval: 60000 });
  const [refresh, { loading: refreshing }] = useMutation(REFRESH_DISCORD, { update: writeFeed('refreshDiscord') });
  const [dismiss] = useMutation(DISMISS_DISCORD_THREAD, { refetchQueries: ['GetDiscordThreads'] });
  const [chosenTab, setTab] = useState<ChannelTab>(ALL);
  const [managing, setManaging] = useState(false);
  const [view, setView] = useState<ThreadView>('needs');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string | null>(selectedFromUrl);
  const now = new Date();

  const feed = data?.discordThreads;
  const rows: DiscordThread[] = useMemo(() => feed?.rows ?? [], [feed]);
  const channels: DiscordChannel[] = useMemo(() => feed?.channels ?? [], [feed]);
  const tabs = channelTabs(channels);
  const tab = tabs.some((entry) => entry.id === chosenTab) ? chosenTab : ALL;
  const shown = threadsFor(rows, tab, view);
  const listed = pageOf(shown, page, PAGE_SIZE);
  const selected = rows.find((row) => row.id === picked) ?? listed.items[0] ?? null;

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
  const pickTab = (next: ChannelTab) => { setTab(next); setPage(1); };
  const pickView = (next: ThreadView) => { setView(next); setPage(1); };
  const turn = countFor(rows, tab, 'needs');
  const labelOf = (row: DiscordThread) => {
    const channel = channels.find((entry) => entry.id === row.channelId);
    return channel ? channelLabel(channel) : row.channel;
  };

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
            ? <span className="text-status-conflict" role="alert">Last sync failed: {feed.error}{feed.syncedAt ? ` · showing ${stamp(feed.syncedAt)}` : ''}</span>
            : <span className="text-muted-foreground">{feed.syncedAt ? `Synced ${time(feed.syncedAt)}` : 'Not synced yet'}</span>}
          <Button size="sm" variant={managing ? 'primary' : 'default'} onClick={() => setManaging(!managing)} aria-expanded={managing}><Settings2 size={14} aria-hidden="true" />Channels</Button>
          <Button size="sm" onClick={() => void refresh()} disabled={refreshing || !feed?.configured}><RefreshCw size={14} className={cn(refreshing && 'animate-spin')} aria-hidden="true" />{refreshing ? 'Syncing' : 'Refresh'}</Button>
        </div>
      </header>

      {(managing || channels.length === 0) && <ChannelManager channels={channels} configured={Boolean(feed?.configured)} />}

      <div className="grid min-h-[640px] grid-cols-[400px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-background max-[960px]:grid-cols-1">
        <section className={cn('flex min-w-0 flex-col border-r border-border max-[960px]:border-r-0', picked && 'max-[960px]:hidden')} aria-label="Threads">
          <div className="flex gap-4 overflow-x-auto border-b border-border px-4" role="tablist" aria-label="Forum">
            {tabs.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => pickTab(entry.id)} className={cn('min-h-11 whitespace-nowrap border-0 border-b-2 bg-transparent px-0 pt-2 text-xs font-medium', tab === entry.id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {entry.label} <span className="font-mono text-[0.64rem] tabular-nums">{countFor(rows, entry.id, view)}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{turn === 0 ? 'Nothing needs you' : `${turn} ${turn === 1 ? 'needs' : 'need'} you`}</span>
            <Select aria-label="Show" className="h-8 w-36 text-xs max-[760px]:h-11" value={view} onValueChange={(value) => pickView(value as ThreadView)} options={VIEWS.map((option) => ({ value: option.id, label: option.label }))} />
          </div>
          <div className="flex-1">
            {listed.items.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">{view === 'needs' ? 'No thread needs you here.' : 'No threads here.'}</p>}
            {listed.items.map((row) => {
              const fresh = needsYou(row) && !row.older;
              return (
                <button key={row.id} type="button" onClick={() => open(row.id)} aria-current={selected?.id === row.id ? 'true' : undefined}
                  className={cn('grid w-full grid-cols-[10px_minmax(0,1fr)_auto] gap-2.5 border-0 border-b border-l-2 border-border border-l-transparent bg-transparent py-2.5 pr-4 pl-3.5 text-left text-foreground hover:bg-surface-0', selected?.id === row.id && 'border-l-accent bg-surface-1')}>
                  <span className={cn('mt-1.5 size-[7px] rounded-full', fresh ? 'bg-status-warn' : needsYou(row) ? 'border border-status-warn' : 'border border-border-glow')} aria-label={fresh ? 'Needs you' : undefined} />
                  <span className="min-w-0">
                    <strong className={cn('block truncate text-[0.8rem]', fresh ? 'font-semibold' : 'font-medium')}>{row.title}</strong>
                    <small className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">{labelOf(row)} · {STATE_LABEL[row.state] ?? row.state}{row.tickets[0] ? <> · <span className="font-mono text-accent">{row.tickets[0].key}</span></> : ''}</small>
                  </span>
                  <time className="pt-0.5 font-mono text-[0.62rem] text-muted-foreground">{ago(row.lastActivity, now)}</time>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{listed.from === 0 ? '0 threads' : `${listed.from}–${listed.to} of ${shown.length}`}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={listed.page <= 1} onClick={() => setPage(listed.page - 1)} aria-label="Previous page"><ChevronLeft size={14} aria-hidden="true" />Prev</Button>
              <span className="font-mono tabular-nums">{listed.page} / {listed.pages}</span>
              <Button size="sm" variant="ghost" disabled={listed.page >= listed.pages} onClick={() => setPage(listed.page + 1)} aria-label="Next page">Next<ChevronRight size={14} aria-hidden="true" /></Button>
            </div>
          </div>
        </section>

        {selected ? <ThreadPane thread={selected} channel={labelOf(selected)} onBack={back} picked={Boolean(picked)} onTicketClick={onTicketClick} onDismiss={() => void dismiss({ variables: { id: selected.id, lastActivity: selected.lastActivity } })} />
          : <p className="p-6 text-sm text-muted-foreground max-[960px]:hidden">Pick a thread.</p>}
      </div>
    </Page>
  );
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
          <span className="min-w-0"><strong className={cn('block truncate font-medium', !channel.enabled && 'text-muted-foreground line-through')}>{channelLabel(channel)}</strong><small className="font-mono text-[0.62rem] text-muted-foreground">{channel.id}{channel.thread ? ' · thread' : ''}</small></span>
          <Select aria-label={`Kind of ${channelLabel(channel)}`} className="h-8 text-xs max-[760px]:col-span-2 max-[760px]:h-11" value={channel.kind} onValueChange={(value) => void change({ variables: { id: channel.id, kind: value, enabled: channel.enabled } })} options={kindOptions} />
          <Button size="sm" variant="ghost" onClick={() => void change({ variables: { id: channel.id, kind: channel.kind, enabled: !channel.enabled } })}>{channel.enabled ? 'Turn off' : 'Turn on'}</Button>
          <Button size="sm" variant="ghost" aria-label={`Remove ${channelLabel(channel)}`} onClick={() => void remove({ variables: { id: channel.id } })}><Trash2 size={14} aria-hidden="true" /></Button>
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

const ThreadPane: React.FC<{ thread: DiscordThread; channel: string; picked: boolean; onBack: () => void; onTicketClick: (key: string) => void; onDismiss: () => void }> = ({ thread, channel, picked, onBack, onTicketClick, onDismiss }) => {
  const earlier = Math.max(0, thread.messageCount - thread.messages.length);
  const ticket = thread.tickets[0];
  const pr = thread.prs[0];
  const facts: Array<[string, React.ReactNode]> = [
    ['Ticket', thread.tickets.length ? thread.tickets.map((item) => <span key={item.key} className="mr-2"><span className="font-mono text-accent">{item.key}</span>{item.status ? ` · ${item.status}` : ''}{item.assignee ? ` · ${item.assignee}` : ''}</span>) : 'None in the title or tags'],
    ['Pull request', pr ? <a href={pr} target="_blank" rel="noreferrer" className="text-foreground hover:underline">{pr.replace('https://github.com/', '')}</a> : '—'],
    ['On it', thread.claim ? `${thread.claim.mine ? 'You' : thread.claim.author} · ${stamp(thread.claim.at)}${thread.claimerRepliedAt ? '' : ' · no update since'}` : 'Nobody yet'],
    ['Your last reply', thread.repliedAt ? stamp(thread.repliedAt) : 'None'],
  ];

  return (
    <section className={cn('flex min-w-0 flex-col', !picked && 'max-[960px]:hidden')} aria-label="Thread">
      <div className="border-b border-border px-5 py-4">
        {picked && <button type="button" onClick={onBack} className="mb-2 hidden min-h-11 border-0 bg-transparent p-0 text-xs text-secondary-foreground max-[960px]:block">‹ Discord</button>}
        <p className="text-[0.7rem] text-muted-foreground">{channel}{thread.createdBy ? ` · opened by ${thread.createdBy}` : ''} · {day(thread.createdAt)} · {thread.messageCount} messages{thread.tags.length ? ` · tags: ${thread.tags.join(', ')}` : ''}</p>
        <h2 className="mt-1.5 mb-3 font-display text-lg leading-snug font-bold">{thread.title}</h2>
        <dl className="grid grid-cols-4 gap-x-7 gap-y-1 text-[0.72rem] max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
          {facts.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 truncate text-foreground">{value}</dd></div>)}
        </dl>
      </div>
      <div className="flex-1 py-1.5">
        {earlier > 0 && <p className="mx-5 my-1.5 pl-11 text-[0.68rem] text-muted-foreground">{earlier} earlier {earlier === 1 ? 'message' : 'messages'} · Open in Discord to read them</p>}
        {thread.messages.map((message, index) => {
          const label = day(message.at);
          const divider = index === 0 || label !== day(thread.messages[index - 1].at);
          const hit = message.mentions.some((mention) => mention.me) && !message.mine;
          return (
            <React.Fragment key={message.id}>
              {divider && <p className="mx-5 my-2.5 flex items-center gap-2.5 font-mono text-[0.62rem] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">{label.toUpperCase()}</p>}
              <div className={cn('grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-l-2 border-transparent px-5 py-1.5', hit && 'border-status-warn bg-status-warn/[0.08]')}>
                <span className={cn('grid size-8 place-items-center rounded-full text-[0.62rem] font-bold', message.mine ? 'bg-accent text-black' : 'bg-surface-2 text-secondary-foreground')} aria-hidden="true">{initials(message.mine ? 'You' : message.author)}</span>
                <div className="min-w-0">
                  <p className="text-[0.76rem] font-semibold">{message.mine ? 'You' : message.author}<time className="ml-2 font-mono text-[0.6rem] font-normal text-muted-foreground">{time(message.at)}</time></p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[0.8rem] leading-relaxed text-secondary-foreground">
                    {mentionParts(message).map((part, index) => part.mention
                      ? <span key={index} className={cn('rounded-[3px] px-0.5', part.mention === 'me' ? 'bg-status-warn/15 text-status-warn' : 'bg-status-discord-bg text-status-discord')}>{part.text}</span>
                      : <React.Fragment key={index}>{part.text}</React.Fragment>)}
                  </p>
                  {message.attachments.map((file) => <p key={file.name} className="mt-1.5 inline-flex gap-2.5 rounded-sm border border-border bg-surface-0 px-2.5 py-1.5 text-[0.7rem] text-secondary-foreground"><b className="font-medium text-foreground">{file.name}</b>{fileSize(file.size)}{file.type ? ` · ${file.type.split('/')[0]}` : ''}</p>)}
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
    </section>
  );
};

export default DiscordPage;
