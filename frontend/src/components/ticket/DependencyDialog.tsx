import React, { useEffect, useId, useState } from 'react';
import { useMutation } from '@apollo/client';
import { Save, Unlink } from 'lucide-react';
import { CLEAR_TICKET_DEPENDENCY, SET_TICKET_DEPENDENCY } from '../../graphql/mutations';
import { Badge, Button, Card, Dialog, Select } from '../ui';

interface DependencyDialogProps {
  open: boolean;
  ticketKey: string;
  dependsOnKey?: string | null;
  primaryKey?: string | null;
  groupKeys: string[];
  choices: Array<{ key: string; title: string }>;
  onClose: () => void;
  onDone: (message: string, type: 'success' | 'error') => void;
}

const REFETCH = { refetchQueries: ['GetTicketDetailCore', 'GetTicketDetailEnrichment'], awaitRefetchQueries: true };

/** Links a ticket to its primary work item; every ticket in the group shares one Discord announcement. */
export const DependencyDialog: React.FC<DependencyDialogProps> = ({ open, ticketKey, dependsOnKey, primaryKey, groupKeys, choices, onClose, onDone }) => {
  const id = useId();
  const [selected, setSelected] = useState(dependsOnKey || '');
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [setTicketDependency, { loading: saving }] = useMutation(SET_TICKET_DEPENDENCY, REFETCH);
  const [clearTicketDependency, { loading: clearing }] = useMutation(CLEAR_TICKET_DEPENDENCY, REFETCH);
  const busy = saving || clearing;

  useEffect(() => {
    if (open) setSelected(dependsOnKey || '');
  }, [open, dependsOnKey]);

  const save = async () => {
    try {
      await setTicketDependency({ variables: { ticketKey, dependsOnKey: selected } });
      onDone(`${ticketKey} now depends on ${selected}.`, 'success');
      onClose();
    } catch (err: any) {
      onDone(err.message || 'Failed to save ticket dependency', 'error');
    }
  };
  const clear = async () => {
    try {
      await clearTicketDependency({ variables: { ticketKey } });
      onDone('Ticket dependency removed.', 'success');
      onClose();
    } catch (err: any) {
      onDone(err.message || 'Failed to remove ticket dependency', 'error');
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} dismissible={!busy} labelledBy={`${id}-title`} describedBy={`${id}-description`}>
      <div ref={setPortal}>
        <Card className="w-[min(460px,calc(100vw-2rem))] shadow-card">
          <h2 id={`${id}-title`} className="text-balance font-display text-xl font-bold">Dependency {ticketKey}</h2>
          <p id={`${id}-description`} className="mt-1.5 text-pretty text-sm text-muted-foreground">Link this ticket to its primary work item. Every ticket in the group shares one Discord announcement.</p>
          <label className="mt-4 block">
            <span className="mb-1.5 block font-mono text-xs text-muted-foreground">{ticketKey} depends on</span>
            <Select
              value={selected || 'NONE'}
              onValueChange={(value) => setSelected(value === 'NONE' ? '' : value)}
              disabled={busy}
              aria-label={`${ticketKey} depends on ticket`}
              options={[{ value: 'NONE', label: 'No dependency' }, ...choices.map((item) => ({ value: item.key, label: `${item.key} — ${item.title}` }))]}
              container={portal}
            />
          </label>
          {groupKeys.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[0.68rem] font-bold uppercase text-muted-foreground">Announcement group</span>
              {groupKeys.map((key) => <Badge key={key} variant={key === primaryKey ? 'accent' : 'neutral'}>{key}{key === primaryKey ? ' · PRIMARY' : ''}</Badge>)}
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {dependsOnKey && <Button variant="danger" onClick={() => void clear()} disabled={busy}><Unlink size={15} aria-hidden="true" />{clearing ? 'Removing...' : 'Remove'}</Button>}
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!selected || selected === dependsOnKey || busy}><Save size={15} aria-hidden="true" />{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </Card>
      </div>
    </Dialog>
  );
};
