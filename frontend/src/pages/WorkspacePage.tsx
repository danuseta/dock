import React, { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client';
import { ArrowLeft, ChevronRight, File, Folder, FolderOpen, Home, Link2Off, Lock } from 'lucide-react';
import { Checkbox, Input, Page } from '../components/ui';
import { Markdown } from '../chat/Markdown';
import { GET_WORKSPACE_DIR, GET_WORKSPACE_FILE } from '../graphql/queries';
import { formatSize } from '../lib/blackboard';
import { cn } from '../lib/cn';

interface Entry { name: string; path: string; kind: 'dir' | 'file' | 'link' | 'other'; size: number | null; modifiedAt: string | null; masked: boolean }
interface Dir { path: string; parent: string | null; truncated: boolean; entries: Entry[] }
interface FileContent { path: string; size: number; modifiedAt: string; masked: boolean; binary: boolean; truncated: boolean; text: string | null }

/** ?path= is the folder, &file= the file open in it. */
function readQuery() {
  const params = new URLSearchParams(window.location.search);
  return { path: params.get('path') ?? '', file: params.get('file') };
}

function writeQuery(path: string, file: string | null) {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (file) params.set('file', file);
  const search = params.toString();
  window.history.replaceState(window.history.state, '', `/workspace${search ? `?${search}` : ''}`);
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const iconOf = (entry: Entry) => (entry.masked ? Lock : entry.kind === 'dir' ? Folder : entry.kind === 'link' ? Link2Off : File);

/** The folder path as links: ~ / projects / app. */
const Crumbs: React.FC<{ path: string; onOpen: (path: string) => void }> = ({ path, onOpen }) => {
  const parts = path ? path.split('/') : [];
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-0.5 font-mono text-[0.72rem]" aria-label="Folder path">
      <button type="button" onClick={() => onOpen('')} className="inline-flex items-center gap-1 rounded-xs border-0 bg-transparent px-1 py-0.5 text-secondary-foreground hover:bg-surface-1 hover:text-foreground"><Home size={12} aria-hidden="true" />~</button>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          <ChevronRight size={12} aria-hidden="true" className="text-muted-foreground" />
          <button type="button" onClick={() => onOpen(parts.slice(0, index + 1).join('/'))} aria-current={index === parts.length - 1 ? 'page' : undefined} className="rounded-xs border-0 bg-transparent px-1 py-0.5 text-secondary-foreground hover:bg-surface-1 hover:text-foreground aria-[current=page]:text-foreground">{part}</button>
        </React.Fragment>
      ))}
    </nav>
  );
};

const FileView: React.FC<{ path: string }> = ({ path }) => {
  const { data, loading, error } = useQuery<{ workspaceFile: FileContent }>(GET_WORKSPACE_FILE, { variables: { path }, fetchPolicy: 'network-only' });
  if (error) return <p className="p-6 text-sm text-status-conflict" role="alert">{error.message}</p>;
  const file = data?.workspaceFile;
  if (!file || loading) return <p className="p-6 text-sm text-muted-foreground" role="status">Loading {path}...</p>;
  if (file.masked) return <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Lock size={14} aria-hidden="true" />This file holds secrets, so its content is never shown.</p>;
  if (file.binary) return <p className="p-6 text-sm text-muted-foreground">A binary file of {formatSize(file.size)}. Only text files are shown here.</p>;
  return (
    <div className="min-w-0 px-6 py-5 text-[0.82rem] leading-relaxed text-secondary-foreground">
      {file.truncated && <p className="mb-4 rounded-xs border border-dashed border-border px-2.5 py-1.5 font-mono text-[0.66rem] text-muted-foreground">Only the first 512 KB of {formatSize(file.size)} is shown.</p>}
      {file.path.endsWith('.md')
        ? <div className="[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_th]:border-b [&_th]:border-border-glow [&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground"><Markdown text={file.text ?? ''} /></div>
        : <pre className="whitespace-pre-wrap font-mono text-[0.74rem] [overflow-wrap:anywhere]">{file.text}</pre>}
    </div>
  );
};

