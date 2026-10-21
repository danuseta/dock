import { randomUUID } from 'node:crypto';
import { OrchestratorInputError } from './orchestrator';

export const AGENT_OPS = ['list', 'get', 'put', 'preview', 'delete'] as const;
export type AgentOp = typeof AGENT_OPS[number];
export const GUARD_PROFILES = ['read', 'worktree', 'browser', 'board'] as const;
export const AGENT_MODELS = ['haiku', 'sonnet', 'opus', 'inherit'] as const;
export const AGENT_SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;

const JOB_TIMEOUT_MS = 20_000;
const MAX_JOBS_PER_CLAIM = 8;
const MAX_BODY_CHARS = 100_000;
const MAX_DESCRIPTION_CHARS = 1000;
const MAX_TOOLS = 40;
const TOOL = /^[A-Za-z][A-Za-z0-9_:.-]{0,119}$/;

export interface AgentPutInput {
  slug: string;
  create: boolean;
  description: string;
  model: string;
  tools: string[];
  body: string;
  guardProfile: string | null;
  dispatchable: boolean;
}

export interface LibraryAgent {
  slug: string;
  source: 'kit' | 'custom';
  description: string;
  model: string;
  tools: string[];
  guardProfile: string | null;
  hasHooks: boolean;
  dispatchable: boolean;
  locked: { slug: boolean; tools: boolean; hooks: boolean };
}

export interface LibraryAgentDetail extends LibraryAgent { body: string; hooksText: string; kitBody: string | null }

interface Job {
  id: string;
  machine: string;
  op: AgentOp;
  input: unknown;
  handedOut: boolean;
  settle: (error: Error | null, result?: unknown) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const flag = (value: unknown) => value === true;

export function agentSlug(value: unknown): string {
  if (typeof value !== 'string' || !AGENT_SLUG.test(value)) throw new OrchestratorInputError('A slug is 2 to 48 lowercase letters, digits or dashes');
  return value;
}

const guardProfile = (value: unknown): string | null => (
  typeof value === 'string' && (GUARD_PROFILES as readonly string[]).includes(value) ? value : null
);

export function parseAgentInput(input: unknown): AgentPutInput {
  if (!isRecord(input)) throw new OrchestratorInputError('An agent object is required');
  const model = typeof input.model === 'string' && (AGENT_MODELS as readonly string[]).includes(input.model) ? input.model : null;
  if (!model) throw new OrchestratorInputError(`model must be one of ${AGENT_MODELS.join(', ')}`);
  if (input.guardProfile !== null && input.guardProfile !== undefined && !guardProfile(input.guardProfile)) {
    throw new OrchestratorInputError(`guardProfile must be one of ${GUARD_PROFILES.join(', ')}, or empty`);
  }
  const tools = Array.isArray(input.tools) ? [...new Set(input.tools)] : [];
  if (tools.length > MAX_TOOLS || tools.some((tool) => typeof tool !== 'string' || !TOOL.test(tool))) throw new OrchestratorInputError('tools must be tool names');
  if (typeof input.body !== 'string' || input.body.length > MAX_BODY_CHARS) throw new OrchestratorInputError(`The body must be text of at most ${MAX_BODY_CHARS} characters`);
  const description = text(input.description, MAX_DESCRIPTION_CHARS + 1).trim();
  if (!description || description.length > MAX_DESCRIPTION_CHARS) throw new OrchestratorInputError(`A description of at most ${MAX_DESCRIPTION_CHARS} characters is required`);
  const profile = guardProfile(input.guardProfile);
  return {
    slug: agentSlug(input.slug),
    create: flag(input.create),
    description,
    model,
    tools: tools as string[],
    body: input.body,
    guardProfile: profile,
    // Without a guard profile the agent is a draft: no runner may dispatch it.
    dispatchable: profile !== null && flag(input.dispatchable),
  };
}

function parseItem(input: unknown): LibraryAgent {
  if (!isRecord(input) || typeof input.slug !== 'string' || !AGENT_SLUG.test(input.slug)) throw new Error('The bridge sent an agent without a slug');
  const locked = isRecord(input.locked) ? input.locked : {};
  return {
    slug: input.slug,
    source: input.source === 'kit' ? 'kit' : 'custom',
    description: text(input.description, MAX_DESCRIPTION_CHARS),
    model: text(input.model, 40) || 'inherit',
    tools: Array.isArray(input.tools) ? input.tools.filter((tool): tool is string => typeof tool === 'string').slice(0, MAX_TOOLS) : [],
    guardProfile: guardProfile(input.guardProfile),
    hasHooks: flag(input.hasHooks),
    dispatchable: flag(input.dispatchable),
    locked: { slug: locked.slug !== false, tools: flag(locked.tools), hooks: locked.hooks !== false },
  };
}

function parseDetail(input: unknown): LibraryAgentDetail {
  const item = parseItem(input);
  const record = input as Record<string, unknown>;
  return {
    ...item,
    body: text(record.body, MAX_BODY_CHARS),
    hooksText: text(record.hooksText, 20_000),
    kitBody: typeof record.kitBody === 'string' ? record.kitBody.slice(0, MAX_BODY_CHARS) : null,
  };
}

const saveResult = (input: unknown) => (isRecord(input) && input.ok === true
  ? { ok: true, diff: text(input.diff, 200_000), error: null }
  : { ok: false, diff: '', error: (isRecord(input) && text(input.error, 500)) || 'The kit refused the change' });

function parsePreview(input: unknown) {
  if (!isRecord(input)) throw new Error('The bridge sent no preview');
  const checks = Array.isArray(input.checks) ? input.checks : [];
  return {
    diff: text(input.diff, 200_000),
    checks: checks.filter(isRecord).slice(0, 20).map((check) => ({ ok: check.ok === true, text: text(check.text, 300) })),
  };
}

export type MachineState = (machine: string) => Promise<{ online: boolean; capabilities: string[] }>;

/**
 * DOCK -> a machine's kit, for the agent files in its config dir. Jobs ride on the bridge's claim long poll,
 * like wantDoctor, and the bridge posts each answer to /chat/agents/result.
 */
export class AgentBridge {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly machineState: MachineState, private readonly timeoutMs = JOB_TIMEOUT_MS) {}

