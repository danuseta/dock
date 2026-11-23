// Settings › Sous flow: which sous stages run for a ticket, and after each one whether the lead goes on, asks the
// owner first, or stops there. Stored as JSON under AppSettings.sousFlow (profiles, the person's own profile, the
// checkpoint switch and the QA guide switch); a ticket's own profile sits in CacheEntry sous-flow:<KEY>. A profile
// where every stage runs and goes on adds no line, so the sous prompt stays exactly as before the setting.

export const SOUS_FLOW_KEY = 'sousFlow';
export const SOUS_FLOW_CACHE = 'sous-flow';
export const DEFAULT_PROFILE = 'Default';
export const DEFAULT_QA_GUIDE_FIELD = 'customfield_10340';

export const SOUS_STAGE_IDS = ['jira', 'block', 'park', 'plan', 'code', 'loop', 'verify', 'final', 'video', 'publish', 'decide', 'discord', 'qa', 'review', 'status'] as const;
export type SousStageId = (typeof SOUS_STAGE_IDS)[number];

interface StageText { line: string; skipLine?: string; no?: string }

/** What each stage asks of sous, as the prompt says it. */
const STAGE_TEXT: Record<SousStageId, StageText> = {
  jira: { line: 'read the ticket, its contract and the sprint blackboard' },
  block: { line: 'check blocked-by before starting' },
  park: { line: 'park the ticket when the AC is empty, until the owner clicks Confirm in Agents', no: 'park the ticket' },
  plan: { line: 'plan the tasks (sous-planner)' },
  code: { line: 'build each task (sous-ticket-worker)' },
  loop: { line: 'review each task (sous-reviewer LOOP)' },
  verify: { line: 'run tests and type checks (sous-verifier)' },
  final: { line: 'final review, every AC line to path:line' },
  video: { line: 'make the demo video', skipLine: 'record a GUESS "no video"' },
  publish: { line: 'commit, push and open the pull request (sous-publisher)' },
  decide: { line: 'open the PR as draft while any GUESS/USULAN decision or issue is open; DOCK marks it ready after the owner confirms in Decisions', no: 'mark the PR ready' },
  discord: { line: 'post the summary to Discord' },
  qa: { line: 'run local QA on the PR' },
  review: { line: 'review the PR after the owner says "on it" in the Discord pr-review thread', no: 'review the PR' },
  status: { line: 'move the Jira status after merge' },
};

/** Stages a flow can never skip: the next stages need what they make, and only DOCK marks a pull request ready. */
export const REQUIRED_SOUS_STAGES: readonly SousStageId[] = ['jira', 'plan', 'code', 'loop', 'decide'];
const LAST_STAGE: SousStageId = 'status';

export interface SousFlowProfile { skip: SousStageId[]; ask: SousStageId[]; stop: SousStageId }
export interface SousFlowSettings {
  profiles: Record<string, SousFlowProfile>;
  /** The person's own profile: what a ticket without a profile of its own runs. */
  mine: string;
  /** "Kirim checkpoint": the lead reports each agent's end to DOCK. */
  checkpoint: boolean;
  /** "Tulis QA guide ke Developer Context": DOCK writes the QA guide block when the ticket moves to UAT. */
  qaGuide: boolean;
  /** The Jira field the QA guide block goes in. */
  qaGuideField: string;
}

export class SousFlowError extends Error {}

const MAX_PROFILES = 20;
const MAX_NAME = 40;
const FIELD_ID = /^customfield_\d{4,6}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const stageIndex = (id: SousStageId) => SOUS_STAGE_IDS.indexOf(id);

/** Every stage runs and goes on. */
export const allRunProfile = (): SousFlowProfile => ({ skip: [], ask: [], stop: LAST_STAGE });

export const defaultSousFlow = (): SousFlowSettings => ({
  profiles: { [DEFAULT_PROFILE]: allRunProfile() },
  mine: DEFAULT_PROFILE,
  checkpoint: true,
  qaGuide: false,
  qaGuideField: DEFAULT_QA_GUIDE_FIELD,
});

function stageList(value: unknown, name: string, field: string): SousStageId[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new SousFlowError(`${name}.${field} must be a list`);
  const ids: SousStageId[] = [];
  for (const item of value) {
    if (!SOUS_STAGE_IDS.includes(item as SousStageId)) throw new SousFlowError(`Unknown stage ${String(item)} in ${name}.${field}`);
    if (!ids.includes(item as SousStageId)) ids.push(item as SousStageId);
  }
  return ids.sort((a, b) => stageIndex(a) - stageIndex(b));
}

