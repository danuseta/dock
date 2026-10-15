import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { SET_CHAT_SESSION_OPTIONS } from '../../graphql/mutations';
import { CHAT_MACHINE_OPTIONS } from './documents';
import { EMPTY_OPTIONS, chooseModel, type ComposerFeatures, type MachineOptions, type TurnOptions } from './composerLogic';

export interface TurnOptionsControl {
  options: TurnOptions;
  machineOptions: MachineOptions | undefined;
  setModel: (model: string | null) => void;
  setEffort: (effort: string | null) => void;
  setMode: (mode: string | null) => void;
  setFast: (fast: boolean) => void;
}

/** The selects are the session's own options: a pick shows at once and is saved to the session. */
export function useTurnOptions(sessionId: string, machine: string, features: ComposerFeatures, sessionOptions: TurnOptions | null): TurnOptionsControl {
  const wanted = features.model || features.effort || features.fast || features.mode;
  const { data } = useQuery<{ chatMachineOptions: MachineOptions | null }>(CHAT_MACHINE_OPTIONS, {
    variables: { machine },
    skip: !wanted,
    fetchPolicy: 'cache-and-network',
  });
  const machineOptions = wanted ? data?.chatMachineOptions ?? undefined : undefined;
  const [chosen, setChosen] = useState<TurnOptions | null>(null);
  const [save] = useMutation(SET_CHAT_SESSION_OPTIONS);
  const options = chosen ?? sessionOptions ?? EMPTY_OPTIONS;
  const update = (change: (current: TurnOptions) => TurnOptions) => {
    const next = change(chosen ?? sessionOptions ?? EMPTY_OPTIONS);
    setChosen(next);
    void save({ variables: { id: sessionId, options: next } }).catch(() => undefined);
  };
  return {
    options,
    machineOptions,
    setModel: (model) => update((current) => chooseModel(current, model, machineOptions?.models ?? [])),
    setEffort: (effort) => update((current) => ({ ...current, effort })),
    setMode: (mode) => update((current) => ({ ...current, permissionMode: mode })),
    setFast: (fast) => update((current) => ({ ...current, fast: fast ? true : null })),
  };
}
