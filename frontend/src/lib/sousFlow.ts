// Settings › Sous flow as the page reads it: the sous stages from picking the ticket to the Jira status, and for each
// profile which stages are skipped, which ask the owner first, and where the run stops. What the lines say to sous is
// the BFF's; this module only edits the profiles. A profile where every stage runs adds nothing to the prompt.

export type SousStageId = 'jira' | 'block' | 'park' | 'plan' | 'code' | 'loop' | 'verify' | 'final' | 'video' | 'publish' | 'decide' | 'discord' | 'qa' | 'review' | 'status';
export type SousPhase = 'Mulai' | 'Cek' | 'Kirim' | 'Sesudah PR';
export interface SousStage { id: SousStageId; phase: SousPhase; title: string; agent: string; required?: boolean; asks?: boolean }
export interface SousFlowProfile { skip: SousStageId[]; ask: SousStageId[]; stop: SousStageId }
export interface SousFlowSettings { profiles: Record<string, SousFlowProfile>; mine: string; checkpoint: boolean; qaGuide: boolean; qaGuideField: string }
export type StageAfter = 'go' | 'ask' | 'stop';

export const SOUS_STAGES: SousStage[] = [
  { id: 'jira', phase: 'Mulai', title: 'Ambil tiket', agent: 'DOCK · To Do + sprint aktif', required: true },
  { id: 'block', phase: 'Mulai', title: 'Cek blocked-by', agent: 'DOCK · stacked PR kalau dependency di PR Review' },
  { id: 'park', phase: 'Mulai', title: 'Parkir kalau AC kosong', agent: 'owner · Confirm' },
  { id: 'plan', phase: 'Mulai', title: 'Rencana kerja', agent: 'sous-planner · opus', required: true, asks: true },
  { id: 'code', phase: 'Mulai', title: 'Ngoding per task', agent: 'sous-ticket-worker · sonnet', required: true, asks: true },
  { id: 'loop', phase: 'Cek', title: 'Review loop', agent: 'sous-reviewer LOOP · maks 2 balik', required: true, asks: true },
  { id: 'verify', phase: 'Cek', title: 'Verify', agent: 'sous-verifier · tes + tsc', asks: true },
  { id: 'final', phase: 'Cek', title: 'Review akhir', agent: 'sous-reviewer FINAL · opus', asks: true },
  { id: 'video', phase: 'Kirim', title: 'Video demo', agent: 'demo-video · BE didemo lewat UI' },
  { id: 'publish', phase: 'Kirim', title: 'Publish', agent: 'sous-publisher · commit, push, PR' },
  { id: 'decide', phase: 'Kirim', title: 'Decisions', agent: 'owner · DOCK tandain ready', required: true },
  { id: 'discord', phase: 'Kirim', title: 'Post Discord', agent: 'DOCK broadcast · PR ready + video' },
  { id: 'qa', phase: 'Sesudah PR', title: 'QA lokal', agent: 'qa-local · di PR, boleh pas draft' },
  { id: 'review', phase: 'Sesudah PR', title: 'Review PR', agent: 'auto review · setelah on it' },
  { id: 'status', phase: 'Sesudah PR', title: 'Status Jira', agent: 'DOCK · In Progress → PR Review → UAT MERGED' },
];

export const DEFAULT_PROFILE = 'Default';
const LAST: SousStageId = 'status';
const IDS = SOUS_STAGES.map((stage) => stage.id);

export const stageIndex = (id: string) => IDS.indexOf(id as SousStageId);
export const stageOf = (id: string) => SOUS_STAGES.find((stage) => stage.id === id) ?? null;
export const allRun = (): SousFlowProfile => ({ skip: [], ask: [], stop: LAST });
export const isAllRun = (profile: SousFlowProfile) => profile.skip.length === 0 && profile.ask.length === 0 && profile.stop === LAST;
export const defaultSettings = (): SousFlowSettings => ({ profiles: { [DEFAULT_PROFILE]: allRun() }, mine: DEFAULT_PROFILE, checkpoint: true, qaGuide: false, qaGuideField: 'customfield_10340' });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const ids = (value: unknown): SousStageId[] => (Array.isArray(value) ? value.filter((id): id is SousStageId => IDS.includes(id as SousStageId)) : []);

