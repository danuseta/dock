import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_SPRINT_DASHBOARD, GET_SPRINT_LIST, GET_SPRINT_SETTINGS, GET_SPRINT_TREND } from '../graphql/queries';
import { UPDATE_SPRINT_DASHBOARD_SETTINGS } from '../graphql/mutations';
import { Button, Card, Input, Textarea } from '../components/ui';

export const SprintSettingsPanel = () => {
  const { data, loading } = useQuery(GET_SPRINT_SETTINGS, { fetchPolicy: 'network-only' });
  const [save, { loading: saving }] = useMutation(UPDATE_SPRINT_DASHBOARD_SETTINGS, {
    refetchQueries: [GET_SPRINT_LIST, GET_SPRINT_DASHBOARD, GET_SPRINT_TREND],
  });
  const [boardId, setBoardId] = useState('');
  const [config, setConfig] = useState('');
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  useEffect(() => {
    if (!data?.sprintDashboardSettings) return;
    setBoardId(data.sprintDashboardSettings.boardId);
    setConfig(data.sprintDashboardSettings.config);
  }, [data]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    try {
      await save({ variables: { boardId, config } });
      setMessage({ text: 'Saved. Stored sprints were recalculated with the new config.', failed: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Failed to save', failed: true });
    }
  };

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="grid gap-4">
        <div>
          <label htmlFor="sprint-board-id" className="mb-1 block text-sm font-medium">Jira board id</label>
          <Input id="sprint-board-id" value={boardId} onChange={(event) => setBoardId(event.target.value)} inputMode="numeric" placeholder="40" disabled={loading} className="max-w-[200px]" />
          <p className="mt-1 text-xs text-muted-foreground">The number in the board URL: .../boards/40</p>
        </div>
        <div>
          <label htmlFor="sprint-config" className="mb-1 block text-sm font-medium">Config (JSON)</label>
          <Textarea id="sprint-config" value={config} onChange={(event) => setConfig(event.target.value)} rows={14} spellCheck={false} disabled={loading} className="font-mono text-xs" />
          <p className="mt-1 text-xs text-muted-foreground">
            roster: [{'{'} full (Jira display name), short, token (pass label), color {'}'}]. Also loadTarget, targetPerDev, bugMarginPerDev, slaDays, tzOffsetHours, dailyHour (WIB), statusAliases.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={saving || loading}>{saving ? 'Saving...' : 'Save settings'}</Button>
          {message && <span role="status" className={message.failed ? 'text-sm text-status-conflict' : 'text-sm text-status-merged'}>{message.text}</span>}
        </div>
      </form>
    </Card>
  );
};
