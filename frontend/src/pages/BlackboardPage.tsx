import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { ArrowLeft, ClipboardList, Download, File, FileCheck2, Folder, Image as ImageIcon, Info, List, Lock, MapPin, HelpCircle, Scale, ScrollText, Video } from 'lucide-react';
import { Button, Checkbox, Input, Page } from '../components/ui';
import { Markdown } from '../chat/Markdown';
import { GET_ORCHESTRATIONS, GET_RUN_THINKING } from '../graphql/queries';
import { ThinkingList } from '../agents/ThinkingList';
import { filterRows, rowsMarkdown, type RowFilter, type ThinkingRow } from '../agents/thinking';
import { stageLabel } from '../agents/runs';
import { cn } from '../lib/cn';
import { LOG_ENTRY, fetchFiles, fetchText, fetchTickets, fileUrl, formatSize, groupFiles, withoutComments, type BlackboardFile, type BlackboardTicket } from '../lib/blackboard';

interface RunInfo { key: string; title: string | null; stage: string }

const FILE_ICON: Record<string, React.ElementType> = { 'NOW.md': MapPin, 'review.md': FileCheck2, 'decisions.md': Scale, 'issues.md': HelpCircle, 'status.md': List };
const iconFor = (file: BlackboardFile) => FILE_ICON[file.path] ?? (file.kind === 'image' ? ImageIcon : file.kind === 'video' ? Video : File);

const STAGE_TONE: Record<string, string> = {
  done: 'bg-status-merged-bg text-status-merged',
  evidence: 'bg-status-warn/10 text-status-warn',
  blocked: 'bg-status-conflict-bg text-status-conflict',
};

const when = (iso: string) => {
  const at = new Date(iso);
  const today = new Date();
  return at.toDateString() === today.toDateString()
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const readQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return { key: params.get('key'), file: params.get('file') };
};

const writeQuery = (key: string | null, file: string | null) => {
  const params = new URLSearchParams();
  if (key) params.set('key', key);
  if (file) params.set('file', file);
  const search = params.toString();
  window.history.replaceState({}, '', `/blackboard${search ? `?${search}` : ''}`);
};

/** One file: rendered markdown, plain text, an image, a video, or a gallery for a folder of images. */
const FileView: React.FC<{ ticket: string; file: BlackboardFile | null; folder: { name: string; files: BlackboardFile[] } | null; onPick: (path: string) => void }> = ({ ticket, file, folder, onPick }) => {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    setError(null);
    if (!file || file.kind !== 'text') return undefined;
    let gone = false;
    fetchText(ticket, file.path).then((body) => { if (!gone) setText(body); }, (failure: Error) => { if (!gone) setError(failure.message); });
    return () => { gone = true; };
  }, [ticket, file]);

  if (folder) {
    const images = folder.files.filter((entry) => entry.kind === 'image');
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-4">
        {folder.files.map((entry) => (
          <button key={entry.path} type="button" onClick={() => onPick(entry.path)} className="overflow-hidden rounded-sm border border-border bg-surface-0 text-left hover:border-border-glow">
            {entry.kind === 'image'
              ? <img src={fileUrl(ticket, entry.path)} alt={entry.path} loading="lazy" className="aspect-[16/10] w-full bg-surface-1 object-cover object-top" />
              : <span className="grid aspect-[16/10] place-items-center bg-surface-1 text-muted-foreground"><File size={20} aria-hidden="true" /></span>}
            <span className="block truncate px-2 py-1.5 font-mono text-[0.66rem] text-secondary-foreground">{entry.path.slice(folder.name.length + 1)}</span>
          </button>
        ))}
        {images.length === 0 && folder.files.length === 0 && <p className="text-sm text-muted-foreground">This folder is empty.</p>}
      </div>
    );
  }
  if (!file) return <p className="p-6 text-sm text-muted-foreground">Pick a file to read it.</p>;
  if (file.kind === 'image') return <div className="grid place-items-center p-4"><img src={fileUrl(ticket, file.path)} alt={file.path} className="max-h-[calc(100dvh-16rem)] max-w-full rounded-xs object-contain" /></div>;
  if (file.kind === 'video') return <div className="p-4"><video src={fileUrl(ticket, file.path)} controls className="max-h-[calc(100dvh-16rem)] w-full rounded-xs bg-black" /></div>;
  if (file.kind === 'other') return <p className="p-6 text-sm text-muted-foreground">This file type is not shown here. Download it to open it.</p>;
  if (error) return <p className="p-6 text-sm text-status-conflict" role="alert">{error}</p>;
  if (text === null) return <p className="p-6 text-sm text-muted-foreground" role="status">Loading {file.path}...</p>;
  return (
    <div className="min-w-0 px-6 py-5 text-[0.82rem] leading-relaxed text-secondary-foreground">
      {file.generated && (
        <p className="mb-4 flex items-center gap-1.5 rounded-xs border border-dashed border-border px-2.5 py-1.5 font-mono text-[0.66rem] text-muted-foreground">
          <Info size={12} aria-hidden="true" />Rendered from the ledger by status.cjs. Do not edit it; change the ledger with status.cjs.
        </p>
      )}
      {file.path.endsWith('.md')
        ? <div className="[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_th]:border-b [&_th]:border-border-glow [&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground"><Markdown text={withoutComments(text)} /></div>
        : <pre className="whitespace-pre-wrap font-mono text-[0.74rem] [overflow-wrap:anywhere]">{text}</pre>}
    </div>
  );
};



