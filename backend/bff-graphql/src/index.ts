import 'dotenv/config';
import { createApp } from './app';
import { missingPinWarning } from './auth/session';
import { chatService } from './integrations/chat';
import { sprintDashboardService } from './integrations/sprint-dashboard';
import { startSprintScheduler } from './integrations/sprint-scheduler';
import { startOrchestratorCron } from './integrations/orchestrator-cron';
import { orchestratorCron } from './integrations/orchestrator-cron-live';
import { StorageService } from './storage/service';

const port = Number(process.env.PORT || 4000);

export async function startServer(): Promise<void> {
  const { app, frontendEnabled } = await createApp();
  const pinWarning = missingPinWarning(await new StorageService().hasMasterPin().catch(() => true));
  if (pinWarning) console.warn(pinWarning);
  await chatService.restoreLimits();

  app.listen(port, () => {
    const shellStatus = frontendEnabled ? 'with React SPA' : 'API only';
    console.log(`DOCK GraphQL server running on port ${port} at /graphql (${shellStatus})`);
    startSprintScheduler(sprintDashboardService);
    startOrchestratorCron(orchestratorCron);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exitCode = 1;
  });
}
