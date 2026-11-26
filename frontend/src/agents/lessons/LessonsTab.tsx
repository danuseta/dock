import React from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_LESSONS } from '../../graphql/queries';
import { APPROVE_LESSON_CODE, DELETE_LESSON, EDIT_LESSON, RETARGET_LESSON } from '../../graphql/mutations';
import { Card } from '../../components/ui';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { LessonsBoard, type LessonActions } from './LessonsBoard';
import type { LessonsData } from './lessonsLogic';

/** Agents › Lessons: what Judge and the ledgers taught, where it is written, and the owner's edits and code approvals. */
export const LessonsTab: React.FC = () => {
  const { data, loading, error, refetch } = useQuery<{ lessons: LessonsData }>(GET_LESSONS, { fetchPolicy: 'cache-and-network' });
  const [edit, editState] = useMutation(EDIT_LESSON);
  const [retarget, retargetState] = useMutation(RETARGET_LESSON);
  const [remove, removeState] = useMutation(DELETE_LESSON);
  const [approve, approveState] = useMutation(APPROVE_LESSON_CODE);
  const after = <T,>(work: Promise<T>) => work.then(async (result) => { await refetch(); return result; });
  const actions: LessonActions = {
    edit: (id, text, textId) => after(edit({ variables: { id, text, textId } })),
    retarget: (id, kind, name) => after(retarget({ variables: { id, kind, name } })),
    remove: (id) => after(remove({ variables: { id } })),
    approve: (id) => after(approve({ variables: { id } })),
  };
  if (error) return <Card className="border-status-conflict text-status-conflict" role="alert">The lessons failed to load: {error.message}</Card>;
  if (loading && !data) return <LoadingSkeleton />;
  return data ? <LessonsBoard data={data.lessons} actions={actions} busy={editState.loading || retargetState.loading || removeState.loading || approveState.loading} /> : null;
};