/** The workspace's home folder, read only: folders like `cd` and `ls`, one file at a time. Secrets are listed, never opened. */
const WorkspacePage: React.FC = () => {
  const [place, setPlace] = useState(readQuery);
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState('');
  const { data, loading, error } = useQuery<{ workspaceDir: Dir }>(GET_WORKSPACE_DIR, { variables: { path: place.path }, fetchPolicy: 'cache-and-network' });

  useEffect(() => { writeQuery(place.path, place.file); }, [place]);

  const open = (path: string) => { setQuery(''); setPlace({ path, file: null }); };
  const dir = data?.workspaceDir?.path === place.path ? data.workspaceDir : null;
  const needle = query.trim().toLowerCase();
  const entries = (dir?.entries ?? []).filter((entry) => (showHidden || !entry.name.startsWith('.')) && (!needle || entry.name.toLowerCase().includes(needle)));
  const hidden = (dir?.entries ?? []).filter((entry) => entry.name.startsWith('.')).length;
  const pick = (entry: Entry) => {
    if (entry.masked && entry.kind === 'dir') return;
    if (entry.kind === 'dir') open(entry.path);
    else if (entry.kind === 'file') setPlace({ path: place.path, file: entry.path });
  };

  return (
    <Page width="full">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Workspace</h1>
          <p className="mt-1 text-xs text-muted-foreground">The folders and files of this workspace, from the home folder down. Keys, logins and .env files are listed but never opened.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-xs border border-border px-2 py-1 text-[0.68rem] text-muted-foreground"><Lock size={12} aria-hidden="true" />Read-only</span>
      </header>

      <div className="grid min-h-[640px] grid-cols-[minmax(280px,380px)_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-background max-[760px]:grid-cols-1">
        <section className={cn('flex min-w-0 flex-col border-r border-border max-[760px]:border-r-0', place.file && 'max-[760px]:hidden')} aria-label="Folder">
          <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
            <Crumbs path={place.path} onOpen={open} />
            <Input type="search" aria-label="Filter this folder" className="h-8 text-xs max-[760px]:h-11" placeholder="Filter this folder" value={query} onChange={(event) => setQuery(event.target.value)} />
            <label className="flex items-center gap-2 text-[0.7rem] text-muted-foreground"><Checkbox checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />Show hidden ({hidden})</label>
          </div>
          <div className="max-h-[calc(100dvh-18rem)] min-h-[320px] flex-1 overflow-y-auto py-1 max-[760px]:max-h-none">
            {error && <p className="px-4 py-4 text-sm text-status-conflict" role="alert">{error.message}</p>}
            {!dir && loading && <p className="px-4 py-4 text-sm text-muted-foreground" role="status">Loading {place.path || '~'}...</p>}
            {dir && dir.parent !== null && (
              <button type="button" onClick={() => open(dir.parent ?? '')} className="flex w-full items-center gap-2 border-0 bg-transparent px-3.5 py-1.5 text-left text-[0.76rem] text-secondary-foreground hover:bg-surface-1 max-[760px]:min-h-11">
                <FolderOpen size={14} aria-hidden="true" className="flex-none" /><span>..</span>
              </button>
            )}
            {dir && entries.length === 0 && <p className="px-4 py-4 text-sm text-muted-foreground">{dir.entries.length ? 'Nothing matches.' : 'This folder is empty.'}</p>}
            {entries.map((entry) => {
              const Icon = iconOf(entry);
              const closed = entry.masked && entry.kind === 'dir';
              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => pick(entry)}
                  disabled={closed || entry.kind === 'other' || entry.kind === 'link'}
                  title={entry.masked ? 'Holds secrets: never opened' : entry.kind === 'link' ? 'A link whose target is gone' : undefined}
                  aria-current={place.file === entry.path ? 'true' : undefined}
                  className={cn('grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2 border-0 bg-transparent px-3.5 py-1.5 text-left text-[0.76rem] hover:bg-surface-1 disabled:cursor-default disabled:hover:bg-transparent max-[760px]:min-h-11', entry.kind === 'dir' ? 'text-foreground' : 'text-secondary-foreground', entry.masked && 'text-muted-foreground', place.file === entry.path && 'bg-surface-1 text-foreground')}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span className="truncate">{entry.name}</span>
                  <span className="font-mono text-[0.6rem] text-muted-foreground">{entry.masked ? 'secret' : entry.size !== null ? formatSize(entry.size) : ''}</span>
                </button>
              );
            })}
            {dir?.truncated && <p className="px-4 py-3 text-xs text-muted-foreground">Only the first 2,000 items are listed.</p>}
          </div>
        </section>

        <section className={cn('flex min-w-0 flex-col', !place.file && 'max-[760px]:hidden')} aria-label="File">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2">
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[0.72rem]">
              <button type="button" aria-label="Back to the folder" onClick={() => setPlace({ path: place.path, file: null })} className="hidden border-0 bg-transparent p-0 text-muted-foreground max-[760px]:inline"><ArrowLeft size={12} aria-hidden="true" /></button>
              <span className="truncate">{place.file ?? ''}</span>
            </span>
            {place.file && <span className="font-mono text-[0.62rem] text-muted-foreground">{when(dir?.entries.find((entry) => entry.path === place.file)?.modifiedAt ?? null)}</span>}
          </div>
          <div className="max-h-[calc(100dvh-16rem)] min-h-[320px] flex-1 overflow-y-auto max-[760px]:max-h-none">
            {place.file
              ? <FileView path={place.file} />
              : (
                <div className="grid h-full min-h-[320px] place-items-center text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2"><Folder size={28} aria-hidden="true" /><p className="text-sm">Pick a file to read it.</p></div>
                </div>
              )}
          </div>
        </section>
      </div>
    </Page>
  );
};

export default WorkspacePage;
