import React, { useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { Check, ChevronDown, ChevronUp, Cpu, Settings } from 'lucide-react';
import { UPDATE_SETTINGS } from '../graphql/mutations';
import { GET_SETTINGS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { CHAT_MACHINE_OPTIONS } from './composer/documents';
import type { TurnOptionsControl } from './composer/useTurnOptions';
import { choiceToSave, defaultsToSave, popoverRows } from './headerState';
import { modelName, type OptionField, type SessionMachineOptions } from './sessionOptions';

interface ModelPopoverProps {
  control: TurnOptionsControl;
  machine: string;
  fallbackLabel: string;
  disabled: boolean;
}

const labelClass = 'font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

export const ModelPopover: React.FC<ModelPopoverProps> = ({ control, machine, fallbackLabel, disabled }) => {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [updateSettings, { loading: saving }] = useMutation<{ updateSettings: boolean }>(UPDATE_SETTINGS, { refetchQueries: [{ query: CHAT_MACHINE_OPTIONS, variables: { machine } }, { query: GET_SETTINGS }] });
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
  const label = (model && modelName(machineOptions?.models ?? [], model.value)) || fallbackLabel;
  const setters: Record<OptionField, (value: string | null) => void> = { model: control.setModel, effort: control.setEffort, permissionMode: control.setMode };
  const toSave = defaultsToSave(rows);
  const pending = Object.keys(toSave).length > 0;
  const off = disabled || rows.length === 0;

  const makeDefault = async () => {
    try {
      const { data } = await updateSettings({ variables: { input: toSave } });
      setSaved(data?.updateSettings === true);
    } catch {
      setSaved(false);
    }
  };

  return (
    <div ref={root} className="flex-none">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={off}
        title={!disabled && rows.length === 0 ? 'The workspace has not sent its model list yet' : 'Model, effort and mode'}
        className={cn('inline-flex h-7 max-w-[14rem] max-[760px]:max-w-[7.5rem] flex-none items-center gap-1.5 rounded-xs border border-border-glow px-2 font-mono text-[0.68rem] font-bold text-foreground hover:bg-surface-1 disabled:cursor-default disabled:text-secondary-foreground disabled:hover:bg-transparent max-[900px]:h-11')}
        onClick={() => setOpen((current) => !current)}
      >
        <Cpu size={12} aria-hidden="true" className="flex-none" />
        <span className="min-w-0 truncate">{label}</span>
        {!off && (open ? <ChevronUp size={12} aria-hidden="true" className="flex-none" /> : <ChevronDown size={12} aria-hidden="true" className="flex-none" />)}
      </button>
      {open && machineOptions && (
        <div role="dialog" aria-label="Model, effort and mode" className="absolute top-full right-3 z-[55] mt-1 flex w-[min(21rem,calc(100vw-2rem))] flex-col gap-2.5 rounded-sm border border-border-glow bg-surface-1 p-3 shadow-card">
          {rows.map((row) => (
            <div key={row.field} className="flex flex-col gap-1">
              <span id={`popover-${row.field}`} className={labelClass}>{row.label}</span>
              <div role="radiogroup" aria-labelledby={`popover-${row.field}`} className={row.field === 'model' ? 'flex max-h-48 flex-col gap-px overflow-y-auto rounded-xs border border-border bg-border' : 'flex flex-wrap gap-px overflow-hidden rounded-xs border border-border bg-border'}>
                {row.options.map((option) => {
                  const on = option.value === row.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1 font-mono text-[0.68rem] max-[900px]:min-h-11', row.field === 'model' ? 'justify-start text-left' : 'flex-1 justify-center', on ? 'bg-surface-hover font-bold text-foreground' : 'bg-surface-1 text-secondary-foreground hover:bg-surface-2')}
                      onClick={() => { setSaved(null); setters[row.field](choiceToSave(row.field, option.value, machineOptions)); }}
                    >
                      {row.field === 'model' && <Check size={12} aria-hidden="true" className={cn('flex-none', !on && 'invisible')} />}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t border-border pt-2">
            <span className="font-mono text-[0.62rem] text-muted-foreground">Applies from the next turn</span>
            {(pending || saved !== null) && (
              <button type="button" disabled={saving || !pending} className="ml-auto inline-flex items-center gap-1 font-mono text-[0.66rem] text-secondary-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-secondary-foreground max-[900px]:min-h-11" onClick={() => void makeDefault()}>
                <Settings size={12} aria-hidden="true" />
                {saved === null ? 'Make default' : saved ? 'Saved as default' : 'Could not save'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
