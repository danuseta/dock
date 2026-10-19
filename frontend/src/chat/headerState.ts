import { TICKET_STEPS } from '../lib/ticketDetail';
import { effortChoices, MODE_LABELS, PERMISSION_MODES, type TurnOptions } from './composer/composerLogic';
import type { ChatFileChange } from './status';
import type { OptionField, SessionMachineOptions } from './sessionOptions';
import type { ChatActivity, ThreadGroup } from './activity/activity';

export type DotState = 'running' | 'needs' | 'delayed' | 'disconnected' | 'done';

export const dotState = (facts: { bridgeUp: boolean | undefined; waiting: boolean; busy: boolean; delayed: boolean }): DotState => {
  if (facts.bridgeUp === false) return 'disconnected';
  if (facts.waiting) return 'needs';
  if (facts.busy) return facts.delayed ? 'delayed' : 'running';
  return 'done';
};

export const DOT_LABEL: Record<DotState, string> = {
  running: 'Running',
  needs: 'Needs you',
  delayed: 'Status delayed',
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

export const delayedMinutes = (receivedAt: string, now: number): number => Math.max(1, Math.floor((now - Date.parse(receivedAt)) / 60000));

export const delayedText = (minutes: number): string => (
  `The workspace has not sent a status for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. The numbers above may be old.`
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
  const modes = PERMISSION_MODES.filter((mode) => machine.modes.includes(mode));
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

export function workerSteps(events: readonly ChatActivity[], workerId: string): ChatActivity[] {
  const keep = new Set<string>([workerId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const event of events) {
      if (!keep.has(event.eventId) && event.parentId && keep.has(event.parentId)) {
        keep.add(event.eventId);
        grew = true;
      }
    }
  }
  return events.filter((event) => keep.has(event.eventId));
}

export function workerGroups(byTurn: ReadonlyMap<number, ChatActivity[]>, workerId: string): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  for (const [turnId, events] of byTurn) {
    const steps = workerSteps(events, workerId);
    if (steps.length > 0) groups.push({ key: `worker-${workerId}-${turnId}`, turnId, events: steps, last: false, stopped: false });
  }
  if (groups.length > 0) groups[groups.length - 1].last = true;
  return groups;
}
