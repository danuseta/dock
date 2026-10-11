import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_SPRINT_DASHBOARD, GET_SPRINT_LIST, GET_SPRINT_TREND } from '../graphql/queries';
import { BACKFILL_SPRINT_DASHBOARDS, REFRESH_SPRINT_DASHBOARD } from '../graphql/mutations';
import { parseResult, parseTrend } from './format';
import type { RefreshState, SprintSummary } from './types';

const POLL_WHILE_RUNNING_MS = 3000;
const BACKFILL_COUNT = 15;

export function useSprintDashboard(sprintId: number | null) {
  const list = useQuery(GET_SPRINT_LIST, { fetchPolicy: 'cache-and-network' });
  const dashboard = useQuery(GET_SPRINT_DASHBOARD, { variables: { sprintId }, fetchPolicy: 'cache-and-network' });
  const trend = useQuery(GET_SPRINT_TREND, { fetchPolicy: 'cache-and-network' });
  const [refreshMutation, { loading: starting }] = useMutation(REFRESH_SPRINT_DASHBOARD);
  const [backfillMutation, { loading: backfilling }] = useMutation(BACKFILL_SPRINT_DASHBOARDS);
  const [actionError, setActionError] = useState('');

  const summary: SprintSummary | null = dashboard.data?.sprintDashboard?.summary ?? null;
  const refreshState: RefreshState | null = dashboard.data?.sprintDashboard?.refreshState ?? null;
  const running = refreshState?.status === 'running';
  const result = useMemo(() => parseResult(dashboard.data?.sprintDashboard?.result), [dashboard.data?.sprintDashboard?.result]);
  const trendData = useMemo(() => parseTrend(trend.data?.sprintTrend), [trend.data?.sprintTrend]);

  const { startPolling, stopPolling } = dashboard;
  useEffect(() => {
    if (!running) return undefined;
    startPolling(POLL_WHILE_RUNNING_MS);
    return () => stopPolling();
  }, [running, startPolling, stopPolling]);

  const wasRunning = useRef(false);
  const { refetch: refetchList } = list;
  const { refetch: refetchTrend } = trend;
  const { refetch: refetchDashboard } = dashboard;
  useEffect(() => {
    if (wasRunning.current && !running) {
      void refetchList();
      void refetchTrend();
      void refetchDashboard();
    }
    wasRunning.current = running;
  }, [running, refetchList, refetchTrend, refetchDashboard]);

  const run = async (start: () => Promise<unknown>) => {
    setActionError('');
    try {
      await start();
      await refetchDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Request failed');
      void refetchDashboard().catch(() => undefined);
    }
  };

  return {
    sprints: (list.data?.sprintList ?? []) as SprintSummary[],
    summary,
    result,
    trend: trendData,
    refreshState,
    running,
    loading: dashboard.loading && dashboard.data === undefined,
    error: dashboard.error?.message || (running ? '' : actionError),
    busy: starting || backfilling || running,
    refresh: () => (summary ? run(() => refreshMutation({ variables: { sprintId: summary.id } })) : Promise.resolve()),
    backfill: () => run(() => backfillMutation({ variables: { count: BACKFILL_COUNT } })),
    backfillCount: BACKFILL_COUNT,
  };
}
