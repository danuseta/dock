import { MODE_LABELS, PERMISSION_MODES, effortChoices, type MachineOptions } from './composer/composerLogic';
import { type Choice, type SessionMachineOptions } from './sessionOptions';

export const CAVEMAN_LEVELS = ['off', 'lite', 'full', 'ultra'] as const;
export type CavemanLevel = (typeof CAVEMAN_LEVELS)[number];
export type RtkSetting = 'on' | 'off';

export const normalizeCaveman = (value: unknown): CavemanLevel => (CAVEMAN_LEVELS.find((level) => level === value) ?? 'full');

export const normalizeRtk = (value: unknown): RtkSetting => (value === 'off' ? 'off' : 'on');

export const cavemanChoices = (): Choice[] => CAVEMAN_LEVELS.map((level) => ({ value: level, label: level }));

// Shown only while neither Settings nor Claude Code on the machine names a value.
const notSet = (saved: string): Choice[] => (saved === '' ? [{ value: '', label: 'Not set' }] : []);

const withSaved = (choices: Choice[], saved: string): Choice[] => (
  saved === '' || choices.some((choice) => choice.value === saved) ? choices : [...choices, { value: saved, label: `${saved} (not offered)` }]
);

export const settingModelChoices = (machine: SessionMachineOptions | undefined, saved: string): Choice[] => withSaved([
  ...notSet(saved),
  ...(machine?.models ?? []).map((model) => ({ value: model.value, label: model.label })),
], saved);

export const settingEffortChoices = (machine: SessionMachineOptions | undefined, model: string, saved: string): Choice[] => {
  const models = machine?.models ?? [];
  const wanted = model || machine?.defaults?.model || null;
  const known = wanted !== null && models.some((item) => item.value === wanted) ? wanted : null;
  return withSaved([
    ...notSet(saved),
    ...effortChoices(models, known).map((level) => ({ value: level, label: level })),
  ], saved);
};

export const settingModeChoices = (machine: MachineOptions & SessionMachineOptions | undefined, saved: string): Choice[] => {
  return withSaved([
    ...notSet(saved),
    ...PERMISSION_MODES.filter((mode) => machine?.modes.includes(mode)).map((mode) => ({ value: mode, label: MODE_LABELS[mode] ?? mode })),
  ], saved);
};
