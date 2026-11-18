import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_AUTO_REVIEWS, GET_REVIEW_ROUNDS_FOR_TICKET } from '../../graphql/queries';
import { CANCEL_AUTO_REVIEW_POST, CANCEL_REVIEW_REPLY_POST, EDIT_AUTO_REVIEW_POST, EDIT_REVIEW_REPLY_POST } from '../../graphql/mutations';
import type { AutoReviewRow } from '../../agents/autoReviews';
import { CACHED_QUERY_OPTIONS } from '../../lib/queryPolicy';
import { latestRound, reviewHistory, splitMarker, type ReviewRound } from '../../lib/reviewRounds';
import { LatestFindings, ReviewHistoryTable } from './ReviewHistory';

/** Blackboard › Review findings: the round history of a ticket and the findings of its latest round. */
export const ReviewFindings: React.FC<{ ticketKey: string }> = ({ ticketKey }) => {
  const { data: autoData } = useQuery<{ autoReviews: AutoReviewRow[] }>(GET_AUTO_REVIEWS, { ...CACHED_QUERY_OPTIONS, pollInterval: 15000 });
  const { data: roundData } = useQuery<{ reviewRoundsForTicket: ReviewRound[] }>(GET_REVIEW_ROUNDS_FOR_TICKET, { ...CACHED_QUERY_OPTIONS, variables: { key: ticketKey }, pollInterval: 15000 });
  const refetchQueries = [GET_AUTO_REVIEWS, GET_REVIEW_ROUNDS_FOR_TICKET];
  const [cancelPost, cancelling] = useMutation(CANCEL_AUTO_REVIEW_POST, { refetchQueries, awaitRefetchQueries: true });
  const [editPost, editingPost] = useMutation(EDIT_AUTO_REVIEW_POST, { refetchQueries, awaitRefetchQueries: true });
  const [cancelReply, cancellingReply] = useMutation(CANCEL_REVIEW_REPLY_POST, { refetchQueries, awaitRefetchQueries: true });
  const [editReply, editingReply] = useMutation(EDIT_REVIEW_REPLY_POST, { refetchQueries, awaitRefetchQueries: true });
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoReviews = useMemo(() => (autoData?.autoReviews ?? []).filter((row) => row.ticketKey.toUpperCase() === ticketKey.toUpperCase()), [autoData, ticketKey]);
  const rounds = useMemo(() => roundData?.reviewRoundsForTicket ?? [], [roundData]);
  const rows = useMemo(() => reviewHistory(autoReviews, rounds), [autoReviews, rounds]);
  const newest = latestRound(rounds);
  const busy = cancelling.loading || editingPost.loading || cancellingReply.loading || editingReply.loading;
  const run = (call: Promise<unknown>) => call.then(() => setError(null), (failure: unknown) => setError(failure instanceof Error ? failure.message : 'The change was not saved'));

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="m-0 text-pretty text-xs text-muted-foreground">Every round of this ticket: the reviews your DOCK ran, and the rounds a teammate's DOCK sent you with your reply. A post waits a few minutes before it goes out; until then you can cancel or edit it.</p>
      {error && <p className="m-0 text-xs text-status-conflict" role="alert">{error}</p>}
      {rows.length === 0
        ? <p className="m-0 text-sm text-muted-foreground">No review round for this ticket yet.</p>
        : (
          <ReviewHistoryTable
            rows={rows}
            busy={busy}
            editing={editing}
            onCancel={(row) => void run((row.kind === 'review' ? cancelPost : cancelReply)({ variables: { id: row.id } }))}
            onEdit={(row) => setEditing({ id: row.id, text: splitMarker(row.discordText ?? '').body })}
            onText={(text) => setEditing((current) => (current ? { ...current, text } : current))}
            onSave={(row) => void run((row.kind === 'review' ? editPost : editReply)({ variables: { id: row.id, text: editing?.text ?? '' } }).then(() => setEditing(null)))}
            onClose={() => setEditing(null)}
          />
        )}
      {newest && <LatestFindings round={newest} />}
    </div>
  );
};
