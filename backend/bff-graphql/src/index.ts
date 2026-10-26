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
import { liveApprovalDeps } from './integrations/review-approval';
import { discordGateway, discordReader } from './integrations/discord-reader-live';
import { dockMode } from './mode';
import { useWriteAheadLog } from './storage/client';
import { StorageService } from './storage/service';

const port = Number(process.env.PORT || 4000);
const JIRA_SYNC_MS = 5 * 60 * 1000;
/** How often the saved bot token is checked, so the Gateway starts, stops or switches tokens after a Settings change. */
const DISCORD_TOKEN_CHECK_MS = 60 * 1000;

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
    // A review the owner passed in Jira (their Pass label) is done on the Agents page too.
    const syncReviewPasses = () => orchestratorService.syncReviewPasses(dockMode(), { passLabel: liveApprovalDeps.passLabel, labels: async (key) => (await jira.getTicket(key))?.labels ?? null })
      .catch((error) => console.warn('[Orchestrator] Review pass sync failed:', error instanceof Error ? error.message : 'unknown error'));
    setInterval(syncReviewPasses, JIRA_SYNC_MS).unref();
    // One DOCK reads Discord, so the bot does not read the forums twice. Discord pushes changes over the Gateway; each
    // new session reads everything once.
    if (dockMode() === 'workspace') {
      const followToken = () => discordReader.config()
        .then((config) => discordGateway.ensure(config?.token ?? null))
        .catch((error) => console.warn('[Discord] Gateway check failed:', error instanceof Error ? error.message : 'unknown error'));
      void followToken();
      setInterval(followToken, DISCORD_TOKEN_CHECK_MS).unref();
    }
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exitCode = 1;
  });
}
