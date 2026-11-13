import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { AlertTriangle, GitBranch, Lock, RefreshCw, Trash2 } from 'lucide-react';
import { CLEAN_WORKTREES, GET_WORKTREES } from '../graphql/queries';
import { Badge, Button, Card, ConfirmDialog, PhoneCards } from './ui';
import { cn } from '../lib/cn';
import { cleanable, filterWorktrees, folderOf, isMerged, type WorktreeCleanResult, type WorktreeFilter, type WorktreeList, type WorktreeRow } from '../lib/worktrees';

const FILTERS: Array<[WorktreeFilter, string]> = [['all', 'Semua'], ['merged', 'Merged'], ['open', 'Belum merged']];
const MODE_TEXT: Record<WorktreeList['mode'], string> = {
  notify: 'Mode kasih tahu: DOCK nggak pernah ngehapus sendiri.',
  auto: 'Mode hapus otomatis: tiap hari 07:00 WIB, yang merged lebih dari batas hari dihapus lewat wt.sh.',
  off: 'Worktree merged nggak dicek (Settings › Sous flow › Aturan).',
};

const mergeBadge = (row: WorktreeRow) => (isMerged(row) ? <Badge variant="success">merged</Badge> : row.merge === 'open' ? <Badge variant="accent">PR open</Badge> : <Badge>{row.merge === 'none' ? 'belum ada PR' : 'nggak diketahui'}</Badge>);

