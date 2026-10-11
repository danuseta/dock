import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowRightLeft } from 'lucide-react';
import { GET_CHAT_MACHINES } from '../graphql/queries';
import { MOVE_ORCHESTRATION } from '../graphql/mutations';
import { Button, Card, Dialog, Select } from '../components/ui';
import { SLOW_POLL_MS, machineOf, type ChatMachine } from '../chat/messages';
import { moveConfirmation, moveTargets, type AgentRun } from './runs';

export const MoveTicket: React.FC<{ run: AgentRun }> = ({ run }) => {
  const { data } = useQuery<{ chatMachines?: ChatMachine[] | null }>(GET_CHAT_MACHINES, { fetchPolicy: 'cache-and-network', pollInterval: SLOW_POLL_MS });
  const [moveOrchestration, { loading: moving }] = useMutation(MOVE_ORCHESTRATION);
  const [choice, setChoice] = useState('');
  const [target, setTarget] = useState<ChatMachine | null>(null);
  const [error, setError] = useState('');
  const machines = data?.chatMachines ?? undefined;
  const owner = machineOf(run);
  const targets = moveTargets(machines, owner);
  if (targets.length === 0) return null;
  const selectedName = targets.some((machine) => machine.name === choice) ? choice : targets[0].name;

  const handleMove = async () => {
    if (!target) return;
    setError('');
    try {
      await moveOrchestration({ variables: { key: run.key, machine: target.name } });
      setTarget(null);
    } catch (moveError) {
      setError(moveError instanceof Error && moveError.message ? moveError.message : 'Failed to move this ticket');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={`Machine to move ${run.key} to`}
        className="h-7 w-auto min-w-[110px] px-2.5 text-xs max-[699px]:h-11"
        value={selectedName}
        onValueChange={setChoice}
        disabled={moving}
        options={targets.map((machine) => ({ value: machine.name, label: machine.online ? machine.name : `${machine.name} (offline)` }))}
      />
      <Button size="sm" className="h-7 px-2.5 max-[699px]:h-11" aria-label={`Move to ${selectedName}: ${run.key}`} disabled={moving} onClick={() => { setError(''); setTarget(targets.find((machine) => machine.name === selectedName) || null); }}>
        <ArrowRightLeft size={13} aria-hidden="true" />Move to
      </Button>
      <Dialog open={Boolean(target)} onClose={() => !moving && setTarget(null)} dismissible={!moving} labelledBy="move-ticket-title" describedBy="move-ticket-description">
        <Card className="w-[min(440px,calc(100vw-2rem))] shadow-card">
          <h2 id="move-ticket-title" className="text-balance font-display text-xl font-bold">Move to {target?.name}?</h2>
          <p id="move-ticket-description" className="mt-2 text-pretty text-sm text-muted-foreground">{target ? moveConfirmation(run.key, owner, target.name, target.online) : ''}</p>
          {error && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{error}</p>}
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setTarget(null)} disabled={moving}>Cancel</Button><Button variant="primary" onClick={handleMove} disabled={moving}>{moving ? 'Moving...' : `Move to ${target?.name}`}</Button></div>
        </Card>
      </Dialog>
    </div>
  );
};
