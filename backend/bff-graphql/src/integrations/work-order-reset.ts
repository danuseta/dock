// The one-time move of the work order back to Jira: the Plan agent used to write a DOCK position for every ticket, which
// beat the "#N" label. Once per DOCK database, the position of every ticket that has a "#N" label is cleared, so the label
// decides again. Manual tickets and tickets without a label keep their row. The same first start records every sprint that
// is already active as started, so "Hold a new sprint until I start it" holds the next sprint, not the one in progress.
import { SPRINT_STARTED_KEY, labelOrder } from './orchestrator-cron';

export const WORK_ORDER_RESET_KEY = 'workOrderResetToJira:v1';

export interface ResetTicket { key: string; labels?: string[]; sprintName?: string | null; sprintState?: string | null }

export interface WorkOrderResetDeps {
  now(): Date;
  settingValue(key: string): Promise<string | null>;
  saveSetting(key: string, value: string, description: string): Promise<unknown>;
  orders(): Promise<Map<string, number>>;
  manualKeys(): Promise<Set<string>>;
  clearOrder(key: string): Promise<unknown>;
}

export class WorkOrderReset {
  private done = false;
  private running: Promise<number | null> | null = null;

  constructor(private readonly deps: WorkOrderResetDeps) {}

  /** Clears the labelled positions once; null when it ran before or the tickets are not known yet. Resolves to how many were cleared. */
  run(tickets: ResetTicket[]): Promise<number | null> {
    if (this.done) return Promise.resolve(null);
    if (!this.running) this.running = this.reset(tickets).finally(() => { this.running = null; });
    return this.running;
  }

  private async reset(tickets: ResetTicket[]): Promise<number | null> {
    if (await this.deps.settingValue(WORK_ORDER_RESET_KEY)) {
      this.done = true;
      return null;
    }
    if (tickets.length === 0) return null;
    if (!(await this.deps.settingValue(SPRINT_STARTED_KEY))) {
      const active = [...new Set(tickets.filter((ticket) => String(ticket.sprintState ?? '').toUpperCase() === 'ACTIVE' && ticket.sprintName).map((ticket) => ticket.sprintName as string))];
      const at = this.deps.now().toISOString();
      if (active.length) await this.deps.saveSetting(SPRINT_STARTED_KEY, JSON.stringify(Object.fromEntries(active.map((sprint) => [sprint, at]))), 'Sprints whose work the owner started');
    }
    const [orders, manual] = await Promise.all([this.deps.orders(), this.deps.manualKeys()]);
    const labelled = new Set(tickets.filter((ticket) => labelOrder(ticket.labels) !== null).map((ticket) => ticket.key));
    const keys = [...orders.keys()].filter((key) => labelled.has(key) && !manual.has(key));
    for (const key of keys) await this.deps.clearOrder(key);
    await this.deps.saveSetting(WORK_ORDER_RESET_KEY, this.deps.now().toISOString(), 'One-time reset of the work order to the Jira #N labels');
    this.done = true;
    console.log(`[WorkOrder] Reset to the Jira #N labels: ${keys.length} ${keys.length === 1 ? 'position' : 'positions'} cleared`);
    return keys.length;
  }
}
