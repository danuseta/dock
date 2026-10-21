import React, { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { Plus, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { GET_LIBRARY_AGENTS } from '../../graphql/queries';
import { Badge, Button, Card, Input } from '../../components/ui';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { cn } from '../../lib/cn';
import { CHAT_MACHINE } from '../../chat/messages';
import { agentLook } from '../../chat/activity/transcript';
import { useAgentLooksStore } from '../../stores/useAgentLooksStore';
import { GUARD_PROFILES, filterAgents, filterCounts, needsGuard, titleFromSlug, type AgentForm, type LibraryAgent, type LibraryFilter } from './libraryLogic';
import { AgentEditor } from './AgentEditor';
import { AgentReview } from './AgentReview';
import { LookAvatar } from './LookAvatar';

const FILTERS: Array<[LibraryFilter, string]> = [['all', 'All'], ['kit', 'SOUS kit'], ['custom', 'Custom'], ['guard', 'Needs a guard']];

type Screen = { name: 'list' } | { name: 'edit'; slug: string | null; initial?: { form: AgentForm; avatar: File | null } } | { name: 'review'; form: AgentForm; avatar: File | null };

const guardLabel = (agent: LibraryAgent) => {
  if (needsGuard(agent)) return agent.source === 'custom' ? 'No guard profile, draft' : 'No hooks block';
  const profile = GUARD_PROFILES.find((item) => item.id === agent.guardProfile);
  return profile ? `${profile.name} profile` : 'Guarded by the kit';
};

const AgentCard: React.FC<{ agent: LibraryAgent; onOpen: () => void }> = ({ agent, onOpen }) => {
  const rows = useAgentLooksStore((state) => state.rows);
  const row = rows.find((item) => item.slug === agent.slug);
  const look = agentLook(agent.slug, useAgentLooksStore((state) => state.looks));
  const guarded = !needsGuard(agent);
  return (
    <button type="button" onClick={onOpen} className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface-1 p-4 text-left shadow-card transition-colors duration-150 hover:border-border-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      <span className="flex min-w-0 items-center gap-3">
        <LookAvatar initials={look.initials} color={look.color} src={look.avatarUrl} size="md" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-display font-semibold text-foreground">{row?.displayName || titleFromSlug(agent.slug)}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{agent.slug}</span>
        </span>
      </span>
      <span className="line-clamp-2 text-pretty text-sm text-secondary-foreground">{agent.description || 'No description'}</span>
      <span className="flex flex-wrap gap-1.5">
        <Badge>{agent.model}</Badge>
        <Badge>{agent.tools.length} tools</Badge>
        <Badge variant={agent.source === 'kit' ? 'accent' : 'neutral'}>{agent.source === 'kit' ? 'SOUS kit' : 'Custom'}</Badge>
      </span>
      <span className={cn('flex items-center gap-1.5 text-xs font-semibold', guarded ? 'text-status-merged' : 'text-status-warn')}>
        {guarded ? <ShieldCheck size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}
        {guardLabel(agent)}
        {!agent.dispatchable && <span className="ml-auto whitespace-nowrap font-normal text-muted-foreground">not dispatchable</span>}
      </span>
    </button>
  );
};

/** Agents > Library: every agent file of the workspace, opened in the editor, saved through the review screen. */
export const AgentsLibrary: React.FC = () => {
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const { data, loading, error, refetch } = useQuery<{ libraryAgents: LibraryAgent[] }>(GET_LIBRARY_AGENTS, {
    variables: { machine: CHAT_MACHINE },
    fetchPolicy: 'cache-and-network',
    skip: screen.name !== 'list',
  });
  const agents = useMemo(() => data?.libraryAgents ?? [], [data]);
  const counts = filterCounts(agents);
  const shown = filterAgents(agents, filter, query);

  if (screen.name === 'edit') {
    return <AgentEditor slug={screen.slug} known={agents.map((agent) => agent.slug)} onBack={() => setScreen({ name: 'list' })} onReview={(form, avatar) => setScreen({ name: 'review', form, avatar })} onDeleted={() => { setScreen({ name: 'list' }); void refetch(); }} initial={screen.initial} />;
  }
  if (screen.name === 'review') {
    return <AgentReview form={screen.form} avatar={screen.avatar} onBack={() => setScreen({ name: 'edit', slug: screen.form.create ? null : screen.form.slug, initial: { form: screen.form, avatar: screen.avatar } })} onSaved={() => { setScreen({ name: 'list' }); void refetch(); }} />;
  }

  return (
    <section aria-label="Agent library">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents" aria-label="Search agents" className="pl-9" />
        </div>
        <div className="flex flex-wrap rounded-sm border border-border bg-surface-1 p-0.5" role="group" aria-label="Agents shown">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn('flex h-8 items-center gap-1.5 rounded-xs px-3 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150 max-[760px]:h-11', filter === id && 'bg-accent text-black')}
            >
              {label}<span className="font-mono tabular-nums opacity-70">{counts[id]}</span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setScreen({ name: 'edit', slug: null })}><Plus size={14} aria-hidden="true" />New agent</Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Saved to <span className="font-mono">~/.claude/agents/&lt;slug&gt;.md</span> on the workspace through the kit bridge.</p>
      {error && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">The agent library failed to load: {error.message}</Card>}
      {loading && agents.length === 0 && !error && <LoadingSkeleton />}
      {!loading && !error && shown.length === 0 && <Card className="text-sm text-muted-foreground">{agents.length === 0 ? 'No agent files on the workspace yet.' : 'No agent matches this filter.'}</Card>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {shown.map((agent) => <AgentCard key={agent.slug} agent={agent} onOpen={() => setScreen({ name: 'edit', slug: agent.slug })} />)}
      </div>
    </section>
  );
};