/** One profile, checked: known stages, nothing required skipped, and the stop point itself runs. */
export function parseProfile(input: unknown, name = 'profile'): SousFlowProfile {
  if (!isRecord(input)) throw new SousFlowError(`${name} must be an object`);
  const skip = stageList(input.skip, name, 'skip');
  const stop = (input.stop ?? LAST_STAGE) as SousStageId;
  if (!SOUS_STAGE_IDS.includes(stop)) throw new SousFlowError(`Unknown stop stage ${String(input.stop)} in ${name}`);
  const required = skip.find((id) => REQUIRED_SOUS_STAGES.includes(id));
  if (required) throw new SousFlowError(`Stage ${required} cannot be skipped`);
  if (skip.includes(stop)) throw new SousFlowError(`${name} stops at ${stop}, so ${stop} cannot be skipped`);
  const ask = stageList(input.ask, name, 'ask').filter((id) => !skip.includes(id) && id !== stop);
  return { skip, ask, stop };
}

/** The settings from their JSON; a field left out keeps its default. A wrong value is an error. */
export function parseSousFlow(raw: string): SousFlowSettings {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new SousFlowError('The sous flow is not valid JSON'); }
  if (!isRecord(input)) throw new SousFlowError('The sous flow must be an object');
  const fallback = defaultSousFlow();
  const profiles: Record<string, SousFlowProfile> = {};
  if (input.profiles !== undefined) {
    if (!isRecord(input.profiles)) throw new SousFlowError('profiles must be an object');
    const entries = Object.entries(input.profiles);
    if (entries.length > MAX_PROFILES) throw new SousFlowError(`A maximum of ${MAX_PROFILES} profiles is supported`);
    for (const [rawName, profile] of entries) {
      const name = rawName.trim();
      if (!name || name.length > MAX_NAME) throw new SousFlowError(`A profile name has 1 to ${MAX_NAME} characters`);
      profiles[name] = parseProfile(profile, name);
    }
  }
  if (!profiles[DEFAULT_PROFILE]) profiles[DEFAULT_PROFILE] = allRunProfile();
  const mine = typeof input.mine === 'string' && profiles[input.mine.trim()] ? input.mine.trim() : fallback.mine;
  for (const field of ['checkpoint', 'qaGuide'] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') throw new SousFlowError(`${field} must be true or false`);
  }
  const qaGuideField = input.qaGuideField === undefined || input.qaGuideField === '' ? fallback.qaGuideField : String(input.qaGuideField).trim();
  if (!FIELD_ID.test(qaGuideField)) throw new SousFlowError('qaGuideField must be a Jira field id such as customfield_10340');
  return {
    profiles,
    mine,
    checkpoint: typeof input.checkpoint === 'boolean' ? input.checkpoint : fallback.checkpoint,
    qaGuide: typeof input.qaGuide === 'boolean' ? input.qaGuide : fallback.qaGuide,
    qaGuideField,
  };
}

/** The saved settings, or the defaults when none are saved or they no longer read. */
export function readSousFlow(raw: string | null | undefined): SousFlowSettings {
  if (!raw) return defaultSousFlow();
  try { return parseSousFlow(raw); } catch { return defaultSousFlow(); }
}

export const isAllRun = (profile: SousFlowProfile) => profile.skip.length === 0 && profile.ask.length === 0 && profile.stop === LAST_STAGE;

/** The profile a ticket runs: its own when it names one that exists, else the person's own profile. */
export function profileFor(settings: SousFlowSettings, ticketProfile: string | null | undefined): { name: string; profile: SousFlowProfile } {
  const name = ticketProfile && settings.profiles[ticketProfile] ? ticketProfile : settings.mine;
  return { name, profile: settings.profiles[name] ?? allRunProfile() };
}

/**
 * The prompt lines a profile adds to the sous prompt. A profile where every stage runs and goes on adds none, so the
 * prompt is exactly as it was before the setting.
 */
export function flowLines(profile: SousFlowProfile): string[] {
  if (isAllRun(profile)) return [];
  const stop = stageIndex(profile.stop);
  const lines: string[] = [];
  const skipped = profile.skip.filter((id) => stageIndex(id) <= stop);
  if (skipped.length) {
    lines.push(`Sous flow: skip ${skipped.map((id) => STAGE_TEXT[id].line + (STAGE_TEXT[id].skipLine ? ` (instead ${STAGE_TEXT[id].skipLine})` : '')).join('; ')}.`);
  }
  for (const id of profile.ask.filter((item) => stageIndex(item) < stop)) {
    lines.push(`Sous flow: after "${STAGE_TEXT[id].line}", write a checkpoint and wait for the owner to say go on before the next stage.`);
  }
  if (profile.stop !== LAST_STAGE) {
    const after = SOUS_STAGE_IDS.slice(stop + 1).map((id) => STAGE_TEXT[id].no ?? STAGE_TEXT[id].line.split(' (')[0]);
    lines.push(`Sous flow: stop after "${STAGE_TEXT[profile.stop].line}": write the last checkpoint and end the run. Do not ${after.join('; do not ')}.`);
  }
  return lines;
}

/** The settings for the query, every default filled in. */
export const storedSousFlow = (raw: string | null | undefined) => JSON.stringify(readSousFlow(raw));
