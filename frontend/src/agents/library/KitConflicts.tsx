import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { GET_KIT_CONFLICT_FILE, GET_KIT_MERGE_REPORTS } from '../../graphql/queries';
import { RESOLVE_KIT_CONFLICT } from '../../graphql/mutations';
import { Button, Card, Textarea } from '../../components/ui';
import { CHAT_MACHINE } from '../../chat/messages';
import { conflictName, mergeProblem, mergeStart, openConflicts, type KitConflictAction, type KitConflictFile, type KitMergeReport } from './kitConflictLogic';
import { KitConflictList, type KitConflictRow } from './KitConflictList';

/** Both versions side by side and the merge to write; saving sets the kit version as the new base and removes .kit-new. */
const MergeEditor: React.FC<{ path: string; onBack: () => void; onSaved: () => void }> = ({ path, onBack, onSaved }) => {
  const { data, loading, error } = useQuery<{ kitConflictFile: KitConflictFile }>(GET_KIT_CONFLICT_FILE, { variables: { path }, fetchPolicy: 'network-only' });
  const [resolve, { loading: saving }] = useMutation<{ resolveKitConflict: { ok: boolean; error: string | null } }>(RESOLVE_KIT_CONFLICT);
  const [text, setText] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const file = data?.kitConflictFile;
  useEffect(() => { if (file && text === null) setText(mergeStart(file)); }, [file, text]);
  const problem = text === null ? 'Loading' : mergeProblem(text);
  const save = async () => {
    setSaveError('');
    try {
      const result = (await resolve({ variables: { path, action: 'edit', text } })).data?.resolveKitConflict;
      if (!result?.ok) throw new Error(result?.error || 'The kit refused the merge');
      onSaved();
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Save failed');
    }
  };
  return (
    <section aria-label={`Merge ${path}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack} disabled={saving}><ArrowLeft size={14} aria-hidden="true" />Back to the library</Button>
        <h2 className="font-display text-2xl font-bold">Merge {conflictName(path)}</h2>
        <span className="font-mono text-xs text-muted-foreground">{path}</span>
      </div>
      {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Reading both versions from the kit</p>}
      {error && <Card className="border-status-conflict text-sm text-status-conflict" role="alert">{error.message}</Card>}
      {file && (
        <>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            {([['Local (in use)', file.local ?? ''], ['Kit (.kit-new)', file.kit]] as const).map(([label, body]) => (
              <Card key={label} className="min-w-0 p-0">
                <h3 className="border-b border-border px-4 py-2 font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</h3>
                <pre className="max-h-[360px] overflow-auto px-4 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">{body}</pre>
              </Card>
            ))}
          </div>
          <Card className="p-4">
            <h3 className="mb-2 font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Merged file</h3>
            <Textarea aria-label="Merged file" value={text ?? ''} onChange={(event) => setText(event.target.value)} className="min-h-[360px] font-mono text-xs leading-relaxed" spellCheck={false} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={problem !== null || saving} onClick={() => void save()}>{saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}Save merge</Button>
              {problem && text !== null && <span className="text-sm text-status-warn">{problem}</span>}
              {saveError && <span className="text-sm text-status-conflict" role="alert">{saveError}</span>}
              <span className="text-xs text-muted-foreground">Logged in the manager log with a backup of the local file, so it can be rolled back.</span>
            </div>
          </Card>
        </>
      )}
    </section>
  );
};

/** Agents > Library: install conflicts between local skill or agent edits and the kit, with use local, use kit and edit merged. */
export const KitConflicts: React.FC<{ editing: string | null; onEdit: (path: string | null) => void }> = ({ editing, onEdit }) => {
  const { data, refetch } = useQuery<{ kitMergeReports: KitMergeReport[] }>(GET_KIT_MERGE_REPORTS, { fetchPolicy: 'cache-and-network' });
  const [resolve] = useMutation<{ resolveKitConflict: { ok: boolean; error: string | null } }>(RESOLVE_KIT_CONFLICT);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState('');
  const rows = openConflicts(data?.kitMergeReports ?? [], CHAT_MACHINE);

  if (editing) return <MergeEditor path={editing} onBack={() => onEdit(null)} onSaved={() => { onEdit(null); void refetch(); }} />;
  if (rows.length === 0) return null;

  const act = async (row: KitConflictRow, action: KitConflictAction) => {
    if (action === 'edit') return onEdit(row.path);
    setFailure('');
    setBusy(`${row.path}:${action}`);
    try {
      const result = (await resolve({ variables: { path: row.path, action } })).data?.resolveKitConflict;
      if (!result?.ok) throw new Error(result?.error || 'The kit refused the change');
      await refetch();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The kit refused the change');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <KitConflictList rows={rows} busy={busy} onAction={(row, action) => void act(row, action)} />
      {failure && <Card className="mb-4 border-status-conflict text-sm text-status-conflict" role="alert">{failure}</Card>}
    </>
  );
};
