import React from 'react';
import { AlertTriangle, GitMerge, Loader2 } from 'lucide-react';
import { Badge, Button, Card } from '../../components/ui';
import { conflictName, type KitConflictAction, type openConflicts } from './kitConflictLogic';

export type KitConflictRow = ReturnType<typeof openConflicts>[number];

/** The rows of the conflict card; split out so it renders without Apollo. */
export const KitConflictList: React.FC<{ rows: KitConflictRow[]; busy: string | null; onAction: (row: KitConflictRow, action: KitConflictAction) => void }> = ({ rows, busy, onAction }) => (
  <Card className="mb-4 border-status-warn p-0" role="region" aria-label="Kit conflicts">
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <AlertTriangle size={16} className="text-status-warn" aria-hidden="true" />
      <h2 className="font-display text-sm font-bold">Kit install conflicts</h2>
      <Badge variant="warn">{rows.length}</Badge>
      <span className="text-xs text-muted-foreground">Your edit and the new kit changed the same lines. The local file is still in use; the kit version waits in .kit-new.</span>
    </div>
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={`${row.machine}:${row.path}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-display text-sm font-semibold">bentrok di {conflictName(row.path)}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{row.machine} · {row.path} · {row.reason}</span>
          </span>
          {row.actionable ? (
            <span className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => onAction(row, 'local')}>{busy === `${row.path}:local` && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Use local</Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => onAction(row, 'kit')}>{busy === `${row.path}:kit` && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Use kit</Button>
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => onAction(row, 'edit')}><GitMerge size={14} aria-hidden="true" />Edit merged</Button>
            </span>
          ) : <span className="text-xs text-muted-foreground">Settle it on {row.machine} with install.cjs, or from its own DOCK.</span>}
        </li>
      ))}
    </ul>
  </Card>
);
