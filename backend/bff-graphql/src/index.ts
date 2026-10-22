import 'dotenv/config';
import { createApp } from './app';
import { missingPinWarning } from './auth/session';
import { chatService } from './integrations/chat';
import { sprintDashboardService } from './integrations/sprint-dashboard';
import { startSprintScheduler } from './integrations/sprint-scheduler';
import { startOrchestratorCron } from './integrations/orchestrator-cron';
import { orchestratorCron } from './integrations/orchestrator-cron-live';
import { orchestratorService } from './integrations/orchestrator';
import { JiraAPI } from './datasources/JiraAPI';
import { discordReader } from './integrations/discord-reader-live';
import { dockMode } from './mode';
import { useWriteAheadLog } from './storage/client';
import { StorageService } from './storage/service';

const port = Number(process.env.PORT || 4000);
const JIRA_SYNC_MS = 5 * 60 * 1000;
const DISCORD_SYNC_MS = 5 * 60 * 1000;

export async function startServer(): Promise<void> {
  const journal = await useWriteAheadLog().catch((error) => `unchanged (${error instanceof Error ? error.message : 'unknown error'})`);
  if (journal !== 'wal') console.warn(`SQLite journal mode: ${journal}`);
  const { app, frontendEnabled } = await createApp();
  const pinWarning = missingPinWarning(await new StorageService().hasMasterPin().catch(() => true));
  if (pinWarning) console.warn(pinWarning);
  await chatService.restoreLimits();

  app.listen(port, () => {
    const shellStatus = frontendEnabled ? 'with React SPA' : 'API only';
    console.log(`DOCK GraphQL server running on port ${port} at /graphql (${shellStatus})`);
    startSprintScheduler(sprintDashboardService);
    // Cron agents start in chat sessions, and chat runs on the workspace DOCK only.
    if (dockMode() === 'workspace') startOrchestratorCron(orchestratorCron);
    // Each DOCK follows Jira for the runs its own machine owns.
    const jira = new JiraAPI();
    const syncJira = () => jira.getTickets()
      .then((tickets) => orchestratorService.syncJira(dockMode(), tickets))
      .catch((error) => console.warn('[Orchestrator] Jira sync failed:', error instanceof Error ? error.message : 'unknown error'));
    setInterval(syncJira, JIRA_SYNC_MS).unref();
    // One DOCK reads Discord, so the bot does not read the forums twice.
    if (dockMode() === 'workspace') {
      const syncDiscord = () => discordReader.config()
        .then((config) => (config ? discordReader.sync() : null))
        .catch((error) => console.warn('[Discord] Sync failed:', error instanceof Error ? error.message : 'unknown error'));
      void syncDiscord();
      setInterval(syncDiscord, DISCORD_SYNC_MS).unref();
    }
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exitCode = 1;
  });
}