/** The settings from the sousFlow query; an empty or unreadable value is the default, where every stage runs. */
export function parseSettings(raw: string | null | undefined): SousFlowSettings {
  const fallback = defaultSettings();
  if (!raw) return fallback;
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return fallback; }
  if (!isRecord(input)) return fallback;
  const profiles: Record<string, SousFlowProfile> = {};
  for (const [name, value] of Object.entries(isRecord(input.profiles) ? input.profiles : {})) {
    if (!isRecord(value)) continue;
    profiles[name] = { skip: ids(value.skip), ask: ids(value.ask), stop: IDS.includes(value.stop as SousStageId) ? value.stop as SousStageId : LAST };
  }
  if (!profiles[DEFAULT_PROFILE]) profiles[DEFAULT_PROFILE] = allRun();
  return {
    profiles,
    mine: typeof input.mine === 'string' && profiles[input.mine] ? input.mine : DEFAULT_PROFILE,
    checkpoint: input.checkpoint !== false,
    qaGuide: input.qaGuide === true,
    qaGuideField: typeof input.qaGuideField === 'string' && input.qaGuideField ? input.qaGuideField : fallback.qaGuideField,
  };
}

export const profileNames = (settings: SousFlowSettings) => [DEFAULT_PROFILE, ...Object.keys(settings.profiles).filter((name) => name !== DEFAULT_PROFILE)];

/** What runs after a stage: go on, ask the owner first, or stop there. */
export const afterOf = (profile: SousFlowProfile, id: SousStageId): StageAfter => (profile.stop === id && id !== LAST ? 'stop' : profile.ask.includes(id) ? 'ask' : 'go');

const sorted = (list: SousStageId[]) => [...new Set(list)].sort((a, b) => stageIndex(a) - stageIndex(b));

/** Runs or skips a stage. A required stage and the stop point always run. */
export function setRuns(profile: SousFlowProfile, id: SousStageId, runs: boolean): SousFlowProfile {
  if (!runs && (stageOf(id)?.required || profile.stop === id)) return profile;
  return runs
    ? { ...profile, skip: profile.skip.filter((item) => item !== id) }
    : { ...profile, skip: sorted([...profile.skip, id]), ask: profile.ask.filter((item) => item !== id) };
}

/** Sets what happens after a stage. A flow has one stop point; moving it off a stage makes the run go to the end. */
export function setAfter(profile: SousFlowProfile, id: SousStageId, after: StageAfter): SousFlowProfile {
  if (profile.skip.includes(id)) return profile;
  const ask = profile.ask.filter((item) => item !== id);
  if (after === 'stop') return { ...profile, ask, stop: id };
  const stop = profile.stop === id ? LAST : profile.stop;
  return { ...profile, stop, ask: after === 'ask' && id !== LAST ? sorted([...ask, id]) : ask };
}

/** The stages that run, up to the stop point. */
export const runningStages = (profile: SousFlowProfile) => SOUS_STAGES.filter((stage) => stageIndex(stage.id) <= stageIndex(profile.stop) && !profile.skip.includes(stage.id));

/** The first stage that runs after the stop point, which "Lanjut" goes on from; null when the flow runs to the end. */
export function stageAfterStop(profile: SousFlowProfile): SousStage | null {
  if (profile.stop === LAST) return null;
  return SOUS_STAGES.slice(stageIndex(profile.stop) + 1).find((stage) => !profile.skip.includes(stage.id)) ?? null;
}

/** The chat message "Lanjut" sends after a stop. */
export const continueText = (stage: SousStage) => `Lanjut dari ${stage.title}`;

/** A name for a new profile that no profile has yet. */
export function newProfileName(settings: SousFlowSettings): string {
  let n = 1;
  while (settings.profiles[`Profil baru ${n}`]) n += 1;
  return `Profil baru ${n}`;
}

/** A chat message that starts sous on a ticket: the only message a session flow adds its lines to. */
export const startsSous = (text: string) => /^\s*pakai skill sous\s*:\s*kerjakan\b/i.test(text);

export const withProfile = (settings: SousFlowSettings, name: string, profile: SousFlowProfile): SousFlowSettings => ({ ...settings, profiles: { ...settings.profiles, [name]: profile } });

/** Drops a profile; Default stays, and a person whose own profile it was goes back to Default. */
export function removeProfile(settings: SousFlowSettings, name: string): SousFlowSettings {
  if (name === DEFAULT_PROFILE || !settings.profiles[name]) return settings;
  const profiles = { ...settings.profiles };
  delete profiles[name];
  return { ...settings, profiles, mine: settings.mine === name ? DEFAULT_PROFILE : settings.mine };
}

/** Renames a profile; Default keeps its name, and a name another profile has is refused (null). */
export function renameProfile(settings: SousFlowSettings, from: string, input: string): SousFlowSettings | null {
  const to = input.trim().slice(0, 40);
  if (!to || from === DEFAULT_PROFILE || !settings.profiles[from]) return null;
  if (to === from) return settings;
  if (settings.profiles[to]) return null;
  const profiles = Object.fromEntries(Object.entries(settings.profiles).map(([name, profile]) => [name === from ? to : name, profile]));
  return { ...settings, profiles, mine: settings.mine === from ? to : settings.mine };
}
