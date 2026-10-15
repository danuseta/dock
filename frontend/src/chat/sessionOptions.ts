import { MODE_LABELS, PERMISSION_MODES, effortChoices, type ChatModel, type MachineOptions, type TurnOptions } from './composer/composerLogic';

export interface MachineDefaults {
  model?: string | null;
  effort?: string | null;
  permissionMode?: string | null;
}

export type SessionMachineOptions = MachineOptions & { defaults?: MachineDefaults | null };

export type OptionField = 'model' | 'effort' | 'permissionMode';

export interface Choice {
  value: string;
  label: string;
}

export interface AppliedOption {
  field: OptionField;
  label: string;
  value: string;
  fromDefault: boolean;
}

export const modelName = (models: readonly ChatModel[], value: string | null | undefined): string | null => (
  value ? models.find((item) => item.value === value)?.label ?? value : null
);

export const modeName = (mode: string | null | undefined): string | null => (mode ? MODE_LABELS[mode] ?? mode : null);

/** "Default" alone when the machine did not report a value, otherwise the value in brackets. */
export const defaultLabel = (field: OptionField, machine: SessionMachineOptions | undefined): string => {
  const defaults = machine?.defaults;
  const models = machine?.models ?? [];
  const parts = field === 'model'
    ? [modelName(models, defaults?.model), defaults?.model ? defaults.effort : null]
    : field === 'effort' ? [defaults?.effort] : [modeName(defaults?.permissionMode)];
  const named = parts.filter((part): part is string => Boolean(part));
  return named.length > 0 ? `Default (${named.join(', ')})` : 'Default';
};

export const modelChoices = (machine: SessionMachineOptions): Choice[] => [
  { value: '', label: defaultLabel('model', machine) },
  ...machine.models.map((model) => ({ value: model.value, label: model.label })),
];

export const effortChoicesFor = (machine: SessionMachineOptions, options: TurnOptions | null): Choice[] => {
  const model = options?.model ?? machine.defaults?.model ?? null;
  const known = model !== null && machine.models.some((item) => item.value === model) ? model : null;
  return [
    { value: '', label: defaultLabel('effort', machine) },
    ...effortChoices(machine.models, known).map((level) => ({ value: level, label: level })),
  ];
};

export const modeChoices = (machine: SessionMachineOptions): Choice[] => [
  { value: '', label: defaultLabel('permissionMode', machine) },
  ...PERMISSION_MODES.filter((mode) => machine.modes.includes(mode)).map((mode) => ({ value: mode, label: MODE_LABELS[mode] ?? mode })),
];

/** What a field resolves to for this session, and whether the machine default decides it. */
export const appliedOptions = (options: TurnOptions | null, machine: SessionMachineOptions | undefined): AppliedOption[] => {
  const defaults = machine?.defaults;
  const models = machine?.models ?? [];
  const rows: AppliedOption[] = [];
  const add = (field: OptionField, label: string, own: string | null | undefined, fallback: string | null | undefined, show: (value: string) => string) => {
    const value = own ?? fallback;
    if (value) rows.push({ field, label, value: show(value), fromDefault: !own });
  };
  add('permissionMode', 'Mode', options?.permissionMode, defaults?.permissionMode, (value) => modeName(value) ?? value);
  add('model', 'Model', options?.model, defaults?.model, (value) => modelName(models, value) ?? value);
  add('effort', 'Effort', options?.effort, defaults?.effort, (value) => value);
  return rows;
};

export const appliedText = (rows: readonly AppliedOption[]): string => rows.map((row) => `${row.label.toLowerCase()} ${row.value}`).join(' · ');

const EMPTY: TurnOptions = { model: null, effort: null, permissionMode: null, fast: null };

/** The options to store after the reader picks a value; a model change drops an effort that model does not list. */
export const withChoice = (current: TurnOptions | null, field: OptionField, value: string, machine: SessionMachineOptions): TurnOptions => {
  const next: TurnOptions = { ...(current ?? EMPTY), [field]: value || null };
  if (field !== 'model' || next.effort === null) return next;
  const model = next.model ?? machine.defaults?.model ?? null;
  const levels = model !== null && machine.models.some((item) => item.value === model) ? effortChoices(machine.models, model) : effortChoices(machine.models, null);
  return levels.includes(next.effort) ? next : { ...next, effort: null };
};
