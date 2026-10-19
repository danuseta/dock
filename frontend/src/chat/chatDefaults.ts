import { MODE_LABELS, PERMISSION_MODES, effortChoices, type MachineOptions } from './composer/composerLogic';
import { type Choice, type SessionMachineOptions } from './sessionOptions';

export const CAVEMAN_LEVELS = ['off', 'lite', 'full', 'ultra'] as const;
export type CavemanLevel = (typeof CAVEMAN_LEVELS)[number];
export type RtkSetting = 'on' | 'off';

export const normalizeCaveman = (value: unknown): CavemanLevel => (CAVEMAN_LEVELS.find((level) => level === value) ?? 'full');

export const normalizeRtk = (value: unknown): RtkSetting => (value === 'off' ? 'off' : 'on');

export const cavemanChoices = (): Choice[] => CAVEMAN_LEVELS.map((level) => ({ value: level, label: level }));

const defaultChoice: Choice = { value: '', label: 'Default' };

const withSaved = (choices: Choice[], saved: string): Choice[] => (
  saved === '' || choices.some((choice) => choice.value === saved) ? choices : [...choices, { value: saved, label: `${saved} (not offered)` }]
);

export const settingModelChoices = (machine: SessionMachineOptions | undefined, saved: string): Choice[] => withSaved([
  defaultChoice,
  ...(machine?.models ?? []).map((model) => ({ value: model.value, label: model.label })),
], saved);

export const settingEffortChoices = (machine: SessionMachineOptions | undefined, model: string, saved: string): Choice[] => {
  const models = machine?.models ?? [];
  const wanted = model || machine?.defaults?.model || null;
  const known = wanted !== null && models.some((item) => item.value === wanted) ? wanted : null;
  return withSaved([
    defaultChoice,
    ...effortChoices(models, known).map((level) => ({ value: level, label: level })),
  ], saved);
};

export const settingModeChoices = (machine: MachineOptions & SessionMachineOptions | undefined, saved: string): Choice[] => {
  return withSaved([
    defaultChoice,
    ...PERMISSION_MODES.filter((mode) => machine?.modes.includes(mode)).map((mode) => ({ value: mode, label: MODE_LABELS[mode] ?? mode })),
  ], saved);
};
