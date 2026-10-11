import React, { useState } from 'react';
import { useQuery } from '@apollo/client';
import { GET_CHAT_MACHINES } from '../graphql/queries';
import { Select } from '../components/ui';
import { cn } from '../lib/cn';
import { MACHINE_KEY, SLOW_POLL_MS, initialMachine, machineNames, type ChatMachine } from './messages';

const readStoredMachine = () => {
  try { return window.localStorage.getItem(MACHINE_KEY); } catch { return null; }
};

export function useMachineChoice(): { machines: ChatMachine[] | undefined; machine: string; choose: (name: string) => void } {
  const { data } = useQuery<{ chatMachines?: ChatMachine[] | null }>(GET_CHAT_MACHINES, { fetchPolicy: 'cache-and-network', pollInterval: SLOW_POLL_MS });
  const machines = data?.chatMachines ?? undefined;
  const [chosen, setChosen] = useState<string | null>(null);
  const machine = chosen && machineNames(machines).includes(chosen) ? chosen : initialMachine(machines, readStoredMachine());
  const choose = (name: string) => {
    setChosen(name);
    try { window.localStorage.setItem(MACHINE_KEY, name); } catch { /* Preference storage is optional. */ }
  };
  return { machines, machine, choose };
}

export const MachineChip: React.FC<{ name: string; online?: boolean; className?: string }> = ({ name, online, className }) => (
  <span className={cn('inline-flex flex-none items-center gap-1 rounded-xs border border-border px-1.5 py-px font-mono text-[0.62rem] font-bold text-secondary-foreground', className)}>
    {online !== undefined && <i className={cn('size-1.5 rounded-full', online ? 'bg-status-merged' : 'bg-muted-foreground')} aria-hidden="true" />}
    {name}
    {online !== undefined && <span className="sr-only"> ({online ? 'online' : 'offline'})</span>}
  </span>
);

export const MachinePicker: React.FC<{ machines: ChatMachine[] | undefined; value: string; onChange: (name: string) => void; disabled?: boolean; className?: string }> = ({ machines, value, onChange, disabled, className }) => {
  if (machineNames(machines).length < 2) return null;
  return (
    <Select
      aria-label="Machine for the new session"
      className={cn('h-8 w-auto min-w-[110px] px-2.5 text-xs', className)}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      options={(machines || []).map((machine) => ({ value: machine.name, label: machine.online ? machine.name : `${machine.name} (offline)` }))}
    />
  );
};
