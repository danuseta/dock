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
import { discordTeam, ensureTeamChannels } from './integrations/discord-team';
import { channelStore } from './integrations/discord-threads';
import { autoReview } from './integrations/auto-review-live';
import { autoBroadcast } from './integrations/broadcast';
import { decisionGate, sweepReleases } from './integrations/decision-gate';
import { claudeAccounts, cycleAvailable } from './integrations/claude-accounts-live';
import { dockMode } from './mode';
import { useWriteAheadLog } from './storage/client';
import { StorageService } from './storage/service';

const port = Number(process.env.PORT || 4000);
const JIRA_SYNC_MS = 5 * 60 * 1000;
/** How often the saved bot token is checked, so the Gateway starts, stops or switches tokens after a Settings change. */
const DISCORD_TOKEN_CHECK_MS = 60 * 1000;
/** How often the stored pr-review threads are looked at for a new "on it" of the owner. */
const AUTO_REVIEW_MS = 60 * 1000;
/** How often auto rotate looks again without a turn, so back to main follows a reset. */
const CLAUDE_ROTATE_MS = 5 * 60 * 1000;
const RELEASE_SWEEP_MS = 5 * 60 * 1000;

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
      const followToken = () => ensureTeamChannels(channelStore, discordTeam())
        .then(() => discordReader.config())
        .then((config) => discordGateway.ensure(config?.token ?? null))
        .catch((error) => console.warn('[Discord] Gateway check failed:', error instanceof Error ? error.message : 'unknown error'));
      void followToken();
      setInterval(followToken, DISCORD_TOKEN_CHECK_MS).unref();
      const reviewOnIt = () => autoReview.tick()
        .catch((error) => console.warn('[AutoReview] check failed:', error instanceof Error ? error.message : 'unknown error'));
      setInterval(reviewOnIt, AUTO_REVIEW_MS).unref();
      const rotateClaude = () => (cycleAvailable() ? claudeAccounts.tick() : Promise.resolve())
        .catch((error) => console.warn('[ClaudeAccounts] rotate check failed:', error instanceof Error ? error.message : 'unknown error'));
      setInterval(rotateClaude, CLAUDE_ROTATE_MS).unref();
      // A build that went quiet with nothing waiting on the owner still goes up for review and out to Discord.
      const releaseQuiet = () => sweepReleases({ list: () => orchestratorService.list(), gate: decisionGate, broadcast: (run) => autoBroadcast.afterLedger(run) })
        .catch((error) => console.warn('[DecisionGate] sweep failed:', error instanceof Error ? error.message : 'unknown error'));
      setInterval(releaseQuiet, RELEASE_SWEEP_MS).unref();
    }
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exitCode = 1;
  });
}
