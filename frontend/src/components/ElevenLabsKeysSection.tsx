import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Mic, RotateCcw, Trash2 } from 'lucide-react';
import { GET_ELEVENLABS_KEYS } from '../graphql/queries';
import { ADD_ELEVENLABS_KEY, REMOVE_ELEVENLABS_KEY, UNPARK_ELEVENLABS_KEY } from '../graphql/mutations';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { keyState, type ElevenLabsKeyRow } from '../lib/elevenLabsKeys';
import { Badge, Button, Card, IconButton, Input } from './ui';

export const ElevenLabsKeysSection: React.FC = () => {
  const { data, error, refetch } = useQuery(GET_ELEVENLABS_KEYS, CACHED_QUERY_OPTIONS);
  const [addKey, { loading: adding }] = useMutation(ADD_ELEVENLABS_KEY);
  const [removeKey, { loading: removing }] = useMutation(REMOVE_ELEVENLABS_KEY);
  const [unparkKey] = useMutation(UNPARK_ELEVENLABS_KEY);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [actionError, setActionError] = useState('');
  const keys: ElevenLabsKeyRow[] = data?.elevenLabsKeys || [];

  const run = async (work: () => Promise<unknown>, failure: string) => {
    setActionError('');
    try {
      await work();
      await refetch();
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
      <h3 className="mb-4 flex items-center gap-2 border-b border-border pb-2 font-display text-lg font-bold"><Mic size={20} aria-hidden="true" />ElevenLabs keys</h3>
      <p className="mb-4 text-pretty text-sm text-secondary-foreground">One set for both DOCKs and both machines. The laptop DOCK keeps them; a key added here shows on the other DOCK too. Demo videos rotate over them: a key that hits its limit is parked and the next one is used.</p>

      {error && !data && <p className="mb-3 text-sm text-status-conflict" role="alert">Keys failed to load: {error.message}</p>}
      {keys.length === 0 ? <p className="mb-4 rounded-sm border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">No keys yet.</p> : (
        <ul className="mb-4 flex flex-col">
          {keys.map((item) => (
            <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0" key={item.name}>
              <div className="min-w-0">
                <strong className="flex items-center gap-2 truncate font-display text-sm">{item.name}{item.current && !item.parkedUntil && <Badge variant="success">IN USE</Badge>}</strong>
                <span className="font-mono text-xs text-muted-foreground">{item.masked} · {keyState(item)}</span>
              </div>
              <span className="flex items-center gap-1">
                {item.parkedUntil && <IconButton variant="ghost" aria-label={`Use ${item.name} again`} title="Use again now" onClick={() => void run(() => unparkKey({ variables: { name: item.name } }), 'Failed to use the key again')}><RotateCcw size={15} aria-hidden="true" /></IconButton>}
                <IconButton variant="ghost" className="text-status-conflict" aria-label={`Remove ${item.name}`} title="Remove key" disabled={removing} onClick={() => void run(() => removeKey({ variables: { name: item.name } }), 'Failed to remove the key')}><Trash2 size={15} aria-hidden="true" /></IconButton>
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
    </Card>
  );
};
