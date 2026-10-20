import React, { useEffect, useId, useState } from 'react';
import { useMutation } from '@apollo/client';
import { Check, Save, Unlink } from 'lucide-react';
import { CLEAR_TICKET_DEPENDENCY, SET_TICKET_DEPENDENCY } from '../../graphql/mutations';
import { matchesChoice, type DependencyChoice } from '../../lib/ticketDetail';
import { cn } from '../../lib/cn';
import { Badge, Button, Card, Dialog, Input } from '../ui';

interface DependencyDialogProps {
  open: boolean;
  ticketKey: string;
  dependsOnKey?: string | null;
  primaryKey?: string | null;
  groupKeys: string[];
  /** Already in order: the active sprint first. */
  choices: DependencyChoice[];
  onClose: () => void;
  onDone: (message: string, type: 'success' | 'error') => void;
}

const REFETCH = { refetchQueries: ['GetTicketDetailCore', 'GetTicketDetailEnrichment'], awaitRefetchQueries: true };

/** Links a ticket to its primary work item; every ticket in the group shares one Discord announcement. */
export const DependencyDialog: React.FC<DependencyDialogProps> = ({ open, ticketKey, dependsOnKey, primaryKey, groupKeys, choices, onClose, onDone }) => {
  const id = useId();
  const [selected, setSelected] = useState(dependsOnKey || '');
  const [query, setQuery] = useState('');
  const [setTicketDependency, { loading: saving }] = useMutation(SET_TICKET_DEPENDENCY, REFETCH);
  const [clearTicketDependency, { loading: clearing }] = useMutation(CLEAR_TICKET_DEPENDENCY, REFETCH);
  const busy = saving || clearing;
  const shown = choices.filter((choice) => matchesChoice(choice, query));
  const parts = [
    { label: 'Current sprint', items: shown.filter((choice) => choice.sprintState === 'ACTIVE') },
    { label: 'Other tickets', items: shown.filter((choice) => choice.sprintState !== 'ACTIVE') },
  ].filter((part) => part.items.length > 0);

  useEffect(() => {
    if (open) {
      setSelected(dependsOnKey || '');
      setQuery('');
    }
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
      <Card className="w-[min(460px,calc(100vw-2rem))] shadow-card">
        <h2 id={`${id}-title`} className="text-balance font-display text-xl font-bold">Dependency {ticketKey}</h2>
        <p id={`${id}-description`} className="mt-1.5 text-pretty text-sm text-muted-foreground">Link this ticket to its primary work item. Every ticket in the group shares one Discord announcement.</p>
        <span id={`${id}-label`} className="mt-4 mb-1.5 block font-mono text-xs text-muted-foreground">{ticketKey} depends on {selected || 'nothing yet'}</span>
        <Input type="search" placeholder="Search ticket key or title" aria-label="Search tickets" aria-controls={`${id}-list`} value={query} onChange={(event) => setQuery(event.target.value)} disabled={busy} />
        <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="mt-2 max-h-[min(18rem,40dvh)] overflow-y-auto overscroll-contain rounded-sm border border-border bg-surface-1 p-1">
          {parts.map((part) => (
            <div key={part.label} role="group" aria-label={part.label}>
              <p className="px-2.5 pt-1.5 pb-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">{part.label}</p>
              {part.items.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  role="option"
                  aria-selected={selected === choice.key}
                  disabled={busy}
                  onClick={() => setSelected(choice.key)}
                  className={cn('grid w-full grid-cols-[76px_minmax(0,1fr)_16px] items-center gap-2 rounded-xs px-2.5 py-2 text-left text-sm hover:bg-surface-hover', selected === choice.key && 'bg-surface-hover')}
                >
                  <span className="font-mono text-xs font-bold text-accent">{choice.key}</span>
                  <span className="truncate" title={choice.title}>{choice.title}</span>
                  {selected === choice.key && <Check size={14} className="text-accent" aria-hidden="true" />}
                </button>
              ))}
            </div>
          ))}
          {shown.length === 0 && <p className="px-2.5 py-3 text-sm text-muted-foreground" role="status">{choices.length ? `No ticket matches "${query}".` : 'No other ticket on the board.'}</p>}
        </div>
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
    </Dialog>
  );
};
