import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { FileEdit, Workflow } from 'lucide-react';
import { GET_SOUS_FLOW, GET_TICKET_SOUS_FLOW, SET_TICKET_SOUS_FLOW, WRITE_QA_GUIDE } from '../../graphql/queries';
import { Button, Select } from '../ui';
import { parseSettings, profileNames } from '../../lib/sousFlow';

const MINE = '__mine__';
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/** The ticket's own Sous flow, and writing its QA guide block in Developer Context by hand. */
export const TicketSousFlow: React.FC<{ ticketKey: string }> = ({ ticketKey }) => {
  const { data } = useQuery<{ sousFlow: string }>(GET_SOUS_FLOW, { fetchPolicy: 'cache-and-network' });
  const { data: ticketData } = useQuery<{ ticketSousFlow: string | null }>(GET_TICKET_SOUS_FLOW, { variables: { key: ticketKey }, fetchPolicy: 'cache-and-network' });
  const [setFlow, setting] = useMutation(SET_TICKET_SOUS_FLOW, { refetchQueries: [{ query: GET_TICKET_SOUS_FLOW, variables: { key: ticketKey } }], awaitRefetchQueries: true });
  const [writeGuide, writing] = useMutation<{ writeQaGuide: { written: boolean; reason: string | null; lines: string[] } }>(WRITE_QA_GUIDE, { refetchQueries: ['GetTicketDetailCore'] });
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const settings = parseSettings(data?.sousFlow);
  const own = ticketData?.ticketSousFlow && settings.profiles[ticketData.ticketSousFlow] ? ticketData.ticketSousFlow : MINE;

  const pick = (value: string) => {
    setNote(null);
    setFlow({ variables: { key: ticketKey, profile: value === MINE ? null : value } }).catch((error: unknown) => setNote({ text: messageOf(error, 'Ticket flow not saved'), bad: true }));
  };
  const write = async () => {
    setNote(null);
    try {
      const result = (await writeGuide({ variables: { key: ticketKey } })).data?.writeQaGuide;
      setNote({ text: result?.written ? 'QA guide written to Developer Context.' : 'QA guide in Developer Context is already the same, not rewritten.', bad: false });
    } catch (error) {
      setNote({ text: messageOf(error, 'QA guide not written'), bad: true });
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-surface-0 p-3" aria-label="Sous flow for this ticket">
      <h2 className="flex items-center gap-1.5 font-display text-sm font-bold"><Workflow size={14} aria-hidden="true" />Sous flow for this ticket</h2>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <Select
            aria-label="Sous flow for this ticket"
            value={own}
            onValueChange={pick}
            disabled={setting.loading}
            options={[{ value: MINE, label: `Use my profile (${settings.mine})` }, ...profileNames(settings).map((name) => ({ value: name, label: name }))]}
            className="h-9 text-xs"
          />
        </span>
        <Button size="sm" variant="ghost" onClick={() => void write()} disabled={writing.loading} title="Writes the QA guide (DOCK) block in Developer Context: URL/route and menu path. Nothing else is touched.">
          <FileEdit size={13} aria-hidden="true" />{writing.loading ? 'Writing…' : 'Write QA guide'}
        </Button>
      </div>
      {note && <p className={note.bad ? 'text-xs text-status-conflict' : 'text-xs text-status-merged'} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}
    </section>
  );
};
