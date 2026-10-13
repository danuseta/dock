import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { GET_ORCHESTRATIONS, GET_ORCHESTRATOR_CRON_SETTINGS } from '../graphql/queries';
import { RUN_ORCHESTRATOR_CRON_NOW, UPDATE_ORCHESTRATOR_CRON_SETTINGS } from '../graphql/mutations';
import { Button, Card, Input, Textarea } from '../components/ui';
import { roundSummary } from './cronRound';

export const CronSettingsPanel = () => {
  const { data, loading, refetch } = useQuery(GET_ORCHESTRATOR_CRON_SETTINGS, { fetchPolicy: 'network-only' });
  const [save, { loading: saving }] = useMutation(UPDATE_ORCHESTRATOR_CRON_SETTINGS);
  const [runNow, { loading: running }] = useMutation(RUN_ORCHESTRATOR_CRON_NOW, { refetchQueries: [GET_ORCHESTRATIONS] });
  const [config, setConfig] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const settings = data?.orchestratorCronSettings;

  useEffect(() => {
    if (settings) setConfig(settings.config);
  }, [settings]);

  const act = async (work: () => Promise<string>) => {
    setMessage(null);
    try {
      setMessage({ text: await work(), failed: false });
      await refetch();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Failed', failed: true });
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await save({ variables: { config, webhookUrl: webhookUrl.trim() || null } });
      setWebhookUrl('');
      return 'Saved.';
    });
  };

  const run = () => void act(async () => {
    const result = await runNow();
    return roundSummary(JSON.parse(result.data.runOrchestratorCronNow));
  });

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="grid gap-4">
        <div>
          <label htmlFor="cron-config" className="mb-1 block text-sm font-medium">Orchestrator cron (JSON)</label>
          <Textarea id="cron-config" value={config} onChange={(event) => setConfig(event.target.value)} rows={16} spellCheck={false} disabled={loading} className="font-mono text-xs" />
          <p className="mt-1 text-xs text-muted-foreground">
            On each hour in hoursWib the cron picks your To Do tickets and starts an agent on the machine. A ticket without acceptance criteria is parked until you confirm it. parallel is how many agents may be active at once, perRound how many tickets one round may take, usageBrakePercent the 5 hour usage at which a round is skipped. notifyUserId is your Discord user id for the mention.
          </p>
        </div>
        <div>
          <label htmlFor="cron-webhook" className="mb-1 block text-sm font-medium">Discord webhook for pings</label>
          <Input id="cron-webhook" type="password" autoComplete="off" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder={settings?.webhookSet ? 'Saved. Paste a new URL to replace it.' : 'https://discord.com/api/webhooks/...'} disabled={loading} />
          <p className="mt-1 text-xs text-muted-foreground">A webhook in your own private server. You are pinged when a ticket is parked, an agent asks, or a pull request waits for your review.</p>
        </div>
        <p className="text-xs text-secondary-foreground" role="status">Last round: {roundSummary(settings ? JSON.parse(settings.lastRound) : null)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={saving || loading}>{saving ? 'Saving...' : 'Save settings'}</Button>
          <Button type="button" disabled={running || loading} onClick={run}>{running ? 'Running...' : 'Run a round now'}</Button>
          {message && <span role="status" className={message.failed ? 'text-sm text-status-conflict' : 'text-sm text-status-merged'}>{message.text}</span>}
        </div>
      </form>
    </Card>
  );
};
