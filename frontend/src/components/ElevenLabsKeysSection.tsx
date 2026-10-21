import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Mic, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { GET_ELEVENLABS_KEYS, GET_ELEVENLABS_QUOTA } from '../graphql/queries';
import { ADD_ELEVENLABS_KEY, REMOVE_ELEVENLABS_KEY, UNPARK_ELEVENLABS_KEY } from '../graphql/mutations';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { keyState, quotaText, type ElevenLabsKeyRow, type ElevenLabsQuotaRow } from '../lib/elevenLabsKeys';
import { Badge, Button, Card, ConfirmDialog, IconButton, Input } from './ui';

const QuotaLine: React.FC<{ quota?: ElevenLabsQuotaRow; loading: boolean }> = ({ quota, loading }) => {
  if (!quota) return <span className="text-xs text-muted-foreground">{loading ? 'Loading quota…' : ''}</span>;
  if (quota.hidden) return <span className="text-xs text-muted-foreground">Quota hidden: key lacks user_read</span>;
  if (quota.error || quota.characterCount == null || quota.characterLimit == null) return <span className="text-xs text-status-conflict" role="alert">Quota failed: {quota.error || 'no figures returned'}</span>;
  const used = quota.characterLimit > 0 ? Math.min(100, (quota.characterCount / quota.characterLimit) * 100) : 100;
  return (
    <span className="flex flex-col gap-1">
      <span className="text-xs text-secondary-foreground">{quotaText({ characterCount: quota.characterCount, characterLimit: quota.characterLimit, resetsAt: quota.resetsAt })}</span>
      <span className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-border" role="presentation"><span className="block h-full bg-status-merged" style={{ width: `${100 - used}%` }} /></span>
    </span>
  );
};

export const ElevenLabsKeysSection: React.FC = () => {
  const { data, error, refetch } = useQuery(GET_ELEVENLABS_KEYS, CACHED_QUERY_OPTIONS);
  const { data: quotaData, loading: quotaLoading, error: quotaError, refetch: refetchQuota } = useQuery(GET_ELEVENLABS_QUOTA, { fetchPolicy: 'network-only', notifyOnNetworkStatusChange: true });
  const [addKey, { loading: adding }] = useMutation(ADD_ELEVENLABS_KEY);
  const [removeKey, { loading: removing }] = useMutation(REMOVE_ELEVENLABS_KEY);
  const [unparkKey] = useMutation(UNPARK_ELEVENLABS_KEY);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [actionError, setActionError] = useState('');
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const keys: ElevenLabsKeyRow[] = data?.elevenLabsKeys || [];
  const quotas: ElevenLabsQuotaRow[] = quotaData?.elevenLabsQuota || [];

  const run = async (work: () => Promise<unknown>, failure: string) => {
    setActionError('');
    try {
      await work();
      await Promise.all([refetch(), refetchQuota()]);
    } catch (workError: any) {
      setActionError(workError.message || failure);
    }
  };

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await addKey({ variables: { name: name.trim(), key: key.trim() } });
      setName('');
      setKey('');
    }, 'Failed to add the key');
  };

  return (
    <Card>
      <h3 className="mb-4 flex items-center gap-2 border-b border-border pb-2 font-display text-lg font-bold"><Mic size={20} aria-hidden="true" />ElevenLabs keys<IconButton variant="ghost" className="ml-auto" aria-label="Refresh quota" title="Refresh quota" disabled={quotaLoading} onClick={() => void refetchQuota().catch(() => undefined)}><RefreshCw size={15} aria-hidden="true" /></IconButton></h3>
      <p className="mb-4 text-pretty text-sm text-secondary-foreground">One set for both DOCKs and both machines. The laptop DOCK keeps them; a key added here shows on the other DOCK too. Demo videos rotate over them: a key that hits its limit is parked and the next one is used.</p>

      {error && !data && <p className="mb-3 text-sm text-status-conflict" role="alert">Keys failed to load: {error.message}</p>}
      {quotaError && <p className="mb-3 text-sm text-status-conflict" role="alert">Quota failed to load: {quotaError.message}</p>}
      {keys.length === 0 ? <p className="mb-4 rounded-sm border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">No keys yet.</p> : (
        <ul className="mb-4 flex flex-col">
          {keys.map((item) => (
            <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0" key={item.name}>
              <div className="min-w-0">
                <strong className="flex items-center gap-2 truncate font-display text-sm">{item.name}{item.current && !item.parkedUntil && <Badge variant="success">IN USE</Badge>}</strong>
                <span className="font-mono text-xs text-muted-foreground">{item.masked} · {keyState(item)}</span>
                <QuotaLine quota={quotas.find((quota) => quota.name === item.name)} loading={quotaLoading} />
              </div>
              <span className="flex items-center gap-1">
                {item.parkedUntil && <IconButton variant="ghost" aria-label={`Use ${item.name} again`} title="Use again now" onClick={() => void run(() => unparkKey({ variables: { name: item.name } }), 'Failed to use the key again')}><RotateCcw size={15} aria-hidden="true" /></IconButton>}
                <IconButton variant="ghost" className="text-status-conflict" aria-label={`Remove ${item.name}`} title="Remove key" disabled={removing} onClick={() => setRemoveTarget(item.name)}><Trash2 size={15} aria-hidden="true" /></IconButton>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-wrap items-end gap-2" onSubmit={handleAdd}>
        <label className="min-w-[140px] flex-1"><span className="mb-1 block text-sm font-medium">Name</span><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="suryo" maxLength={40} pattern="[A-Za-z0-9._\-]+" title="Letters, digits, dot, dash or underscore" required /></label>
        <label className="min-w-[220px] flex-[2]"><span className="mb-1 block text-sm font-medium">Key</span><Input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk_..." maxLength={200} required /></label>
        <Button type="submit" variant="primary" disabled={adding || !name.trim() || !key.trim()}>{adding ? 'Adding...' : 'Add key'}</Button>
      </form>
      {actionError && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{actionError}</p>}
      <ConfirmDialog open={Boolean(removeTarget)} busy={removing} title={`Remove ${removeTarget ?? 'the key'}?`} description="Demo videos stop using this key on both DOCKs." confirmLabel="Remove" busyLabel="Removing…" onConfirm={async () => { if (removeTarget) await run(() => removeKey({ variables: { name: removeTarget } }), 'Failed to remove the key'); setRemoveTarget(null); }} onCancel={() => setRemoveTarget(null)} />
    </Card>
  );
};