  /** The jobs a claim hands out: each one once, oldest first. */
  take(machine: string) {
    const out: Array<{ id: string; op: AgentOp; input: unknown }> = [];
    for (const job of this.jobs.values()) {
      if (out.length >= MAX_JOBS_PER_CLAIM) break;
      if (job.machine !== machine || job.handedOut) continue;
      job.handedOut = true;
      out.push({ id: job.id, op: job.op, input: job.input });
    }
    return out;
  }

  async request(machine: string, op: AgentOp, input: unknown): Promise<unknown> {
    const state = await this.machineState(machine);
    if (!state.online) throw new OrchestratorInputError(`The bridge on ${machine} is offline. Start dock-chat run there and try again.`);
    if (!state.capabilities.includes('agents')) throw new OrchestratorInputError(`The kit on ${machine} is too old to manage agents. Update claude-config.`);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.jobs.delete(id);
        reject(new OrchestratorInputError(`The bridge on ${machine} did not answer in time.`));
      }, this.timeoutMs);
      this.jobs.set(id, {
        id, machine, op, input, handedOut: false,
        settle: (error, result) => {
          clearTimeout(timer);
          this.jobs.delete(id);
          if (error) reject(error); else resolve(result);
        },
      });
    });
  }

  /** The bridge's answer to one job. A job that timed out or belongs to another machine is not accepted. */
  receive(input: unknown, machine: string) {
    if (!isRecord(input) || typeof input.id !== 'string') throw new OrchestratorInputError('A result needs the job id');
    const job = this.jobs.get(input.id);
    if (!job || job.machine !== machine || !job.handedOut) return { accepted: false };
    if (typeof input.error === 'string' && input.error) job.settle(new OrchestratorInputError(input.error.slice(0, 500)));
    else job.settle(null, input.result ?? null);
    return { accepted: true };
  }

  private async ask<T>(machine: string, op: AgentOp, input: unknown, parse: (result: unknown) => T): Promise<T> {
    const result = await this.request(machine, op, input);
    try {
      return parse(result);
    } catch (error) {
      throw new OrchestratorInputError(error instanceof Error ? error.message : 'The bridge sent an answer DOCK cannot read');
    }
  }

  async list(machine: string) {
    return this.ask(machine, 'list', {}, (result) => (Array.isArray(result) ? result.map(parseItem) : []));
  }

  async get(machine: string, slug: unknown) {
    return this.ask(machine, 'get', { slug: agentSlug(slug) }, parseDetail);
  }

  async preview(machine: string, input: unknown) {
    return this.ask(machine, 'preview', parseAgentInput(input), parsePreview);
  }

  async put(machine: string, input: unknown) {
    return this.ask(machine, 'put', parseAgentInput(input), saveResult);
  }

  async delete(machine: string, slug: unknown) {
    return this.ask(machine, 'delete', { slug: agentSlug(slug) }, saveResult);
  }
}
