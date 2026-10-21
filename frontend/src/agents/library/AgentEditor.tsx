import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, Eye, FileText, Lock, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { GET_LIBRARY_AGENT } from '../../graphql/queries';
import { DELETE_LIBRARY_AGENT } from '../../graphql/mutations';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Input, Textarea } from '../../components/ui';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Markdown } from '../../chat/Markdown';
import { CHAT_MACHINE } from '../../chat/messages';
import { agentLook } from '../../chat/activity/transcript';
import { cn } from '../../lib/cn';
import { useAgentLooksStore } from '../../stores/useAgentLooksStore';
import { LookAvatar } from './LookAvatar';
import {
  GUARD_PROFILES, MODELS, SWATCHES, TOOL_OPTIONS, formFromAgent, formProblem, newForm, saveState, titleFromSlug,
  type AgentForm, type LibraryAgentDetail,
} from './libraryLogic';

const AVATAR_MAX_BYTES = 512 * 1024;
const label = 'mb-1.5 block text-xs font-semibold text-secondary-foreground';
const section = 'font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

interface AgentEditorProps {
  slug: string | null;
  known: string[];
  onBack: () => void;
  onReview: (form: AgentForm, avatar: File | null) => void;
  onDeleted: () => void;
  /** The form as it was when the owner went to review, so Back keeps the edits. */
  initial?: { form: AgentForm; avatar: File | null };
}

