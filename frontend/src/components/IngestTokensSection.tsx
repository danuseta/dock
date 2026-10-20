import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Bot, Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import { GET_INGEST_TOKENS } from '../graphql/queries';
import { CREATE_INGEST_TOKEN, REVOKE_INGEST_TOKEN } from '../graphql/mutations';
import { DEFAULT_MACHINE } from '../chat/messages';
import { apiOrigin } from '../lib/apollo';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { Badge, Button, Card, ConfirmDialog, IconButton, Input } from './ui';

interface IngestToken { id: string; name: string; prefix: string; machine?: string | null; createdAt: string; lastUsedAt?: string | null }

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');

export const IngestTokensSection: React.FC = () => {
  const { data, error, refetch } = useQuery(GET_INGEST_TOKENS, CACHED_QUERY_OPTIONS);
  const [createIngestToken, { loading: creating }] = useMutation(CREATE_INGEST_TOKEN);
  const [revokeIngestToken, { loading: revoking }] = useMutation(REVOKE_INGEST_TOKEN);
  const [name, setName] = useState('');
  const [machine, setMachine] = useState('');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<IngestToken | null>(null);
  const [setupCopied, setSetupCopied] = useState(false);
  const tokens: IngestToken[] = data?.ingestTokens || [];
  const machineNames = [...new Set(tokens.map((token) => token.machine || DEFAULT_MACHINE))];
  const endpoint = `${apiOrigin}/ingest/orchestrator`;

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError('');
    try {
      const result = await createIngestToken({ variables: { name, machine: machine.trim() || undefined } });
      setSecret(result.data?.createIngestToken?.token || '');
      setCopied(false);
      setName('');
      setMachine('');
      await refetch();
    } catch (createError: any) {
      setActionError(createError.message || 'Failed to create the token');
    }
  };

  const handleRevoke = async (id: string) => {
    setActionError('');
    try {
      await revokeIngestToken({ variables: { id } });
      await refetch();
    } catch (revokeError: any) {
      setActionError(revokeError.message || 'Failed to revoke the token');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setActionError('Copy failed. Select the token and copy it by hand.');
    }
  };

  const setup = `{\n  "url": "${endpoint}",\n  "token": "${secret || 'dock_ing_...'}"\n}`;

  const handleCopySetup = async () => {
    try {
      await navigator.clipboard.writeText(setup);
      setSetupCopied(true);
    } catch {
      setActionError('Copy failed. Select the text and copy it by hand.');
    }
  };

  return (
    <section>
      <div className="flex flex-col gap-5">
        <Card>
          <h3 className="mb-4 flex items-center gap-2 border-b border-border pb-2 font-display text-lg font-bold"><KeyRound size={20} aria-hidden="true" />Ingest tokens</h3>
          <p className="mb-4 text-pretty text-sm text-secondary-foreground">A token can push its machine's ticket status, activity and masked session transcripts, answer chat for its machine, and read the ledgers of its own tickets. It cannot open the dashboard or read another machine's chat or tickets, and it works without the PIN.</p>

          {error && !data && <p className="mb-3 text-sm text-status-conflict" role="alert">Tokens failed to load: {error.message}</p>}
          {tokens.length === 0 ? <p className="mb-4 rounded-sm border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">No tokens yet.</p> : (
            <ul className="mb-4 flex flex-col">
              {tokens.map((token) => (
                <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0" key={token.id}>
                  <div className="min-w-0">
                    <strong className="block truncate font-display text-sm">{token.name}</strong>
                    <span className="font-mono text-xs text-muted-foreground">{token.machine || DEFAULT_MACHINE} · {token.prefix}… · created {formatDate(token.createdAt)} · last used {formatDate(token.lastUsedAt)}</span>
                  </div>
                  <IconButton variant="ghost" className="text-status-conflict" aria-label={`Revoke ${token.name}`} title="Revoke token" disabled={revoking} onClick={() => setRevokeTarget(token)}><Trash2 size={15} aria-hidden="true" /></IconButton>
                </li>
              ))}
            </ul>
          )}

          <form className="flex flex-wrap items-end gap-2" onSubmit={handleCreate}>
            <label className="min-w-[200px] flex-1"><span className="mb-1 block text-sm font-medium">New token name</span><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Work laptop" maxLength={60} required /></label>
            <label className="min-w-[160px] flex-1"><span className="mb-1 block text-sm font-medium">Machine</span><Input value={machine} onChange={(event) => setMachine(event.target.value)} list="ingest-machines" placeholder="laptop" maxLength={24} pattern="[a-z][a-z0-9\-]{0,23}" title="Lowercase letters, digits and dashes, starting with a letter" aria-describedby="ingest-machine-hint" /><span id="ingest-machine-hint" className="mt-1 block text-pretty text-xs text-muted-foreground">Leave it empty and the token is created for laptop.</span></label>
            <datalist id="ingest-machines">{machineNames.map((item) => <option key={item} value={item} />)}</datalist>
            <Button type="submit" variant="primary" disabled={creating || !name.trim()}>{creating ? 'Creating...' : 'Create token'}</Button>
          </form>
          {actionError && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{actionError}</p>}

          {secret && (
            <div className="mt-4 rounded-sm border border-status-merged/40 bg-status-merged-bg p-3" role="status">
              <div className="mb-1.5 flex items-center justify-between gap-2"><span className="font-mono text-[0.68rem] font-extrabold text-status-merged uppercase">Copy it now. DOCK will not show it again.</span><Badge variant="success">NEW</Badge></div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-xs border border-border bg-surface-0 px-3 py-2 font-mono text-xs">{secret}</code>
                <Button size="sm" onClick={handleCopy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}</Button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-2"><h3 className="flex items-center gap-2 font-display text-lg font-bold"><Bot size={20} aria-hidden="true" />Kit setup</h3><Button size="sm" onClick={handleCopySetup}>{setupCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{setupCopied ? 'Copied' : 'Copy'}</Button></div>
          <p className="mb-3 text-pretty text-sm text-secondary-foreground">Put the address and the token in the kit's <span className="font-mono">dock.json</span> on that machine. Every ledger update is then pushed here.</p>
          <pre className="overflow-x-auto rounded-sm border border-border bg-surface-0 px-4 py-3 font-mono text-xs leading-6 text-secondary-foreground">{setup}</pre>
        </Card>
      </div>
      <ConfirmDialog open={Boolean(revokeTarget)} busy={revoking} title={`Revoke ${revokeTarget?.name ?? 'the token'}?`} description={`The ${revokeTarget?.machine || DEFAULT_MACHINE} kit that uses it stops reporting to DOCK until it gets a new token.`} confirmLabel="Revoke" busyLabel="Revoking…" onConfirm={async () => { if (revokeTarget) await handleRevoke(revokeTarget.id); setRevokeTarget(null); }} onCancel={() => setRevokeTarget(null)} />
    </section>
  );
};
