import React, { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, ChevronRight, File, FilePlus, Folder, FolderOpen, FolderPlus, Home, Link2Off, Lock, Pencil, Trash2, Upload } from 'lucide-react';
import { Button, Card, Checkbox, ConfirmDialog, Dialog, IconButton, Input, Page, Textarea } from '../components/ui';
import { Markdown } from '../chat/Markdown';
import { GET_WORKSPACE_DIR, GET_WORKSPACE_FILE, WORKSPACE_DELETE, WORKSPACE_MKDIR, WORKSPACE_RENAME } from '../graphql/queries';
import { apiOrigin } from '../lib/apollo';
import { formatSize } from '../lib/blackboard';
import { cn } from '../lib/cn';
import { joinPath, nameProblem, renamedPath } from '../lib/workspacePaths';

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

/** Writes a file's bytes: a new file, an upload, or with `expected` a save over the copy the editor opened. */
async function putFile(path: string, body: Blob | string, options: { replace?: boolean; expected?: string } = {}) {
  const query = new URLSearchParams({ path });
  if (options.replace) query.set('replace', '1');
  if (options.expected) query.set('expected', options.expected);
  const response = await fetch(`${apiOrigin}/api/workspace/file?${query.toString()}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/octet-stream', 'x-dock-upload': '1' },
    body,
  });
  if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? `The write failed (${response.status})`);
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

/** Asks for a name: a new folder, a new file, or a rename. */
const NameDialog: React.FC<{ title: string; label: string; initial: string; busy: boolean; error: string | null; onSubmit: (name: string) => void; onCancel: () => void }> = ({ title, label, initial, busy, error, onSubmit, onCancel }) => {
  const id = useId();
  const [name, setName] = useState(initial);
  const problem = nameProblem(name);
  return (
    <Dialog open onClose={() => !busy && onCancel()} dismissible={!busy} labelledBy={`${id}-title`}>
      <Card className="w-[min(440px,calc(100vw-2rem))] shadow-card">
        <form onSubmit={(event) => { event.preventDefault(); if (!problem) onSubmit(name.trim()); }}>
          <h2 id={`${id}-title`} className="font-display text-xl font-bold">{title}</h2>
          <label className="mt-4 block text-xs text-muted-foreground" htmlFor={`${id}-name`}>{label}</label>
          <Input id={`${id}-name`} className="mt-1 font-mono text-sm" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          {(error || (name && problem)) && <p className="mt-2 text-xs text-status-conflict" role="alert">{error ?? problem}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || Boolean(problem)}>{busy ? 'Saving...' : 'Save'}</Button>
          </div>
        </form>
      </Card>
    </Dialog>
  );
};

const FileView: React.FC<{ path: string; onSaved: () => void }> = ({ path, onSaved }) => {
  const { data, loading, error, refetch } = useQuery<{ workspaceFile: FileContent }>(GET_WORKSPACE_FILE, { variables: { path }, fetchPolicy: 'network-only' });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { setDraft(null); setSaveError(null); }, [path]);
  if (error) return <p className="p-6 text-sm text-status-conflict" role="alert">{error.message}</p>;
  const file = data?.workspaceFile;
  if (!file || loading) return <p className="p-6 text-sm text-muted-foreground" role="status">Loading {path}...</p>;
  if (file.masked) return <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Lock size={14} aria-hidden="true" />This file holds secrets, so its content is never shown or changed.</p>;
  if (file.binary) return <p className="p-6 text-sm text-muted-foreground">A binary file of {formatSize(file.size)}. Only text files are shown here.</p>;
  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await putFile(file.path, draft, { replace: true, expected: file.modifiedAt });
      await refetch();
      setDraft(null);
      onSaved();
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'The save failed');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-3 px-6 py-5 text-[0.82rem] leading-relaxed text-secondary-foreground max-[760px]:px-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {draft === null
          ? <Button size="sm" onClick={() => setDraft(file.text ?? '')} disabled={file.truncated} title={file.truncated ? 'Files over 512 KB are not edited here' : undefined}><Pencil size={13} aria-hidden="true" />Edit</Button>
          : (
            <>
              <Button size="sm" onClick={() => { setDraft(null); setSaveError(null); }} disabled={saving}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving || draft === file.text}>{saving ? 'Saving...' : 'Save'}</Button>
            </>
          )}
      </div>
      {saveError && <p className="text-xs text-status-conflict" role="alert">{saveError}</p>}
      {file.truncated && <p className="rounded-xs border border-dashed border-border px-2.5 py-1.5 font-mono text-[0.66rem] text-muted-foreground">Only the first 512 KB of {formatSize(file.size)} is shown.</p>}
      {draft !== null
        ? <Textarea aria-label={`Edit ${file.path}`} spellCheck={false} className="min-h-[60dvh] font-mono text-[0.74rem]" value={draft} onChange={(event) => setDraft(event.target.value)} />
        : file.path.endsWith('.md')
          ? <div className="[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_th]:border-b [&_th]:border-border-glow [&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground"><Markdown text={file.text ?? ''} /></div>
          : <pre className="whitespace-pre-wrap font-mono text-[0.74rem] [overflow-wrap:anywhere]">{file.text}</pre>}
    </div>
  );
};

type Asking = { kind: 'folder' } | { kind: 'file' } | { kind: 'rename'; entry: Entry };

/** The workspace's home folder: folders like `cd` and `ls`, files read and edited one at a time. Secrets are listed, never opened or changed. */
const WorkspacePage: React.FC = () => {
  const [place, setPlace] = useState(readQuery);
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState<Asking | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const { data, loading, error, refetch } = useQuery<{ workspaceDir: Dir }>(GET_WORKSPACE_DIR, { variables: { path: place.path }, fetchPolicy: 'cache-and-network' });
  const [mkdir] = useMutation(WORKSPACE_MKDIR);
  const [rename] = useMutation(WORKSPACE_RENAME);
  const [remove] = useMutation(WORKSPACE_DELETE);

  useEffect(() => { writeQuery(place.path, place.file); }, [place]);

  const open = (path: string) => { setQuery(''); setNotice(null); setPlace({ path, file: null }); };
  const dir = data?.workspaceDir?.path === place.path ? data.workspaceDir : null;
  const needle = query.trim().toLowerCase();
  const entries = (dir?.entries ?? []).filter((entry) => (showHidden || !entry.name.startsWith('.')) && (!needle || entry.name.toLowerCase().includes(needle)));
  const hidden = (dir?.entries ?? []).filter((entry) => entry.name.startsWith('.')).length;
  const pick = (entry: Entry) => {
    if (entry.masked && entry.kind === 'dir') return;
    if (entry.kind === 'dir') open(entry.path);
    else if (entry.kind === 'file') setPlace({ path: place.path, file: entry.path });
  };

  /** Runs one change, refreshes the folder, and keeps the error for the dialog that asked. */
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refetch();
      setNotice(done);
      return true;
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'The change failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitName = async (name: string) => {
    const current = asking;
    if (!current) return;
    const target = current.kind === 'rename' ? renamedPath(current.entry.path, name) : joinPath(place.path, name);
    const ok = await run(
      () => (current.kind === 'folder' ? mkdir({ variables: { path: target } }) : current.kind === 'file' ? putFile(target, '') : rename({ variables: { from: current.entry.path, to: target } })),
      current.kind === 'rename' ? `Renamed to ${name}.` : `Created ${name}.`,
    );
    if (!ok) return;
    if (current.kind === 'file') setPlace({ path: place.path, file: target });
    if (current.kind === 'rename' && place.file === current.entry.path) setPlace({ path: place.path, file: target });
    setAsking(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const ok = await run(() => remove({ variables: { path: deleting.path } }), `Deleted ${deleting.name}.`);
    if (ok && place.file === deleting.path) setPlace({ path: place.path, file: null });
    if (ok) setDeleting(null);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    await run(async () => { for (const file of list) await putFile(joinPath(place.path, file.name), file); }, `Uploaded ${list.length === 1 ? list[0].name : `${list.length} files`}.`);
    if (uploadRef.current) uploadRef.current.value = '';
  };

  const openFileEntry = place.file ? dir?.entries.find((entry) => entry.path === place.file) ?? null : null;

  return (
    <Page width="full">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Workspace</h1>
          <p className="mt-1 text-xs text-muted-foreground max-[760px]:line-clamp-1">The folders and files of this workspace, from the home folder down. Keys, logins and .env files are listed but never opened or changed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { setActionError(null); setAsking({ kind: 'folder' }); }} disabled={!dir}><FolderPlus size={13} aria-hidden="true" />New folder</Button>
          <Button size="sm" onClick={() => { setActionError(null); setAsking({ kind: 'file' }); }} disabled={!dir}><FilePlus size={13} aria-hidden="true" />New file</Button>
          <Button size="sm" onClick={() => uploadRef.current?.click()} disabled={!dir || busy}><Upload size={13} aria-hidden="true" />{busy && !asking && !deleting ? 'Uploading...' : 'Upload'}</Button>
          <input ref={uploadRef} type="file" multiple hidden onChange={(event) => void upload(event.target.files)} />
        </div>
      </header>

      {(notice || (actionError && !asking && !deleting)) && (
        <p className={cn('mb-3 text-xs', actionError && !asking && !deleting ? 'text-status-conflict' : 'text-muted-foreground')} role={actionError ? 'alert' : 'status'}>{actionError && !asking && !deleting ? actionError : notice}</p>
      )}

      <div className="grid min-h-[640px] grid-cols-[minmax(280px,380px)_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-background max-[760px]:min-h-0 max-[760px]:grid-cols-1">
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
                <div key={entry.path} className={cn('group flex items-center hover:bg-surface-1', place.file === entry.path && 'bg-surface-1')}>
                  <button
                    type="button"
                    onClick={() => pick(entry)}
                    disabled={closed || entry.kind === 'other' || entry.kind === 'link'}
                    title={entry.masked ? 'Holds secrets: never opened or changed' : entry.kind === 'link' ? 'A link whose target is gone' : undefined}
                    aria-current={place.file === entry.path ? 'true' : undefined}
                    className={cn('grid min-w-0 flex-1 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2 border-0 bg-transparent py-1.5 pl-3.5 pr-2 text-left text-[0.76rem] disabled:cursor-default max-[760px]:min-h-11', entry.kind === 'dir' ? 'text-foreground' : 'text-secondary-foreground', entry.masked && 'text-muted-foreground', place.file === entry.path && 'text-foreground')}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="truncate">{entry.name}</span>
                    <span className="font-mono text-[0.6rem] text-muted-foreground max-[760px]:text-xs">{entry.masked ? 'secret' : entry.size !== null ? formatSize(entry.size) : ''}</span>
                  </button>
                  {!entry.masked && (
                    <span className="flex flex-none gap-0.5 pr-1.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-[760px]:opacity-100">
                      <IconButton variant="ghost" className="size-7 max-[760px]:size-11" aria-label={`Rename ${entry.name}`} onClick={() => { setActionError(null); setAsking({ kind: 'rename', entry }); }}><Pencil size={12} aria-hidden="true" /></IconButton>
                      <IconButton variant="ghost" className="size-7 max-[760px]:size-11" aria-label={`Delete ${entry.name}`} onClick={() => { setActionError(null); setDeleting(entry); }}><Trash2 size={12} aria-hidden="true" /></IconButton>
                    </span>
                  )}
                </div>
              );
            })}
            {dir?.truncated && <p className="px-4 py-3 text-xs text-muted-foreground">Only the first 2,000 items are listed.</p>}
          </div>
        </section>

        <section className={cn('flex min-w-0 flex-col', !place.file && 'max-[760px]:hidden')} aria-label="File">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2">
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[0.72rem]">
              <button type="button" aria-label="Back to the folder" onClick={() => setPlace({ path: place.path, file: null })} className="hidden border-0 bg-transparent p-0 text-muted-foreground max-[760px]:grid max-[760px]:size-11 max-[760px]:place-items-center"><ArrowLeft size={16} aria-hidden="true" /></button>
              <span className="truncate">{place.file ?? ''}</span>
            </span>
            {place.file && <span className="font-mono text-[0.62rem] text-muted-foreground max-[760px]:text-xs">{when(openFileEntry?.modifiedAt ?? null)}</span>}
          </div>
          <div className="max-h-[calc(100dvh-16rem)] min-h-[320px] flex-1 overflow-y-auto max-[760px]:max-h-none">
            {place.file
              ? <FileView key={place.file} path={place.file} onSaved={() => { void refetch(); setNotice('Saved.'); }} />
              : (
                <div className="grid h-full min-h-[320px] place-items-center text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2"><Folder size={28} aria-hidden="true" /><p className="text-sm">Pick a file to read or edit it.</p></div>
                </div>
              )}
          </div>
        </section>
      </div>

      {asking && (
        <NameDialog
          title={asking.kind === 'folder' ? 'New folder' : asking.kind === 'file' ? 'New file' : `Rename ${asking.entry.name}`}
          label={asking.kind === 'rename' ? 'New name' : `Name, in ~/${place.path}`}
          initial={asking.kind === 'rename' ? asking.entry.name : ''}
          busy={busy}
          error={actionError}
          onSubmit={(name) => void submitName(name)}
          onCancel={() => { setAsking(null); setActionError(null); }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? ''}?`}
        description={actionError ?? (deleting?.kind === 'dir' ? `The folder ~/${deleting.path} and everything in it is deleted. This cannot be undone.` : `~/${deleting?.path ?? ''} is deleted. This cannot be undone.`)}
        confirmLabel="Delete"
        busyLabel="Deleting..."
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { setDeleting(null); setActionError(null); }}
      />
    </Page>
  );
};

export default WorkspacePage;