/** The execution log of the ticket's run on this DOCK: stages, gates, agents, tools and the owner's actions, newest first. */
const LOG_FILTERS: Array<[RowFilter, string]> = [['all', 'All'], ['owner', 'Owner'], ['agents', 'Agents'], ['git', 'Git / PR'], ['problems', 'Problems']];

/** The ticket's audit log: every agent's asks, decisions and actions, the owner's answers, git and PR steps, across every round. */
const LogView: React.FC<{ ticket: string }> = ({ ticket }) => {
  const [filter, setFilter] = useState<RowFilter>('all');
  const { data, loading, error } = useQuery<{ runThinking: ThinkingRow[] }>(GET_RUN_THINKING, { variables: { key: ticket }, fetchPolicy: 'cache-and-network', pollInterval: 30000 });
  if (error && !data) return <p className="p-6 text-sm text-status-conflict" role="alert">{error.message}</p>;
  if (!data && loading) return <p className="p-6 text-sm text-muted-foreground" role="status">Loading the log...</p>;
  const all = data?.runThinking ?? [];
  if (all.length === 0) return <p className="p-6 text-sm text-muted-foreground">No run recorded for this ticket on this DOCK, or it has no log yet.</p>;
  const rows = filterRows(all, filter, null);
  const exportMarkdown = () => {
    const blob = new Blob([rowsMarkdown(ticket, rows)], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${ticket}-log${filter === 'all' ? '' : `-${filter}`}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="inline-flex flex-wrap rounded-sm border border-border bg-surface-1 p-0.5" role="group" aria-label="Log filter">
          {LOG_FILTERS.map(([id, label]) => {
            const count = filterRows(all, id, null).length;
            return <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('h-6 rounded-xs px-2.5 font-display text-[0.68rem] font-semibold text-secondary-foreground max-[760px]:h-11', filter === id && 'bg-accent text-black')}>{label} <span className="font-mono font-medium opacity-70">{count}</span></button>;
          })}
        </div>
        <Button size="sm" className="ml-auto" onClick={exportMarkdown}><Download size={13} aria-hidden="true" />Export .md</Button>
      </div>
      <div className="bg-surface-0 px-4 pb-4">
        <ThinkingList runKey={ticket} rows={rows} allRows={all} empty="Nothing matches this filter." />
      </div>
    </div>
  );
};

