import React from 'react';
import { Select } from '../../components/ui';
import { SOUS_STAGES, stageIndex } from '../../lib/sousFlow';
import type { SessionFlow } from './sessionFlow';

const endOf = (flow: SessionFlow) => (flow.profile.stop === 'status' ? 'sampai status Jira' : `berhenti di ${SOUS_STAGES[stageIndex(flow.profile.stop)]?.title ?? flow.profile.stop}`);

/** The Sous flow this session runs: what a "Pakai skill sous: kerjakan …" message from here gets as its flow lines. */
export const FlowPicker: React.FC<{ flow: SessionFlow; disabled?: boolean }> = ({ flow, disabled }) => (
  <span className="min-w-0" title={`Flow sesi ini: ${flow.name}, ${endOf(flow)}`}>
    <Select
      aria-label="Flow buat sesi ini"
      value={flow.name}
      onValueChange={(name) => flow.pick(name)}
      options={flow.names.map((name) => ({ value: name, label: `Flow: ${name}` }))}
      disabled={disabled}
      className="h-8 min-w-0 max-w-[14rem] gap-1.5 rounded-[10px] px-2.5 font-mono text-[0.68rem] max-[900px]:h-11"
    />
  </span>
);
