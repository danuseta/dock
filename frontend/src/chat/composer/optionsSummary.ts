import { MODE_LABELS, type MachineOptions, type TurnOptions } from './composerLogic';

export interface SummaryPart {
  key: 'model' | 'effort' | 'mode' | 'fast';
  text: string;
  changed: boolean;
}

export const OPTIONS_OPEN_KEY = 'dock.chat.optionsOpen';

export const optionsSummary = (
  options: TurnOptions,
  machine: MachineOptions,
  shown: { model: boolean; effort: boolean; mode: boolean; fast: boolean },
): SummaryPart[] => {
  const parts: SummaryPart[] = [];
  if (shown.model) {
    const label = machine.models.find((item) => item.value === options.model)?.label ?? options.model;
    parts.push({ key: 'model', text: label ?? 'Default model', changed: options.model !== null });
  }
  if (shown.effort) parts.push({ key: 'effort', text: options.effort ? `${options.effort} effort` : 'Default effort', changed: options.effort !== null });
  if (shown.mode) {
    const mode = options.permissionMode;
    const changed = mode !== null && mode !== 'default';
    parts.push({ key: 'mode', text: changed ? `${MODE_LABELS[mode] ?? mode} mode` : 'Default mode', changed });
  }
  if (shown.fast && options.fast === true) parts.push({ key: 'fast', text: 'Fast', changed: true });
  return parts;
};

export const summaryText = (parts: readonly SummaryPart[]): string => parts.map((part) => part.text).join(' · ');

export const hasChangedChoice = (parts: readonly SummaryPart[]): boolean => parts.some((part) => part.changed);

export const parseOpen = (raw: string | null): boolean => raw === '1';

export const readOpen = (): boolean => {
  try { return parseOpen(window.localStorage.getItem(OPTIONS_OPEN_KEY)); } catch { return false; }
};

export const writeOpen = (open: boolean): void => {
  try { window.localStorage.setItem(OPTIONS_OPEN_KEY, open ? '1' : '0'); } catch { /* Preference storage is optional. */ }
};
