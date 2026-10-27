import React from 'react';
import { Check, Folder, MessageSquare } from 'lucide-react';
import { Checkbox, Input } from '../components/ui';
import { cn } from '../lib/cn';
import type { ChangeFile } from './DiffFile';
import { GENERAL } from './findings';

const STATUS_LETTER: Record<string, string> = { added: 'A', removed: 'D', renamed: 'R', copied: 'C' };
const STATUS_STYLE: Record<string, string> = { A: 'text-status-merged', D: 'text-status-conflict', R: 'text-status-discord', C: 'text-status-discord', M: 'text-status-warn' };

interface FileTreeProps {
  files: ChangeFile[];
  counts: Record<string, { open: number; total: number }>;
  viewed: (path: string) => boolean;
  filter: string;
  onFilter: (value: string) => void;
  onlyFindings: boolean;
  onOnlyFindings: (value: boolean) => void;
  current: string | null;
  onPick: (path: string | null) => void;
  /** Taller rows for the phone sheet. */
  large?: boolean;
}

/** The files of the pull request by folder, with their status, size, open findings and viewed state. */
export const FileTree: React.FC<FileTreeProps> = ({ files, counts, viewed, filter, onFilter, onlyFindings, onOnlyFindings, current, onPick, large }) => {
  const needle = filter.trim().toLowerCase();
  const shown = files.filter((file) => (!needle || file.path.toLowerCase().includes(needle)) && (!onlyFindings || counts[file.path]));
  const folders = new Map<string, ChangeFile[]>();
  for (const file of shown) {
    const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    folders.set(folder, [...(folders.get(folder) ?? []), file]);
  }
  const general = counts[GENERAL];
  const row = cn('flex w-full min-w-0 items-center gap-2 border-0 border-l-2 border-transparent bg-transparent px-3 text-left font-mono text-[0.74rem] hover:bg-surface-1', large ? 'min-h-11' : 'min-h-7');

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <Input type="search" aria-label="Filter files" placeholder="Filter files" className="h-8 text-xs max-[760px]:h-11" value={filter} onChange={(event) => onFilter(event.target.value)} />
        <label className="flex items-center gap-2 text-xs text-secondary-foreground"><Checkbox checked={onlyFindings} onChange={(event) => onOnlyFindings(event.target.checked)} />Only files with findings</label>
      </div>
      <nav aria-label="Files" className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {general && (
          <button type="button" className={cn(row, 'font-semibold', current === GENERAL && 'border-l-accent bg-surface-1')} onClick={() => onPick(null)}>
            <MessageSquare size={13} className="flex-none text-status-warn" aria-hidden="true" /><span className="flex-1">General</span><Dot count={general} />
          </button>
        )}
        {[...folders].map(([folder, items]) => (
          <div key={folder || '/'}>
            {folder && <p className="flex min-w-0 items-center gap-1.5 px-3 pt-1.5 pb-0.5 font-mono text-[0.7rem] text-muted-foreground" title={folder}><Folder size={12} className="flex-none" aria-hidden="true" /><span className="truncate">{folder}</span></p>}
            {items.map((file) => {
              const letter = STATUS_LETTER[file.status] ?? 'M';
              return (
                <button key={file.path} type="button" title={file.path} onClick={() => onPick(file.path)} aria-current={current === file.path ? 'true' : undefined}
                  className={cn(row, folder && 'pl-6', current === file.path && 'border-l-accent bg-surface-1', viewed(file.path) && 'text-muted-foreground')}>
                  <span className={cn('w-3 flex-none font-bold', STATUS_STYLE[letter])}>{letter}</span>
                  <span className="min-w-0 flex-1 truncate">{file.path.split('/').pop()}</span>
                  {counts[file.path] && <Dot count={counts[file.path]} />}
                  <span className="flex-none tabular-nums">{file.status === 'removed' ? <span className="text-status-conflict">-{file.deletions}</span> : <span className="text-status-merged">+{file.additions}</span>}</span>
                </button>
              );
            })}
          </div>
        ))}
        {shown.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No file matches.</p>}
      </nav>
    </div>
  );
};

/** Open findings of a file as an amber count; a green tick once all are resolved. */
const Dot: React.FC<{ count: { open: number; total: number } }> = ({ count }) => (count.open > 0
  ? <span className="grid min-w-4 flex-none place-items-center rounded-full bg-status-warn/20 px-1 font-mono text-[0.62rem] font-bold text-status-warn" aria-label={`${count.open} open ${count.open === 1 ? 'finding' : 'findings'}`}>{count.open}</span>
  : <Check size={13} className="flex-none text-status-merged" aria-label="Findings resolved" />);
