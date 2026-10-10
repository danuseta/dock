import type { SprintDashboardService } from './sprint-dashboard';

const WIB_OFFSET_HOURS = 7;
const HOUR_MS = 3600 * 1000;

export function nextRunAt(now: Date, hourWib: number): Date {
  const shifted = now.getTime() + WIB_OFFSET_HOURS * HOUR_MS;
  const dayStart = Math.floor(shifted / (24 * HOUR_MS)) * 24 * HOUR_MS;
  let run = dayStart + hourWib * HOUR_MS;
  if (run <= shifted) run += 24 * HOUR_MS;
  return new Date(run - WIB_OFFSET_HOURS * HOUR_MS);
}

export function startSprintScheduler(service: SprintDashboardService): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const schedule = async () => {
    if (stopped) return;
    const config = await service.getConfig().catch(() => null);
    const delay = nextRunAt(new Date(), config ? config.dailyHour : 6).getTime() - Date.now();
    timer = setTimeout(() => {
      service.runDaily()
        .catch((error) => console.error('[Sprint] Daily update failed:', error instanceof Error ? error.message : error))
        .finally(() => { void schedule(); });
    }, delay);
    timer.unref();
  };

  void service.isStale().then(async (stale) => {
    if (stale) await service.runDaily();
  }).catch((error) => console.error('[Sprint] Startup catch-up failed:', error instanceof Error ? error.message : error))
    .finally(() => { void schedule(); });

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
