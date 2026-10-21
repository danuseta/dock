import React, { useEffect, useState } from 'react';
import { useApolloClient, useMutation } from '@apollo/client';
import { ArrowLeft, CheckCircle2, Loader2, Save, XCircle } from 'lucide-react';
import { GET_AGENT_LOOKS } from '../../graphql/queries';
import { PREVIEW_LIBRARY_AGENT, SAVE_AGENT_LOOK, SAVE_LIBRARY_AGENT } from '../../graphql/mutations';
import { Badge, Button, Card } from '../../components/ui';
import { apiOrigin } from '../../lib/apollo';
import { cn } from '../../lib/cn';
import { CHAT_MACHINE } from '../../chat/messages';
import { useChatMachines } from '../../chat/useChatMachines';
import { agentInput, diffCounts, diffLines, saveState, type AgentForm } from './libraryLogic';

interface Preview { diff: string; checks: Array<{ ok: boolean; text: string }> }

const LINE: Record<string, string> = {
  add: 'bg-status-merged-bg text-status-merged',
  del: 'bg-status-conflict-bg text-status-conflict',
  hunk: 'text-status-discord',
  same: 'text-secondary-foreground',
};

async function uploadAvatar(slug: string, file: File) {
  const response = await fetch(`${apiOrigin}/api/agent-looks/${encodeURIComponent(slug)}/avatar`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'image/png', 'x-dock-upload': '1' },
    body: file,
  });
  if (!response.ok) {
    const answer = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof answer?.error === 'string' ? answer.error : `The avatar upload was refused (${response.status})`);
  }
}

/** Screen 3: the diff of the md file the kit will write, its checks, and the machine it goes to. Every save passes here. */
export const AgentReview: React.FC<{ form: AgentForm; avatar: File | null; onBack: () => void; onSaved: () => void }> = ({ form, avatar, onBack, onSaved }) => {
  const client = useApolloClient();
  const machines = useChatMachines();
  const [machine, setMachine] = useState(CHAT_MACHINE);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [runPreview, { loading: previewing }] = useMutation<{ previewLibraryAgent: Preview }>(PREVIEW_LIBRARY_AGENT);
  const [saveAgent, { loading: saving }] = useMutation<{ saveLibraryAgent: { ok: boolean; diff: string; error: string | null } }>(SAVE_LIBRARY_AGENT);
  const [saveLook, { loading: savingLook }] = useMutation(SAVE_AGENT_LOOK);
  const input = agentInput(form);
  const state = saveState(form);
  const inputKey = JSON.stringify(input);

  useEffect(() => {
    let current = true;
    setPreview(null);
    setPreviewError('');
    runPreview({ variables: { input: JSON.parse(inputKey), machine } })
      .then((result) => { if (current) setPreview(result.data?.previewLibraryAgent ?? null); })
      .catch((failure: unknown) => { if (current) setPreviewError(failure instanceof Error ? failure.message : 'The preview failed'); });
    return () => { current = false; };
  }, [inputKey, machine, runPreview]);

  const save = async () => {
    setSaveError('');
    try {
      const result = (await saveAgent({ variables: { input, machine } })).data?.saveLibraryAgent;
      if (!result?.ok) throw new Error(result?.error || 'The kit refused the change');
      await saveLook({ variables: { input: { slug: form.slug, displayName: form.displayName, initials: form.initials, color: form.color } } });
      if (avatar) await uploadAvatar(form.slug, avatar);
      await client.refetchQueries({ include: [GET_AGENT_LOOKS] });
      onSaved();
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Save failed');
    }
  };

  const counts = diffCounts(preview?.diff ?? '');
  const busy = saving || savingLook;
  const others = (machines ?? []).filter((item) => item.name !== CHAT_MACHINE);

  return (
    <section aria-label="Review before saving">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack} disabled={busy}><ArrowLeft size={14} aria-hidden="true" />Back to the editor</Button>
        <h2 className="font-display text-2xl font-bold">Review {form.slug}</h2>
        {state.draft && <Badge variant="warn">Draft</Badge>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <span className="font-mono text-sm">~/.claude/agents/{form.slug}.md</span>
            {preview && <span className="font-mono text-xs"><span className="text-status-merged">+{counts.added}</span> <span className="text-status-conflict">−{counts.removed}</span></span>}
          </div>
          {previewing && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Asking the kit on {machine} for the diff</p>}
          {previewError && <p className="p-4 text-sm text-status-conflict" role="alert">{previewError}</p>}
          {preview && (
            <pre className="max-h-[560px] overflow-auto py-2 font-mono text-xs leading-relaxed">
              {diffLines(preview.diff).map((line, index) => <div key={index} className={cn('px-4 whitespace-pre-wrap', LINE[line.kind])}>{line.text || ' '}</div>)}
              {preview.diff === '' && <div className="px-4 text-muted-foreground">No change to the file.</div>}
            </pre>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h3 className="mb-3 font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Checks</h3>
            {!preview && !previewError && <p className="text-sm text-muted-foreground">Waiting for the preview.</p>}
            <ul className="flex flex-col gap-2">
              {preview?.checks.map((check, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  {check.ok ? <CheckCircle2 size={16} className="mt-0.5 flex-none text-status-merged" aria-label="Passed" /> : <XCircle size={16} className="mt-0.5 flex-none text-status-warn" aria-label="Not passed" />}
                  <span>{check.text}</span>
                </li>
              ))}
            </ul>
            <p className={cn('mt-3 text-xs', state.draft ? 'text-status-warn' : 'text-muted-foreground')}>{state.label}</p>
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Written to</h3>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Target machine">
              {[{ name: CHAT_MACHINE, text: 'Workspace (Coder)' }, ...others.map((item) => ({ name: item.name, text: `${item.name[0].toUpperCase()}${item.name.slice(1)}${item.online ? '' : ', offline'}` }))].map((item) => (
                <button key={item.name} type="button" role="radio" aria-checked={machine === item.name} disabled={busy} onClick={() => setMachine(item.name)} className={cn('flex min-h-11 items-center rounded-md border border-border bg-surface-0 px-3 text-left text-sm font-semibold', machine === item.name && 'border-accent bg-surface-2')}>
                  {item.text}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Written through the kit bridge. The laptop picks it up on its next sync.</p>
          </Card>
          {saveError && <Card className="border-status-conflict text-sm text-status-conflict" role="alert">{saveError}</Card>}
          <Button variant="primary" disabled={!preview || busy} onClick={() => void save()}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{state.draft ? 'Save as draft' : 'Save agent'}
          </Button>
        </div>
      </div>
    </section>
  );
};
