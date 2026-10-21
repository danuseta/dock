export type GuardProfile = 'read' | 'worktree' | 'browser' | 'board';
export type LibraryFilter = 'all' | 'kit' | 'custom' | 'guard';

export interface LibraryAgent {
  slug: string;
  source: 'kit' | 'custom' | string;
  description: string;
  model: string;
  tools: string[];
  guardProfile: GuardProfile | null | string;
  hasHooks: boolean;
  dispatchable: boolean;
  locked: { slug: boolean; tools: boolean; hooks: boolean };
}

export interface LibraryAgentDetail extends LibraryAgent { body: string; hooksText: string; kitBody: string | null }

export interface AgentForm {
  slug: string;
  create: boolean;
  source: 'kit' | 'custom';
  description: string;
  model: string;
  tools: string[];
  body: string;
  guardProfile: GuardProfile | null;
  dispatchable: boolean;
  displayName: string;
  initials: string;
  color: string;
}

export interface LibraryAgentInput {
  slug: string;
  create: boolean;
  description: string;
  model: string;
  tools: string[];
  body: string;
  guardProfile: GuardProfile | null;
  dispatchable: boolean;
}

export const GUARD_PROFILES: Array<{ id: GuardProfile; name: string; detail: string }> = [
  { id: 'read', name: 'Read-only', detail: 'Reads in the worktree and evidence. Bash: read commands only.' },
  { id: 'worktree', name: 'Worktree writer', detail: 'Edit and Write in the ticket worktree. No git, no installs.' },
  { id: 'browser', name: 'Browser', detail: 'playwright-cli against localhost only, writes to evidence.' },
  { id: 'board', name: 'Board writer', detail: 'Writes only the ticket blackboard, like the arbiter.' },
];

export const MODELS = ['haiku', 'sonnet', 'opus', 'inherit'] as const;

export const TOOL_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'Read', label: 'Read', hint: '' },
  { id: 'Bash', label: 'Bash', hint: 'commands the profile allows' },
  { id: 'Edit', label: 'Edit', hint: 'worktree writer only' },
  { id: 'Write', label: 'Write', hint: 'worktree writer only' },
  { id: 'Agent', label: 'Agent', hint: 'runners only' },
  { id: 'Skill', label: 'Skill', hint: '' },
  { id: 'mcp__claude_ai_Atlassian__getJiraIssue', label: 'Jira read', hint: 'getJiraIssue' },
];

export const SWATCHES: Array<[string, string]> = [
  ['#8c9bf0', 'Periwinkle'], ['#5cc0e0', 'Sky'], ['#62cf9f', 'Mint'], ['#e8c56c', 'Sand'], ['#f0a070', 'Apricot'], ['#f08cb4', 'Rose'], ['#c39cf2', 'Lilac'],
];

export const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;

const profileOf = (value: string | null): GuardProfile | null => (GUARD_PROFILES.some((profile) => profile.id === value) ? value as GuardProfile : null);

/** An agent without a hooks block has no guard at all: the "Needs a guard" filter. */
export const needsGuard = (agent: LibraryAgent) => !agent.hasHooks;

export function filterAgents(agents: readonly LibraryAgent[], filter: LibraryFilter, query: string): LibraryAgent[] {
  const needle = query.trim().toLowerCase();
  return agents.filter((agent) => (
    (filter === 'all' || (filter === 'guard' ? needsGuard(agent) : agent.source === filter))
    && (!needle || agent.slug.includes(needle) || agent.description.toLowerCase().includes(needle))
  ));
}

export function filterCounts(agents: readonly LibraryAgent[]): Record<LibraryFilter, number> {
  return {
    all: agents.length,
    kit: agents.filter((agent) => agent.source === 'kit').length,
    custom: agents.filter((agent) => agent.source === 'custom').length,
    guard: agents.filter(needsGuard).length,
  };
}

export const titleFromSlug = (slug: string) => slug.replace(/^(sous|qonflo)-/, '').split('-').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');

export function newForm(): AgentForm {
  return {
    slug: '', create: true, source: 'custom', description: '', model: 'sonnet', tools: ['Read'], body: '', guardProfile: null, dispatchable: false,
    displayName: '', initials: '', color: SWATCHES[6][0],
  };
}

export function formFromAgent(agent: LibraryAgentDetail, look: { displayName?: string | null; initials?: string | null; color?: string | null } | undefined, fallback: { initials: string; color: string }): AgentForm {
  return {
    slug: agent.slug,
    create: false,
    source: agent.source === 'kit' ? 'kit' : 'custom',
    description: agent.description,
    model: agent.model,
    tools: [...agent.tools],
    body: agent.body,
    guardProfile: profileOf(agent.guardProfile),
    dispatchable: agent.dispatchable,
    displayName: look?.displayName || titleFromSlug(agent.slug),
    initials: look?.initials || fallback.initials,
    color: look?.color || (fallback.color.startsWith('#') ? fallback.color : SWATCHES[0][0]),
  };
}

/** Why the form cannot go to review yet, or null. Kit agents only ever change body and model, so only the body is checked. */
export function formProblem(form: AgentForm): string | null {
  if (!SLUG.test(form.slug)) return 'The slug is 2 to 48 lowercase letters, digits or dashes';
  if (!form.body.trim()) return 'The body is empty';
  if (form.source === 'kit') return null;
  if (!form.description.trim()) return 'Write a description, Claude reads it to decide when to use the agent';
  return null;
}

/** What the kit is asked to write. Without a guard profile the agent is saved as a draft that runners cannot dispatch. */
export function agentInput(form: AgentForm): LibraryAgentInput {
  return {
    slug: form.slug,
    create: form.create,
    description: form.description.trim(),
    model: form.model,
    tools: form.tools,
    body: form.body,
    guardProfile: form.guardProfile,
    dispatchable: form.guardProfile !== null && form.dispatchable,
  };
}

export function saveState(form: AgentForm): { draft: boolean; label: string } {
  if (form.source === 'kit') return { draft: false, label: 'Kit agent: body and model only' };
  if (form.guardProfile === null) return { draft: true, label: 'Saved as a draft: pick a guard profile before runners can dispatch it' };
  return form.dispatchable
    ? { draft: false, label: 'Runners may dispatch it' }
    : { draft: false, label: 'Guarded, but runners may not dispatch it' };
}

/** Lines of a unified diff with the kind each one is, for colouring. */
export function diffLines(diff: string): Array<{ kind: 'add' | 'del' | 'hunk' | 'same'; text: string }> {
  return diff.split('\n').filter((line, index, lines) => line !== '' || index < lines.length - 1).map((text) => ({
    kind: text.startsWith('@@') ? 'hunk' : text.startsWith('+') && !text.startsWith('+++') ? 'add' : text.startsWith('-') && !text.startsWith('---') ? 'del' : 'same',
    text,
  }));
}

export const diffCounts = (diff: string) => diffLines(diff).reduce((count, line) => ({
  added: count.added + (line.kind === 'add' ? 1 : 0),
  removed: count.removed + (line.kind === 'del' ? 1 : 0),
}), { added: 0, removed: 0 });
