/** The account `cycle.py` calls the machine's own Claude Code login. */
export const MAIN_ACCOUNT = 'main';
export const ACCOUNT_NAME = /^[A-Za-z0-9_-]{1,30}$/;
export const ROTATION_DEFAULTS = { enabled: false, fiveHour: 90, sevenDay: 95, backToMain: true };
const LOG_SIZE = 20;

export interface UsageWindow { usedPercentage: number; resetsAt: Date | null }
export interface AccountUsage { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; receivedAt: Date }
export interface Rotation { enabled: boolean; fiveHour: number; sevenDay: number; backToMain: boolean }
export interface RotationEntry { at: Date; from: string; to: string; reason: string; auto: boolean }
export interface CycleList { accounts: string[]; active: string | null }

/** `cycle.py list`: `[1] * main  (your own login)`, one line per account, the active one marked with `*`. */
export function parseCycleList(output: string): CycleList {
  const accounts: string[] = [];
  let active: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const match = /^\[\d+\]\s+(\*\s+)?([A-Za-z0-9_-]{1,30})(\s|$)/.exec(line);
    if (!match) continue;
    accounts.push(match[2]);
    if (match[1]) active = match[2];
  }
  return { accounts, active };
}

/** A window still running at `now`; one past its reset says nothing about the usage any more. */
const current = (window: UsageWindow | null, now: Date) => (window && !(window.resetsAt && window.resetsAt.getTime() < now.getTime()) ? window : null);

/** Why an account is over the owner's limits, or null when it is not (an unknown or reset window is not over). */
export function overLimit(usage: AccountUsage | undefined, rule: Rotation, now: Date): string | null {
  if (!usage) return null;
  const fiveHour = current(usage.fiveHour, now);
  const sevenDay = current(usage.sevenDay, now);
  if (fiveHour && fiveHour.usedPercentage >= rule.fiveHour) return `5h at ${Math.round(fiveHour.usedPercentage)}%`;
  if (sevenDay && sevenDay.usedPercentage >= rule.sevenDay) return `7d at ${Math.round(sevenDay.usedPercentage)}%`;
  return null;
}

/**
 * The account a usage report belongs to. A turn started before a switch still reports its old account, so a report
 * whose 7 day reset time matches another account's is that account's: each account's weekly window resets at its own time.
 */
export function attribute(report: AccountUsage, active: string, usage: Record<string, AccountUsage>): string {
  const reset = report.sevenDay?.resetsAt?.getTime();
  if (!reset) return active;
  const owner = Object.entries(usage).find(([name, seen]) => name !== active && seen.sevenDay?.resetsAt?.getTime() === reset);
  return owner ? owner[0] : active;
}

export type Decision = { to: string; reason: string } | { stuck: string } | null;

/**
 * What auto rotate does now. The active account over a limit moves to the next account in the list below both limits
 * (an account never seen counts as below). With every account over, it stays and says so. Back to main applies only
 * after an automatic move away from main, once main is below the limits again.
 */
export function decide(input: { accounts: string[]; active: string; usage: Record<string, AccountUsage>; rule: Rotation; last: RotationEntry | null; now: Date }): Decision {
  const { accounts, active, usage, rule, last, now } = input;
  if (!rule.enabled || !accounts.includes(active)) return null;
  const reason = overLimit(usage[active], rule, now);
  if (reason) {
    const start = accounts.indexOf(active);
    const order = [...accounts.slice(start + 1), ...accounts.slice(0, start)];
    const next = order.find((name) => !overLimit(usage[name], rule, now));
    if (next) return { to: next, reason: `${active} ${reason}` };
    return { stuck: accounts.map((name) => `${name} ${overLimit(usage[name], rule, now) ?? 'ok'}`).join(', ') };
  }
  const leftMain = last?.auto && last.from === MAIN_ACCOUNT && last.to === active;
  if (rule.backToMain && active !== MAIN_ACCOUNT && leftMain && accounts.includes(MAIN_ACCOUNT) && usage[MAIN_ACCOUNT] && !overLimit(usage[MAIN_ACCOUNT], rule, now)) {
    return { to: MAIN_ACCOUNT, reason: `${MAIN_ACCOUNT} is below the limits again` };
  }
  return null;
}

