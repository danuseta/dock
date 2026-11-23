import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { CONFIRM_JUDGE_DAY, GET_JUDGE_DAY, SET_JUDGE_CALL } from '../graphql/queries';
import { JudgeDaySheetView } from './JudgeDaySheetView';
import type { JudgeCall, JudgeDaySheet as Sheet, JudgeFinding } from './judge';

interface JudgeDaySheetProps { day: string; onBack: () => void; onDay: (day: string) => void; onConfirmed: () => void; onNavigate: (path: string) => void }

export const JudgeDaySheet: React.FC<JudgeDaySheetProps> = ({ day, onBack, onDay, onConfirmed, onNavigate }) => {
  const { data, loading, error, refetch } = useQuery<{ judgeDay: Sheet }>(GET_JUDGE_DAY, { variables: { day }, fetchPolicy: 'cache-and-network' });
  const [setCall, calling] = useMutation(SET_JUDGE_CALL);
  const [confirm, confirming] = useMutation(CONFIRM_JUDGE_DAY, { refetchQueries: ['GetJudgeDays', 'GetJudgeWaiting'] });
  const [calls, setCalls] = useState<Record<string, JudgeCall>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [dayNote, setDayNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const sheet = data?.judgeDay;
  if (error && !sheet) return <p className="text-sm text-status-conflict" role="alert">{error.message}</p>;
  if (!sheet) return <p className="text-sm text-muted-foreground" role="status">{loading ? 'Loading the day...' : 'No sheet for this day.'}</p>;
  const save = (finding: JudgeFinding, call: JudgeCall, note: string | null) => setCall({ variables: { findingId: finding.id, call, note } })
    .then(() => refetch())
    .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : 'The call was not saved'));
  return (
    <>
      {failure && <p className="mb-2 text-sm text-status-conflict" role="alert">{failure}</p>}
      <JudgeDaySheetView
        sheet={sheet}
        calls={calls}
        notes={notes}
        dayNote={dayNote ?? sheet.note ?? ''}
        busy={calling.loading || confirming.loading}
        onCall={(finding, call) => {
          setCalls((current) => ({ ...current, [finding.id]: call }));
          void save(finding, call, call === 'not' ? notes[finding.id] ?? finding.note ?? null : null);
        }}
        onNote={(finding, note) => setNotes((current) => ({ ...current, [finding.id]: note }))}
        onNoteDone={(finding) => { if (notes[finding.id] !== undefined && notes[finding.id] !== (finding.note ?? '')) void save(finding, 'not', notes[finding.id]); }}
        onDayNote={setDayNote}
        onBack={onBack}
        onDay={(next) => { setCalls({}); setNotes({}); setDayNote(null); onDay(next); }}
        onConfirm={() => void confirm({ variables: { day, note: dayNote ?? sheet.note ?? null } }).then(onConfirmed).catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : 'The day was not confirmed'))}
        onNavigate={onNavigate}
      />
    </>
  );
};