/** The agents' per-ticket blackboard on this workspace, read-only: tickets, their files, and one file at a time. */
const BlackboardPage: React.FC = () => {
  const [initial] = useState(readQuery);
  const [tickets, setTickets] = useState<BlackboardTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [picked, setPicked] = useState<string | null>(initial.key);
  const [files, setFiles] = useState<BlackboardFile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initial.file);
  const { data } = useQuery<{ orchestrations: RunInfo[] }>(GET_ORCHESTRATIONS, { fetchPolicy: 'cache-and-network' });
  const runs = useMemo(() => new Map((data?.orchestrations ?? []).map((run) => [run.key.toUpperCase(), run])), [data]);

  useEffect(() => {
    fetchTickets().then(setTickets, (failure: Error) => setError(failure.message));
  }, []);

  useEffect(() => {
    setFiles(null);
    if (!picked) return undefined;
    let gone = false;
    fetchFiles(picked).then((found) => { if (!gone) setFiles(found ?? []); }, (failure: Error) => { if (!gone) setError(failure.message); });
    return () => { gone = true; };
  }, [picked]);

  useEffect(() => { writeQuery(picked, selected); }, [picked, selected]);

  const shown = (tickets ?? []).filter((ticket) => {
    const run = runs.get(ticket.key);
    if (hideDone && run?.stage === 'done') return false;
    const needle = query.trim().toLowerCase();
    return !needle || ticket.key.toLowerCase().includes(needle) || (run?.title ?? '').toLowerCase().includes(needle);
  });
  const groups = groupFiles(files ?? []);
  const file = (files ?? []).find((entry) => entry.path === selected) ?? null;
  const folder = selected && !file ? groups.find((group) => group.folder === selected) ?? null : null;
  const pickTicket = (key: string) => { setPicked(key); setSelected('NOW.md'); };

  return (
    <Page width="full" className="max-[760px]:pb-28">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Blackboard</h1>
          <p className="mt-1 text-xs text-muted-foreground">The agents' working board per ticket: where it stands, decisions, review notes and evidence. Read-only.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-xs border border-border px-2 py-1 text-[0.68rem] text-muted-foreground"><Lock size={12} aria-hidden="true" />Read-only</span>
      </header>
      {error && <p className="mb-4 text-xs text-status-conflict" role="alert">{error}</p>}

      <div className="grid min-h-[640px] grid-cols-[260px_240px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-background max-[1100px]:grid-cols-[240px_minmax(0,1fr)] max-[760px]:grid-cols-1">
        <section className={cn('flex min-w-0 flex-col border-r border-border', picked && 'max-[760px]:hidden')} aria-label="Tickets">
          <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
            <Input type="search" aria-label="Search tickets" className="h-8 text-xs max-[760px]:h-11" placeholder="Search key or title" value={query} onChange={(event) => setQuery(event.target.value)} />
            <label className="flex items-center gap-2 text-[0.7rem] text-muted-foreground max-[760px]:min-h-11 max-[760px]:text-xs"><Checkbox checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} />Hide done</label>
          </div>
          <div className="max-h-[calc(100dvh-16rem)] min-h-[320px] flex-1 overflow-y-auto max-[760px]:max-h-none">
            {tickets === null && !error && <p className="px-4 py-6 text-sm text-muted-foreground" role="status">Loading tickets...</p>}
            {tickets !== null && shown.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">{tickets.length === 0 ? 'No ticket has a blackboard yet.' : 'No ticket matches.'}</p>}
            {shown.map((ticket) => {
              const run = runs.get(ticket.key);
              return (
                <button key={`${ticket.epic ?? ''}/${ticket.key}`} type="button" onClick={() => pickTicket(ticket.key)} aria-current={picked === ticket.key ? 'true' : undefined} className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 border-0 border-b border-border bg-transparent px-3.5 py-2.5 text-left hover:bg-surface-1', picked === ticket.key && 'bg-surface-1 shadow-[inset_2px_0_0_var(--color-accent)]', ticket.epic && 'pl-6')}>
                  <span className="font-mono text-xs font-bold">{ticket.key}</span>
                  {run ? <span className={cn('self-start rounded-xs px-1.5 py-px font-mono text-[0.6rem] font-bold max-[760px]:text-xs', STAGE_TONE[run.stage] ?? 'bg-surface-2 text-secondary-foreground')}>{stageLabel(run.stage)}</span> : <span />}
                  <span className="col-span-2 truncate text-[0.72rem] text-secondary-foreground max-[760px]:line-clamp-2 max-[760px]:whitespace-normal">{run?.title ?? (ticket.epic ? `in ${ticket.epic}` : 'No run on this DOCK')}</span>
                  <span className="col-span-2 font-mono text-[0.6rem] text-muted-foreground max-[760px]:text-xs">{ticket.files} files · {when(ticket.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={cn('flex min-w-0 flex-col border-r border-border max-[760px]:border-r-0', (!picked || selected) && 'max-[760px]:hidden', !picked && 'max-[1100px]:hidden')} aria-label="Files">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5 font-mono text-[0.62rem] font-bold uppercase tracking-wide text-muted-foreground max-[760px]:text-xs">
            <button type="button" onClick={() => setPicked(null)} className="hidden items-center gap-1 border-0 bg-transparent p-0 text-muted-foreground max-[760px]:flex max-[760px]:min-h-11"><ArrowLeft size={12} aria-hidden="true" />Tickets</button>
            <span>{picked ?? 'Files'}</span><span>{files?.length ?? ''}</span>
          </div>
          <div className="max-h-[calc(100dvh-16rem)] flex-1 overflow-y-auto py-1.5 max-[760px]:max-h-none">
            {picked && files === null && <p className="px-4 py-4 text-sm text-muted-foreground" role="status">Loading files...</p>}
            {!picked && <p className="px-4 py-4 text-sm text-muted-foreground">Pick a ticket.</p>}
            {picked && (
              <button type="button" onClick={() => setSelected(LOG_ENTRY)} aria-current={selected === LOG_ENTRY ? 'true' : undefined} className={cn('flex w-full items-center gap-2 border-0 border-b border-border bg-transparent px-3.5 py-1.5 text-left text-[0.76rem] text-secondary-foreground hover:bg-surface-1', selected === LOG_ENTRY && 'bg-surface-1 text-foreground')}>
                <ScrollText size={14} aria-hidden="true" className="flex-none" /><span>Log</span><span className="ml-auto font-mono text-[0.6rem] text-muted-foreground">execution</span>
              </button>
            )}
            {groups.map((group) => group.folder === ''
              ? group.files.map((entry) => {
                  const Icon = iconFor(entry);
                  return (
                    <button key={entry.path} type="button" onClick={() => setSelected(entry.path)} aria-current={selected === entry.path ? 'true' : undefined} className={cn('flex w-full items-center gap-2 border-0 bg-transparent px-3.5 py-1.5 text-left text-[0.76rem] text-secondary-foreground hover:bg-surface-1', selected === entry.path && 'bg-surface-1 text-foreground')}>
                      <Icon size={14} aria-hidden="true" className="flex-none" /><span className="truncate">{entry.path}</span>
                      {entry.generated && <span className="rounded-xs border border-border px-1 font-mono text-[0.54rem] text-muted-foreground">gen</span>}
                      <span className="ml-auto font-mono text-[0.6rem] text-muted-foreground">{formatSize(entry.size)}</span>
                    </button>
                  );
                })
              : (
                <button key={group.folder} type="button" onClick={() => setSelected(group.folder)} aria-current={selected === group.folder ? 'true' : undefined} className={cn('flex w-full items-center gap-2 border-0 bg-transparent px-3.5 py-1.5 text-left text-[0.76rem] text-foreground hover:bg-surface-1', selected === group.folder && 'bg-surface-1')}>
                  {group.files.every((entry) => entry.kind === 'image') ? <ImageIcon size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
                  <span className="truncate">{group.folder}</span><span className="ml-auto font-mono text-[0.6rem] text-muted-foreground">{group.files.length}</span>
                </button>
              ))}
          </div>
        </section>

        <section className={cn('flex min-w-0 flex-col', !selected && 'max-[760px]:hidden', !picked && 'max-[1100px]:col-span-1')} aria-label="File">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2">
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[0.72rem]">
              <button type="button" onClick={() => setSelected(null)} className="hidden border-0 bg-transparent p-0 text-muted-foreground max-[760px]:inline-flex max-[760px]:min-h-11 max-[760px]:min-w-11 max-[760px]:items-center"><ArrowLeft size={12} aria-hidden="true" /></button>
              {picked && <span className="text-muted-foreground">{picked} /</span>}<span className="truncate">{selected === LOG_ENTRY ? 'Log' : selected ?? ''}</span>
            </span>
            <span className="flex items-center gap-3 font-mono text-[0.62rem] text-muted-foreground max-[760px]:text-xs">
              {file && <span>changed {when(file.updatedAt)}</span>}
              {file && picked && <a href={fileUrl(picked, file.path, true)} className="inline-flex items-center gap-1 text-secondary-foreground hover:text-foreground"><Download size={12} aria-hidden="true" />Download</a>}
            </span>
          </div>
          <div className="max-h-[calc(100dvh-16rem)] min-h-[320px] flex-1 overflow-y-auto max-[760px]:max-h-none">
            {picked && selected === LOG_ENTRY
              ? <LogView ticket={picked} />
              : picked
              ? <FileView ticket={picked} file={file} folder={folder ? { name: folder.folder, files: folder.files } : null} onPick={setSelected} />
              : (
                <div className="grid h-full min-h-[320px] place-items-center text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2"><ClipboardList size={28} aria-hidden="true" /><p className="text-sm">Pick a ticket to read its blackboard.</p></div>
                </div>
              )}
          </div>
        </section>
      </div>
    </Page>
  );
};

export default BlackboardPage;