/** Workspace › Worktrees: every linked worktree under ROOT, cleanup of merged ones through wt.sh, and what was cleaned. */
export const WorktreesPanel = ({ onTicketClick }: { onTicketClick?: (key: string) => void }) => {
  const { data, loading, error, refetch } = useQuery<{ worktrees: WorktreeList }>(GET_WORKTREES, { fetchPolicy: 'cache-and-network' });
  const [clean, { loading: cleaning }] = useMutation<{ cleanWorktrees: WorktreeCleanResult[] }>(CLEAN_WORKTREES);
  const [filter, setFilter] = useState<WorktreeFilter>('all');
  const [asking, setAsking] = useState<WorktreeRow[] | null>(null);
  const [results, setResults] = useState<WorktreeCleanResult[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const list = data?.worktrees;
  const rows = filterWorktrees(list?.rows ?? [], filter);
  const ready = (list?.rows ?? []).filter(cleanable);

  const confirm = async () => {
    if (!asking) return;
    setFailure(null);
    try {
      const done = await clean({ variables: { paths: asking.map((row) => row.path) } });
      setResults(done.data?.cleanWorktrees ?? []);
      await refetch();
    } catch (cleanError) {
      setFailure(cleanError instanceof Error ? cleanError.message : 'Cleanup gagal');
    } finally {
      setAsking(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([id, label]) => <Button key={id} size="sm" variant={filter === id ? 'primary' : 'default'} className="rounded-pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</Button>)}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void refetch()} disabled={loading}><RefreshCw size={13} aria-hidden="true" className={cn(loading && 'animate-spin motion-reduce:animate-none')} />Cek ulang</Button>
          <Button size="sm" variant="primary" disabled={!ready.length || cleaning} onClick={() => setAsking(ready)}><Trash2 size={13} aria-hidden="true" />Bersihin yang merged ({ready.length})</Button>
        </div>
      </div>
      {list && <p className="text-xs text-muted-foreground">{MODE_TEXT[list.mode]} ROOT: <span className="font-mono">{list.root || '-'}</span></p>}
      {(error || list?.error || failure) && <Card className="border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{failure || list?.error || error?.message}</Card>}
      {results && results.length > 0 && (
        <Card className="p-4" role="status">
          <p className="mb-2 font-display text-sm font-bold">Hasil bersih-bersih</p>
          <ul className="flex flex-col gap-1.5 text-xs">{results.map((result) => <li key={result.path} className="flex flex-col gap-0.5"><span className="flex items-center gap-2"><Badge variant={result.ok ? 'success' : 'danger'}>{result.ok ? 'REMOVED' : 'REFUSED'}</Badge><span className="font-mono">{folderOf(result.path)}</span></span><pre className="m-0 whitespace-pre-wrap font-mono text-[0.68rem] text-muted-foreground">{result.output}</pre></li>)}</ul>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <PhoneCards>
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead className="bg-surface-1 text-xs text-muted-foreground">
              <tr><th className="px-4 py-3 font-medium">Worktree</th><th className="px-4 py-3 font-medium">Tiket</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Dicek</th><th className="px-4 py-3 text-right font-medium" /></tr>
            </thead>
            <tbody>
              {!rows.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">{loading ? 'Lagi baca worktree...' : 'Nggak ada worktree di sini.'}</td></tr>}
              {rows.map((row) => (
                <tr key={row.path} className="border-t border-border hover:bg-surface-1">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2"><GitBranch size={13} aria-hidden="true" className="flex-none text-muted-foreground" /><span className="font-mono text-xs font-bold">{folderOf(row.path)}</span><Badge>{row.repo}</Badge></span>
                    <p className="max-w-[360px] truncate font-mono text-[0.68rem] text-muted-foreground" title={row.path}>{row.branch ?? 'detached'}</p>
                  </td>
                  <td className="px-4 py-3">{row.ticketKey ? <button type="button" onClick={() => onTicketClick?.(row.ticketKey!)} className="font-mono text-xs font-bold text-accent hover:underline max-[760px]:min-h-11">{row.ticketKey}</button> : <span className="text-xs text-muted-foreground">-</span>}</td>
                  <td className="px-4 py-3">{mergeBadge(row)}</td>
                  <td className="px-4 py-3">
                    {row.refusals.length
                      ? <span className="flex flex-wrap gap-1">{row.refusals.map((reason) => <span key={reason} className="inline-flex items-center gap-1 rounded-xs bg-surface-2 px-1.5 py-0.5 text-[0.68rem] text-secondary-foreground"><Lock size={10} aria-hidden="true" />{reason}</span>)}</span>
                      : <span className="text-xs text-status-merged">aman dihapus</span>}
                    {row.dirty && row.changes.length > 0 && <pre className="mt-1 m-0 whitespace-pre-wrap font-mono text-[0.64rem] text-muted-foreground">{row.changes.join('\n')}</pre>}
                  </td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" disabled={!cleanable(row) || cleaning} onClick={() => setAsking([row])} aria-label={`Hapus ${folderOf(row.path)}`}><Trash2 size={13} aria-hidden="true" />Hapus</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhoneCards>
      </Card>

      {list && list.history.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 font-display text-sm font-bold">Riwayat</p>
          <ul className="flex flex-col gap-1 text-xs">{list.history.slice(0, 20).map((item, index) => <li key={`${item.path}-${item.at}-${index}`} className="flex flex-wrap items-center gap-2"><Badge variant={item.ok ? 'success' : 'danger'}>{item.ok ? 'REMOVED' : 'REFUSED'}</Badge><span className="font-mono">{folderOf(item.path)}</span><span className="text-muted-foreground">{item.by === 'auto' ? 'otomatis' : 'manual'} · {item.at ? new Date(item.at).toLocaleString('en-GB') : ''}</span></li>)}</ul>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(asking)}
        title={asking?.length === 1 ? `Hapus ${folderOf(asking[0].path)}?` : `Hapus ${asking?.length ?? 0} worktree?`}
        description={<span className="flex items-start gap-1.5"><AlertTriangle size={14} aria-hidden="true" className="mt-0.5 flex-none text-status-warn" />Dihapus lewat wt.sh check lalu wt.sh remove. Worktree yang dihapus nggak bisa dibalikin, branch-nya tetap ada di remote. Yang ditolak wt.sh tampil REFUSED dan nggak disentuh.</span>}
        confirmLabel="Hapus"
        busyLabel="Ngehapus..."
        busy={cleaning}
        onConfirm={() => void confirm()}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
};