export interface ClaudeAccountsDeps {
  list(): Promise<CycleList>;
  switchTo(name: string): Promise<void>;
  rotation(): Promise<Rotation>;
  saveRotation(rule: Rotation): Promise<void>;
  usage(): Promise<Record<string, AccountUsage>>;
  saveUsage(usage: Record<string, AccountUsage>): Promise<void>;
  log(): Promise<RotationEntry[]>;
  saveLog(log: RotationEntry[]): Promise<void>;
  /** A switch makes the machine's last usage snapshot belong to the old account. */
  switched(): void;
  push(message: { title: string; body: string; url: string; tag: string }): Promise<unknown>;
  now(): Date;
}

/** The Claude accounts of `/cycle` on this machine: switch by hand, keep each account's usage, rotate on the owner's limits. */
export class ClaudeAccounts {
  private busy = false;
  private stuck: string | null = null;

  constructor(private readonly deps: ClaudeAccountsDeps) {}

  async state() {
    const [list, usage, rule, log] = await Promise.all([this.deps.list(), this.deps.usage(), this.deps.rotation(), this.deps.log()]);
    const now = this.deps.now();
    const window = (value: UsageWindow | null) => {
      const live = current(value, now);
      return live && { usedPercentage: live.usedPercentage, resetsAt: live.resetsAt?.toISOString() ?? null };
    };
    return {
      accounts: list.accounts.map((name) => ({
        name,
        active: name === list.active,
        fiveHour: window(usage[name]?.fiveHour ?? null),
        sevenDay: window(usage[name]?.sevenDay ?? null),
        seenAt: usage[name]?.receivedAt.toISOString() ?? null,
      })),
      rotation: rule,
      log: log.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
    };
  }

  /** The owner's own switch. */
  async use(name: string) {
    if (!ACCOUNT_NAME.test(name)) throw new Error('Unknown account');
    const list = await this.deps.list();
    if (!list.accounts.includes(name)) throw new Error(`No account named ${name}`);
    if (list.active !== name) await this.move(list.active ?? '?', name, 'switched by hand', false);
    return this.state();
  }

  async setRotation(rule: Rotation) {
    for (const value of [rule.fiveHour, rule.sevenDay]) {
      if (!Number.isInteger(value) || value < 50 || value > 100) throw new Error('A limit is a whole percentage from 50 to 100');
    }
    await this.deps.saveRotation(rule);
    return this.state();
  }

  /** One usage report from a turn on this machine: kept under its account, then auto rotate looks at it. */
  async report(limits: { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null }) {
    const list = await this.deps.list();
    if (!list.active) return;
    const usage = await this.deps.usage();
    const report = { ...limits, receivedAt: this.deps.now() };
    usage[attribute(report, list.active, usage)] = report;
    await this.deps.saveUsage(usage);
    await this.check(list, usage);
  }

  /** Auto rotate between reports, so back to main happens without a turn. */
  async tick() {
    const rule = await this.deps.rotation();
    if (!rule.enabled) return;
    await this.check(await this.deps.list(), await this.deps.usage(), rule);
  }

  private async check(list: CycleList, usage: Record<string, AccountUsage>, known?: Rotation) {
    if (this.busy || !list.active) return;
    this.busy = true;
    try {
      const rule = known ?? await this.deps.rotation();
      const log = await this.deps.log();
      const decision = decide({ accounts: list.accounts, active: list.active, usage, rule, last: log[0] ?? null, now: this.deps.now() });
      if (!decision) { this.stuck = null; return; }
      if ('stuck' in decision) {
        if (this.stuck === decision.stuck) return;
        this.stuck = decision.stuck;
        await this.deps.push({ title: 'Every Claude account is over its limit', body: `${decision.stuck}. Staying on ${list.active}.`, url: '/settings?section=claude', tag: 'claude-account-stuck' });
        return;
      }
      this.stuck = null;
      await this.move(list.active, decision.to, decision.reason, true);
      await this.deps.push({ title: `Claude account: ${decision.to}`, body: `${decision.reason}. The next turns run on ${decision.to}.`, url: '/settings?section=claude', tag: 'claude-account' });
    } finally {
      this.busy = false;
    }
  }

  private async move(from: string, to: string, reason: string, auto: boolean) {
    await this.deps.switchTo(to);
    this.deps.switched();
    const log = await this.deps.log();
    await this.deps.saveLog([{ at: this.deps.now(), from, to, reason, auto }, ...log].slice(0, LOG_SIZE));
  }
}
