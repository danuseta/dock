import { TICKET_STEPS } from '../lib/ticketDetail';
import { effortChoices, MODE_LABELS, PERMISSION_MODES, type TurnOptions } from './composer/composerLogic';
import type { ChatFileChange } from './status';
import { modelName, type OptionField, type SessionMachineOptions } from './sessionOptions';
import type { TurnOptionsControl } from './composer/useTurnOptions';

export type DotState = 'running' | 'needs' | 'disconnected' | 'done';

export const dotState = (facts: { bridgeUp: boolean | undefined; waiting: boolean; busy: boolean }): DotState => {
  if (facts.bridgeUp === false) return 'disconnected';
  if (facts.waiting) return 'needs';
  if (facts.busy) return 'running';
  return 'done';
};

export const DOT_LABEL: Record<DotState, string> = {
  running: 'Running',
  needs: 'Needs you',
  disconnected: 'Bridge disconnected',
  done: 'Done',
};

export const stageLabel = (index: number): string => (
  index >= 0 && index < TICKET_STEPS.length ? `${TICKET_STEPS[index].name} · step ${index + 1} of ${TICKET_STEPS.length}` : ''
);

export const changedFiles = (files: readonly ChatFileChange[]): ChatFileChange[] => files.filter((file) => file.added !== 0 || file.removed !== 0);

export const filesTotal = (files: readonly ChatFileChange[]): { added: number; removed: number } => (
  files.reduce((total, file) => ({ added: total.added + file.added, removed: total.removed + file.removed }), { added: 0, removed: 0 })
);

export interface PopoverOption { value: string; label: string; isDefault: boolean }

export interface PopoverRow {
  field: OptionField;
  label: string;
  value: string;
  isDefault: boolean;
  options: PopoverOption[];
}

const defaultOf = (field: OptionField, machine: SessionMachineOptions): string => machine.defaults?.[field] ?? '';

export function popoverRows(options: TurnOptions, machine: SessionMachineOptions): PopoverRow[] {
  const value = (field: OptionField) => options[field] ?? defaultOf(field, machine);
  const row = (field: OptionField, label: string, choices: { value: string; label: string }[]): PopoverRow => ({
    field,
    label,
    value: value(field),
    isDefault: value(field) === defaultOf(field, machine),
    options: choices.map((choice) => ({ ...choice, isDefault: choice.value === defaultOf(field, machine) })),
  });
  const model = value('model');
  const known = machine.models.some((item) => item.value === model) ? model : null;
  const rows: PopoverRow[] = [];
  if (machine.models.length > 0) rows.push(row('model', 'Model', machine.models.map((item) => ({ value: item.value, label: item.label }))));
  const efforts = effortChoices(machine.models, known);
  if (efforts.length > 0) rows.push(row('effort', 'Effort', efforts.map((level) => ({ value: level, label: level }))));
  const autoOffered = machine.models.find((item) => item.value === model)?.auto !== false;
  const modes = PERMISSION_MODES.filter((mode) => machine.modes.includes(mode) && (mode !== 'auto' || autoOffered));
  if (modes.length > 0) rows.push(row('permissionMode', 'Mode', modes.map((mode) => ({ value: mode, label: MODE_LABELS[mode] ?? mode }))));
  return rows;
}

export const choiceToSave = (field: OptionField, value: string, machine: SessionMachineOptions): string | null => (
  value === '' || value === defaultOf(field, machine) ? null : value
);

export const SETTING_KEY: Record<OptionField, 'chatDefaultModel' | 'chatDefaultEffort' | 'chatDefaultMode'> = {
  model: 'chatDefaultModel',
  effort: 'chatDefaultEffort',
  permissionMode: 'chatDefaultMode',
};

export const defaultsToSave = (rows: readonly PopoverRow[]): Partial<Record<(typeof SETTING_KEY)[OptionField], string>> => (
  Object.fromEntries(rows.filter((row) => row.value && !row.isDefault).map((row) => [SETTING_KEY[row.field], row.value]))
);

export const modelSummary = (control: TurnOptionsControl, fallbackLabel: string) => {
  const machineOptions = control.machineOptions as SessionMachineOptions | undefined;
  const rows = machineOptions ? popoverRows(control.options, machineOptions) : [];
  const model = rows.find((row) => row.field === 'model');
  const label = (model && modelName(machineOptions?.models ?? [], model.value)) || fallbackLabel;
  return { machineOptions, rows, label };
};
