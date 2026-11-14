import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_SESSION_JUDGE, JUDGE_AGAIN } from '../graphql/queries';
import { SessionJudgeView } from './SessionJudgeView';
import type { SessionJudge } from '../agents/judge';

export const SessionJudgeBlock: React.FC<{ sessionId: string; canAct: boolean }> = ({ sessionId, canAct }) => {
  const { data, refetch } = useQuery<{ chatSession: { id: string; judge: SessionJudge | null } | null }>(GET_SESSION_JUDGE, { variables: { id: sessionId }, fetchPolicy: 'cache-and-network', pollInterval: 30000 });
  const [again, { loading }] = useMutation(JUDGE_AGAIN);
  const [notice, setNotice] = useState<string | null>(null);
  const judge = data?.chatSession?.judge;
  if (!judge) return null;
  const onAgain = () => {
    setNotice(null);
    again({ variables: { sessionId } })
      .then((result) => {
        const tick = result.data?.judgeAgain as { started: string | null; skipped: string | null } | undefined;
        setNotice(tick?.started ? 'Judge is reading the session again.' : `Queued; Judge starts when it can (${tick?.skipped ?? 'waiting'}).`);
        return refetch();
      })
      .catch((failure: unknown) => setNotice(failure instanceof Error ? failure.message : 'Judge could not start'));
  };
  return <SessionJudgeView judge={judge} canAct={canAct} busy={loading} notice={notice} onAgain={onAgain} />;
};
