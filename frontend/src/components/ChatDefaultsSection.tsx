import React from 'react';
import { useQuery } from '@apollo/client';
import { MessagesSquare } from 'lucide-react';
import { CHAT_MACHINE_OPTIONS } from '../chat/composer/documents';
import { EMPTY_OPTIONS, chooseModel, type MachineOptions } from '../chat/composer/composerLogic';
import { DEFAULT_MACHINE } from '../chat/messages';
import { cavemanChoices, normalizeCaveman, settingEffortChoices, settingModeChoices, settingModelChoices, type CavemanLevel, type RtkSetting } from '../chat/chatDefaults';
import type { Choice, SessionMachineOptions } from '../chat/sessionOptions';
import { useChatMachines } from '../chat/useChatMachines';
import { Card, Checkbox } from './ui';

export interface ChatDefaultsValue {
  model: string;
  effort: string;
  mode: string;
  rtk: RtkSetting;
  caveman: CavemanLevel;
}

interface ChatDefaultsSectionProps {
  value: ChatDefaultsValue;
  onChange: (next: ChatDefaultsValue) => void;
}

const selectClass = 'h-10 w-full min-w-0 rounded-sm border border-border bg-surface-0 px-3 font-body text-sm text-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

const ChoiceField: React.FC<{ label: string; value: string; choices: Choice[]; onPick: (value: string) => void }> = ({ label, value, choices, onPick }) => (
  <label className="block">
    <span className="mb-1 block text-sm font-medium">{label}</span>
    <select className={selectClass} value={value} onChange={(event) => onPick(event.target.value)}>
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
  </label>
);

export const ChatDefaultsSection: React.FC<ChatDefaultsSectionProps> = ({ value, onChange }) => {
  const machines = useChatMachines();
  const machine = machines?.[0]?.name ?? DEFAULT_MACHINE;
  const { data } = useQuery<{ chatMachineOptions: (MachineOptions & SessionMachineOptions) | null }>(CHAT_MACHINE_OPTIONS, { variables: { machine }, fetchPolicy: 'cache-and-network' });
  const catalog = data?.chatMachineOptions ?? undefined;
  // An unset value shows what Claude Code on the machine uses; a saved "default" mode is Auto, as in a chat.
  const model = value.model || catalog?.defaults?.model || '';
  const effort = value.effort || catalog?.defaults?.effort || '';
  const mode = (value.mode === 'default' ? 'auto' : value.mode) || catalog?.defaults?.permissionMode || '';
  return (
    <Card aria-labelledby="chat-defaults-title">
      <h2 id="chat-defaults-title" className="mb-4 flex items-center gap-2 border-b border-border pb-2 font-display text-lg font-bold"><MessagesSquare size={20} aria-hidden="true" />Chat defaults</h2>
      <p className="mb-4 text-pretty text-sm text-secondary-foreground">Used by a chat turn that sets no value of its own. The choices come from the {machine} machine.</p>
      <div className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1">
        <ChoiceField label="Model" value={model} choices={settingModelChoices(catalog, model)} onPick={(picked) => onChange({ ...value, model: picked, effort: chooseModel({ ...EMPTY_OPTIONS, effort: effort || null }, picked, catalog?.models ?? []).effort ?? '' })} />
        <ChoiceField label="Effort" value={effort} choices={settingEffortChoices(catalog, model, effort)} onPick={(picked) => onChange({ ...value, effort: picked })} />
        <ChoiceField label="Mode" value={mode} choices={settingModeChoices(catalog, mode)} onPick={(picked) => onChange({ ...value, mode: picked })} />
      </div>
      <div className="mt-5 grid grid-cols-2 items-end gap-3 max-[720px]:grid-cols-1">
        <label className="flex cursor-pointer items-center gap-3 rounded-sm border border-border bg-surface-0 p-3"><Checkbox checked={value.rtk === 'on'} onChange={(event) => onChange({ ...value, rtk: event.target.checked ? 'on' : 'off' })} /><span><strong className="block text-sm">RTK</strong><small className="text-muted-foreground">Compress shell output in workspace chat turns. Off turns the rtk hook off on the workspace; the laptop always uses rtk.</small></span></label>
        <ChoiceField label="Caveman" value={value.caveman} choices={cavemanChoices()} onPick={(caveman) => onChange({ ...value, caveman: normalizeCaveman(caveman) })} />
      </div>
    </Card>
  );
};
