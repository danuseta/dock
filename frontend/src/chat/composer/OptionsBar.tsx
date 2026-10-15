import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { MODE_LABELS, PERMISSION_MODES, effortChoices, type ComposerFeatures, type MachineOptions, type TurnOptions } from './composerLogic';
import { hasChangedChoice, optionsSummary } from './optionsSummary';
import type { TurnOptionsControl } from './useTurnOptions';
import { defaultLabel, defaultsText, modelsText, type SessionMachineOptions } from '../sessionOptions';

interface OptionsBarProps {
  features: ComposerFeatures;
  control: TurnOptionsControl;
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
}

const selectClass = 'h-9 w-full min-w-0 rounded-sm border border-border bg-surface-1 px-2 font-body text-xs text-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 max-[900px]:h-11';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex min-w-[7.5rem] flex-1 flex-col gap-0.5 font-mono text-[0.62rem] text-muted-foreground">
    {label}
    {children}
  </label>
);

const modesOf = (machine: MachineOptions): string[] => PERMISSION_MODES.filter((mode) => machine.modes.includes(mode));

export const OptionsBar: React.FC<OptionsBarProps> = ({ features, control, disabled, open, onToggle }) => {
  const { machineOptions: machine, options } = control;
  if (!machine) return null;
  const showModel = features.model && machine.models.length > 0;
  const efforts = features.effort ? effortChoices(machine.models, options.model) : [];
  const modes = features.mode ? modesOf(machine) : [];
  const showFast = features.fast && machine.fastAvailable;
  if (!showModel && efforts.length === 0 && modes.length === 0 && !showFast) return null;
  const change = (apply: (value: string | null) => void) => (event: React.ChangeEvent<HTMLSelectElement>) => apply(event.target.value || null);
  const value = (field: keyof TurnOptions) => (options[field] as string | null) ?? '';
  const parts = optionsSummary(options, machine, { model: showModel, effort: efforts.length > 0, mode: modes.length > 0, fast: showFast });
  const panelId = 'chat-options-panel';
  const named = machine as SessionMachineOptions;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" role="group" aria-label="Options for this session">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className={cn('flex min-h-11 w-full min-w-0 items-center gap-2 rounded-sm border bg-surface-1 px-3 text-left font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 min-[901px]:hidden', hasChangedChoice(parts) ? 'border-border-accent' : 'border-border')}
        onClick={onToggle}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {parts.map((part, index) => (
            <React.Fragment key={part.key}>
              {index > 0 && <span className="text-muted-foreground" aria-hidden="true">·</span>}
              <span className={cn('min-w-0 truncate', part.key === 'mode' && part.changed ? 'rounded-xs border border-amber-300/60 bg-amber-300/15 px-1.5 font-semibold text-amber-200' : part.changed ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{part.text}</span>
            </React.Fragment>
          ))}
        </span>
        <ChevronDown size={16} aria-hidden="true" className={cn('flex-none text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      <div id={panelId} className={cn('flex-wrap items-end gap-2', open ? 'flex' : 'hidden min-[901px]:flex')}>
      {showModel && (
        <Field label="Model">
          <select className={selectClass} value={value('model')} disabled={disabled} onChange={change(control.setModel)}>
            <option value="">{defaultLabel('model', named)}</option>
            {machine.models.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
          </select>
        </Field>
      )}
      {efforts.length > 0 && (
        <Field label="Effort">
          <select className={selectClass} value={value('effort')} disabled={disabled} onChange={change(control.setEffort)}>
            <option value="">{defaultLabel('effort', named)}</option>
            {efforts.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </Field>
      )}
      {modes.length > 0 && (
        <Field label="Mode">
          <select className={selectClass} value={value('permissionMode')} disabled={disabled} onChange={change(control.setMode)}>
            <option value="">{defaultLabel('permissionMode', named)}</option>
            {modes.map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode] ?? mode}</option>)}
          </select>
        </Field>
      )}
      {showFast && (
        <button
          type="button"
          role="switch"
          aria-checked={options.fast === true}
          disabled={disabled}
          className={cn('inline-flex h-9 min-w-11 flex-none items-center justify-center rounded-sm border px-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 max-[900px]:h-11', options.fast === true ? 'border-accent bg-accent-dim text-foreground' : 'border-border bg-surface-1 text-muted-foreground')}
          onClick={() => control.setFast(options.fast !== true)}
        >
          Fast mode
        </button>
      )}
      <p className="w-full font-mono text-[0.62rem] text-muted-foreground [overflow-wrap:anywhere]">
        Machine defaults: {defaultsText(named)}{machine.models.length > 0 ? ` · Models: ${modelsText(machine.models)}` : ''}
      </p>
      </div>
    </div>
  );
};
