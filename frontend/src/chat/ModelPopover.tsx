import React, { useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { ChevronDown } from 'lucide-react';
import { UPDATE_SETTINGS } from '../graphql/mutations';
import { GET_SETTINGS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { CHAT_MACHINE_OPTIONS } from './composer/documents';
import type { TurnOptionsControl } from './composer/useTurnOptions';
import { SETTING_KEY, choiceToSave, popoverRows } from './headerState';
import { modelName, type OptionField, type SessionMachineOptions } from './sessionOptions';

interface ModelPopoverProps {
  control: TurnOptionsControl;
  machine: string;
  fallbackLabel: string;
  disabled: boolean;
  dimmed: boolean;
}

const selectClass = 'h-9 min-w-0 flex-1 rounded-sm border border-border bg-surface-1 px-2 font-body text-xs text-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 max-[900px]:h-11';

export const ModelPopover: React.FC<ModelPopoverProps> = ({ control, machine, fallbackLabel, disabled, dimmed }) => {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ field: OptionField; ok: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [updateSettings] = useMutation<{ updateSettings: boolean }>(UPDATE_SETTINGS, { refetchQueries: [{ query: CHAT_MACHINE_OPTIONS, variables: { machine } }, { query: GET_SETTINGS }] });
  const machineOptions = control.machineOptions as SessionMachineOptions | undefined;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const rows = machineOptions ? popoverRows(control.options, machineOptions) : [];
  const model = rows.find((row) => row.field === 'model');
  const effort = rows.find((row) => row.field === 'effort');
  const modelLabel = model ? modelName(machineOptions?.models ?? [], model.value) : null;
  const label = modelLabel || effort?.value || fallbackLabel;
  const setters: Record<OptionField, (value: string | null) => void> = { model: control.setModel, effort: control.setEffort, permissionMode: control.setMode };

  const makeDefault = async (field: OptionField, value: string) => {
    try {
      const { data } = await updateSettings({ variables: { input: { [SETTING_KEY[field]]: value } } });
      setSaved({ field, ok: data?.updateSettings === true });
    } catch {
      setSaved({ field, ok: false });
    }
  };

  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || rows.length === 0}
        className={cn('inline-flex h-7 max-w-[14rem] max-[760px]:max-w-[7.5rem] flex-none items-center gap-1 rounded-xs border border-border-glow px-2 font-mono text-[0.68rem] font-bold text-secondary-foreground hover:bg-surface-1 disabled:cursor-default disabled:hover:bg-transparent max-[900px]:h-11', dimmed && 'opacity-50')}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">{label}{modelLabel && effort?.value && <span className="max-[760px]:hidden"> · {effort.value}</span>}</span>
        {rows.length > 0 && !disabled && <ChevronDown size={12} aria-hidden="true" className="flex-none" />}
      </button>
      {open && machineOptions && (
        <div role="dialog" aria-label="Model, effort and mode" className="absolute top-full left-0 z-[55] mt-1 flex w-[min(21rem,calc(100vw-2rem))] flex-col gap-2 rounded-sm border border-border-glow bg-surface-1 p-3 shadow-card">
          {rows.map((row) => {
            const changed = choiceToSave(row.field, row.value, machineOptions);
            return (
              <div key={row.field} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <label htmlFor={`popover-${row.field}`} className="w-12 flex-none font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">{row.label}</label>
                  <select id={`popover-${row.field}`} className={selectClass} value={row.value} onChange={(event) => { setSaved(null); setters[row.field](choiceToSave(row.field, event.target.value, machineOptions)); }}>
                    {row.options.map((option) => <option key={option.value} value={option.value}>{option.isDefault ? `${option.label} · def` : option.label}</option>)}
                  </select>
                </div>
                {(changed !== null || saved?.field === row.field) && (
                  <button type="button" className="self-end font-mono text-[0.66rem] text-secondary-foreground underline underline-offset-2 hover:text-foreground max-[900px]:min-h-11" onClick={() => void makeDefault(row.field, row.value)}>
                    {saved?.field === row.field ? (saved.ok ? 'Saved as default' : 'Could not save') : 'Make default'}
                  </button>
                )}
              </div>
            );
          })}
          <p className="font-mono text-[0.62rem] text-muted-foreground">A change applies from the next turn.</p>
        </div>
      )}
    </div>
  );
};
