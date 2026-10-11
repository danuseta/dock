import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { GET_CHAT_MACHINES } from '../graphql/queries';
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
