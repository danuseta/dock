import React from 'react';
import { useQuery } from '@apollo/client';
import { CHAT_MACHINE_OPTIONS } from '../chat/composer/documents';
import { EMPTY_OPTIONS, chooseModel, type MachineOptions } from '../chat/composer/composerLogic';
import { DEFAULT_MACHINE } from '../chat/messages';
import { cavemanChoices, normalizeCaveman, settingEffortChoices, settingModeChoices, settingModelChoices, type CavemanLevel, type RtkSetting } from '../chat/chatDefaults';
import type { Choice, SessionMachineOptions } from '../chat/sessionOptions';
import { useChatMachines } from '../chat/useChatMachines';
import { SettingRow, SettingsCard } from '../settings/SettingsParts';
import { Checkbox } from './ui';

export interface ChatDefaultsValue {
  model: string;
  effort: string;
  mode: string;
  rtk: RtkSetting;
  caveman: CavemanLevel;
  turns: string;
  ownerReply: string;
}

const OWNER_REPLY_CHOICES: Choice[] = [{ value: 'new', label: 'A new session' }, { value: 'last', label: "The ticket's last Task session" }];

const TURN_CHOICES: Choice[] = [{ value: '', label: "The bridge's own setting" }, ...['1', '2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))];

interface ChatDefaultsSectionProps {
  value: ChatDefaultsValue;
  onChange: (next: ChatDefaultsValue) => void;
}

const selectClass = 'h-10 w-full min-w-0 rounded-sm border border-border bg-surface-0 px-3 font-body text-sm text-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

const ChoiceField: React.FC<{ label: string; help: string; value: string; choices: Choice[]; onPick: (value: string) => void }> = ({ label, help, value, choices, onPick }) => (
  <SettingRow label={label} help={help}>
    <select className={selectClass} aria-label={label} value={value} onChange={(event) => onPick(event.target.value)}>
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
  </SettingRow>
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
    <SettingsCard title="Chat defaults" caption={`Saved with the Chat save bar. The choices come from the ${machine} machine.`}>
      <ChoiceField label="Model" help="Changing it resets effort to what the model supports." value={model} choices={settingModelChoices(catalog, model)} onPick={(picked) => onChange({ ...value, model: picked, effort: chooseModel({ ...EMPTY_OPTIONS, effort: effort || null }, picked, catalog?.models ?? []).effort ?? '' })} />
      <ChoiceField label="Effort" help="Only the levels this model has." value={effort} choices={settingEffortChoices(catalog, model, effort)} onPick={(picked) => onChange({ ...value, effort: picked })} />
      <ChoiceField label="Mode" help="How a turn asks before it acts." value={mode} choices={settingModeChoices(catalog, mode)} onPick={(picked) => onChange({ ...value, mode: picked })} />
      <SettingRow label="RTK" help="Compress shell output in workspace chat turns. Off turns the rtk hook off on the workspace; the laptop always uses rtk.">
        <Checkbox aria-label="RTK" checked={value.rtk === 'on'} onChange={(event) => onChange({ ...value, rtk: event.target.checked ? 'on' : 'off' })} />
      </SettingRow>
      <ChoiceField label="Caveman" help="How terse the agent writes." value={value.caveman} choices={cavemanChoices()} onPick={(caveman) => onChange({ ...value, caveman: normalizeCaveman(caveman) })} />
      <ChoiceField label="Turns at once" help="How many chat turns a bridge runs together. A message past that waits in the queue. Applies within 15 seconds; a running turn is never stopped." value={value.turns} choices={TURN_CHOICES} onPick={(turns) => onChange({ ...value, turns })} />
      <ChoiceField label="Answers to sous" help="Where an answer to an I-n or a changed D-n goes. The last Task session queues it behind its running turn; with no Task session yet, a new one opens. Owner answers and reviews wait only for Turns at once, never for a cron slot." value={value.ownerReply} choices={OWNER_REPLY_CHOICES} onPick={(ownerReply) => onChange({ ...value, ownerReply })} />
    </SettingsCard>
  );
};