/** Screen 2 (custom agent) and 2b (kit agent): identity, the markdown body, runtime and guard profile. */
export const AgentEditor: React.FC<AgentEditorProps> = ({ slug, known, onBack, onReview, onDeleted, initial }) => {
  const { data, loading, error } = useQuery<{ libraryAgent: LibraryAgentDetail }>(GET_LIBRARY_AGENT, {
    variables: { slug, machine: CHAT_MACHINE },
    skip: slug === null,
    fetchPolicy: 'network-only',
  });
  const rows = useAgentLooksStore((state) => state.rows);
  const looks = useAgentLooksStore((state) => state.looks);
  const [form, setForm] = useState<AgentForm | null>(() => initial?.form ?? (slug === null ? newForm() : null));
  const [avatar, setAvatar] = useState<File | null>(initial?.avatar ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => (initial?.avatar ? URL.createObjectURL(initial.avatar) : null));
  const [avatarError, setAvatarError] = useState('');
  const [tab, setTab] = useState<'markdown' | 'preview'>('markdown');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [deleteAgent, { loading: deleting }] = useMutation(DELETE_LIBRARY_AGENT);
  const detail = data?.libraryAgent;

  useEffect(() => {
    if (!detail || form) return;
    setForm(formFromAgent(detail, rows.find((row) => row.slug === detail.slug), agentLook(detail.slug)));
  }, [detail, form, rows]);

  useEffect(() => () => { if (avatarUrl) URL.revokeObjectURL(avatarUrl); }, [avatarUrl]);

  const savedAvatar = form && !form.create ? looks[form.slug]?.avatarUrl ?? null : null;
  const problem = useMemo(() => {
    if (!form) return null;
    if (form.create && known.includes(form.slug)) return `An agent named ${form.slug} already exists`;
    return formProblem(form);
  }, [form, known]);

  if (slug !== null && loading && !form) return <LoadingSkeleton />;
  if (slug !== null && error && !form) {
    return (
      <Card className="border-status-conflict text-status-conflict" role="alert">
        <p>The agent failed to load: {error.message}</p>
        <Button size="sm" className="mt-3" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />Back to the library</Button>
      </Card>
    );
  }
  if (!form) return null;

  const kit = form.source === 'kit';
  const update = (patch: Partial<AgentForm>) => setForm((current) => (current ? { ...current, ...patch } : current));
  const state = saveState(form);
  const toggleTool = (tool: string) => update({ tools: form.tools.includes(tool) ? form.tools.filter((item) => item !== tool) : [...form.tools, tool] });
  const pickAvatar = (file: File | undefined) => {
    setAvatarError('');
    if (!file) return;
    if (file.type !== 'image/png') return setAvatarError('Use a PNG image. SVG is not accepted because DOCK cannot clean it.');
    if (file.size > AVATAR_MAX_BYTES) return setAvatarError('The image is larger than 512 KB.');
    setAvatar(file);
    setAvatarUrl(URL.createObjectURL(file));
  };
  const remove = async () => {
    setDeleteError('');
    try {
      const result = (await deleteAgent({ variables: { slug: form.slug, machine: CHAT_MACHINE } })).data?.deleteLibraryAgent;
      if (!result?.ok) throw new Error(result?.error || 'The kit refused to delete the agent');
      setConfirmDelete(false);
      onDeleted();
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : 'Delete failed');
      setConfirmDelete(false);
    }
  };
  const extraTools = form.tools.filter((tool) => !TOOL_OPTIONS.some((option) => option.id === tool));

  return (
    <section aria-label={kit ? 'Kit agent' : 'Custom agent'}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />Library</Button>
        <h2 className="font-display text-2xl font-bold">{form.displayName || (form.slug ? titleFromSlug(form.slug) : 'New agent')}</h2>
        <Badge variant={kit ? 'accent' : 'neutral'}>{kit ? 'SOUS kit' : 'Custom'}</Badge>
        {form.create ? <Badge variant="draft">Not saved</Badge> : state.draft && <Badge variant="warn">Draft</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          {!kit && !form.create && <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true" />Delete</Button>}
          <Button size="sm" onClick={onBack}>Discard</Button>
          <Button size="sm" variant="primary" disabled={problem !== null} title={problem ?? undefined} onClick={() => onReview(form, avatar)}>Review and save</Button>
        </div>
      </div>
      {problem && <p className="mb-3 text-sm text-status-warn" role="status">{problem}</p>}
      {deleteError && <Card className="mb-3 border-status-conflict text-status-conflict" role="alert">{deleteError}</Card>}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <Card className="flex flex-col gap-4 p-5">
          <h3 className={section}>Identity</h3>
          <div className="flex items-center gap-4">
            <LookAvatar initials={form.initials || '?'} color={form.color} src={avatarUrl ?? savedAvatar} size="lg" />
            <div className="flex flex-col gap-1.5">
              <Button size="sm" onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden="true" />Upload image</Button>
              <span className="text-xs text-muted-foreground">Square PNG, 512 KB max</span>
              {avatar && <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => { setAvatar(null); setAvatarUrl(null); }}><X size={12} aria-hidden="true" />Drop the new image</button>}
              <input ref={fileInput} type="file" accept="image/png" className="hidden" aria-label="Avatar image" onChange={(event) => { pickAvatar(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
          </div>
          {avatarError && <p className="text-xs text-status-conflict" role="alert">{avatarError}</p>}
          <div>
            <span className={label}>Colour without an image</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Colour">
              {SWATCHES.map(([hex, name]) => (
                <button key={hex} type="button" aria-label={name} aria-pressed={form.color === hex} onClick={() => update({ color: hex })} className={cn('size-8 rounded-full border-2 border-transparent max-[760px]:size-11', form.color === hex && 'border-foreground')} style={{ background: hex }} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <label><span className={label}>Display name</span><Input value={form.displayName} maxLength={40} onChange={(event) => update({ displayName: event.target.value })} /></label>
            <label><span className={label}>Initials</span><Input value={form.initials} maxLength={3} onChange={(event) => update({ initials: event.target.value })} /></label>
          </div>
          <label>
            <span className={label}>Slug (file name, locked after the first save)</span>
            <div className="relative">
              <Input value={form.slug} disabled={!form.create} className="font-mono" placeholder="qonflo-copy-checker" onChange={(event) => update({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
              {!form.create && <Lock size={14} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" aria-label="Locked" />}
            </div>
          </label>
          <label>
            <span className={label}>Description (Claude reads it to decide when to use the agent)</span>
            <Textarea value={form.description} disabled={kit} rows={4} onChange={(event) => update({ description: event.target.value })} />
          </label>
        </Card>

        <Card className="flex min-w-0 flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-sm border border-border bg-surface-0 p-0.5" role="group" aria-label="Body view">
              {([['markdown', 'Markdown', FileText], ['preview', 'Preview', Eye]] as const).map(([id, text, Icon]) => (
                <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={cn('flex h-8 items-center gap-1.5 rounded-xs px-3 font-display text-xs font-semibold text-secondary-foreground max-[760px]:h-11', tab === id && 'bg-accent text-black')}>
                  <Icon size={14} aria-hidden="true" />{text}
                </button>
              ))}
            </div>
            <span className="font-mono text-xs text-muted-foreground">agents/{form.slug || '<slug>'}.md · body</span>
            {kit && detail?.kitBody != null && detail.kitBody !== form.body && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => update({ body: detail.kitBody ?? form.body })}><RotateCcw size={14} aria-hidden="true" />Restore kit body</Button>
            )}
          </div>
          {tab === 'markdown'
            ? <Textarea aria-label="Agent body" value={form.body} onChange={(event) => update({ body: event.target.value })} className="min-h-[420px] flex-1 font-mono text-xs leading-relaxed" spellCheck={false} />
            : <div className="min-h-[420px] overflow-auto rounded-sm border border-border bg-surface-0 p-4 text-sm">{form.body.trim() ? <Markdown text={form.body} /> : <p className="text-muted-foreground">Nothing to preview yet.</p>}</div>}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4 p-5">
            <h3 className={section}>Runtime</h3>
            <div>
              <span className={label}>Model</span>
              <div className="flex flex-wrap rounded-sm border border-border bg-surface-0 p-0.5" role="radiogroup" aria-label="Model">
                {MODELS.map((model) => (
                  <button key={model} type="button" role="radio" aria-checked={form.model === model} onClick={() => update({ model })} className={cn('h-8 flex-1 rounded-xs px-2 font-mono text-xs font-semibold text-secondary-foreground max-[760px]:h-11', form.model === model && 'bg-accent text-black')}>{model}</button>
                ))}
              </div>
            </div>
            {kit ? (
              <div className="rounded-sm border border-border bg-surface-0 p-3 text-sm">
                <p className="flex items-center gap-1.5 font-semibold"><Lock size={14} aria-hidden="true" />Tools and slug are locked</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{form.tools.join(', ') || 'no tools'} · {form.slug}</p>
              </div>
            ) : (
              <div>
                <span className={label}>Tools (limited by the guard profile)</span>
                <div className="flex flex-col gap-2">
                  {TOOL_OPTIONS.map((tool) => (
                    <label key={tool.id} className="flex min-h-8 items-center gap-2 text-sm">
                      <Checkbox checked={form.tools.includes(tool.id)} onChange={() => toggleTool(tool.id)} />
                      <span>{tool.label}</span>
                      {tool.hint && <span className="text-xs text-muted-foreground">{tool.hint}</span>}
                    </label>
                  ))}
                  {extraTools.length > 0 && <p className="font-mono text-xs text-muted-foreground">Also: {extraTools.join(', ')}</p>}
                </div>
              </div>
            )}
            {!kit && (
              <label className={cn('flex min-h-8 items-center gap-2 text-sm', form.guardProfile === null && 'opacity-60')}>
                <Checkbox checked={form.guardProfile !== null && form.dispatchable} disabled={form.guardProfile === null} onChange={(event) => update({ dispatchable: event.target.checked })} />
                <span>sous runners may dispatch it</span>
              </label>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <h3 className={section}>Guard profile</h3>
            {kit ? (
              <div className="text-sm">
                <p className="flex items-center gap-1.5 font-semibold"><Lock size={14} aria-hidden="true" />Guard locked by the kit</p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-surface-0 p-3 font-mono text-[0.7rem] text-secondary-foreground">{detail?.hooksText || 'No hooks block in this agent.'}</pre>
                <p className="mt-2 text-xs text-muted-foreground">Change it with a PR to claude-config, not from here.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Required. Without a profile the agent is saved as a draft and runners cannot dispatch it.</p>
                <div className="flex flex-col gap-2" role="radiogroup" aria-label="Guard profile">
                  {GUARD_PROFILES.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      role="radio"
                      aria-checked={form.guardProfile === profile.id}
                      onClick={() => update({ guardProfile: form.guardProfile === profile.id ? null : profile.id })}
                      className={cn('flex min-h-11 flex-col items-start gap-0.5 rounded-md border border-border bg-surface-0 px-3 py-2.5 text-left', form.guardProfile === profile.id && 'border-accent bg-surface-2')}
                    >
                      <span className="text-sm font-semibold">{profile.name}</span>
                      <span className="text-xs text-muted-foreground">{profile.detail}</span>
                    </button>
                  ))}
                </div>
                <p className={cn('text-xs', state.draft ? 'text-status-warn' : 'text-status-merged')} role="status">{state.label}</p>
              </>
            )}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${form.slug}?`}
        description="The agent file is removed from the workspace and its avatar from DOCK. This cannot be undone."
        confirmLabel="Delete agent"
        busyLabel="Deleting"
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
};
