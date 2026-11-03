/** The account `cycle.py` calls the machine's own Claude Code login. */
export const MAIN_ACCOUNT = 'main';
export const ACCOUNT_NAME = /^[A-Za-z0-9_-]{1,30}$/;
export const ROTATION_DEFAULTS = { enabled: false, fiveHour: 90, sevenDay: 95, backToMain: true };
const LOG_SIZE = 20;
const PROBE_FRESH_MS = 2 * 3_600_000;
const REFRESH_MIN_MS = 60_000;

export interface UsageWindow { usedPercentage: number; resetsAt: Date | null }
export interface AccountUsage { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; receivedAt: Date; status?: string; checkedAt?: Date }
export interface ProbeRow { name: string; status: string; fiveHour: UsageWindow | null; sevenDay: UsageWindow | null }
export interface Rotation { enabled: boolean; fiveHour: number; sevenDay: number; backToMain: boolean }
export interface RotationEntry { at: Date; from: string; to: string; reason: string; auto: boolean }
export interface CycleList { accounts: string[]; active: string | null }

export const parseWindow = (value: unknown): UsageWindow | null => {
  const raw = value as { usedPercentage?: unknown; resetsAt?: unknown } | null;
  return raw && typeof raw.usedPercentage === 'number' ? { usedPercentage: raw.usedPercentage, resetsAt: typeof raw.resetsAt === 'string' ? new Date(raw.resetsAt) : null } : null;
};

/** `kit/account-usage.py`: a JSON array with one row per account; a row without a name or status is dropped. */
export function parseProbe(output: string): ProbeRow[] {
  const rows: unknown = JSON.parse(output);
  if (!Array.isArray(rows)) throw new Error('The usage probe did not return a list');
  return rows.flatMap((row: { name?: unknown; status?: unknown; fiveHour?: unknown; sevenDay?: unknown }) =>
    typeof row?.name === 'string' && typeof row.status === 'string' ? [{ name: row.name, status: row.status, fiveHour: parseWindow(row.fiveHour), sevenDay: parseWindow(row.sevenDay) }] : []);
}

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
  if (usage.status === 'rejected' && usage.checkedAt && now.getTime() - usage.checkedAt.getTime() < PROBE_FRESH_MS) return 'rejected by the usage probe';
  const fiveHour = current(usage.fiveHour, now);
  const sevenDay = current(usage.sevenDay, now);
  if (fiveHour && fiveHour.usedPercentage >= rule.fiveHour) return `5h at ${Math.round(fiveHour.usedPercentage)}%`;
  if (sevenDay && sevenDay.usedPercentage >= rule.sevenDay) return `7d at ${Math.round(sevenDay.usedPercentage)}%`;
  return null;
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
  /** One request per account through the kit script; null when this machine has none. */
  probe(): Promise<ProbeRow[] | null>;
  usage(): Promise<Record<string, AccountUsage>>;
  saveUsage(usage: Record<string, AccountUsage>): Promise<void>;
  log(): Promise<RotationEntry[]>;
  saveLog(log: RotationEntry[]): Promise<void>;
  /** A switch makes the machine's last usage snapshot belong to the old account. */
  switched(): void;
  /** The machine's last usage snapshot from before the accounts were tracked. */
  machineUsage(): AccountUsage | null;
  push(message: { title: string; body: string; url: string; tag: string }): Promise<unknown>;
  now(): Date;
}

/** The Claude accounts of `/cycle` on this machine: switch by hand, keep each account's usage, rotate on the owner's limits. */
export class ClaudeAccounts {
  private busy = false;
  private stuck: string | null = null;
  private lastProbe = 0;

  constructor(private readonly deps: ClaudeAccountsDeps) {}

  async state() {
    const [list, usage, rule, log] = await Promise.all([this.deps.list(), this.deps.usage(), this.deps.rotation(), this.deps.log()]);
    const now = this.deps.now();
    // Before the first switch, the machine's last snapshot can only be the active account's: it starts the tracking.
    const seed = list.active && !usage[list.active] && log.length === 0 ? this.deps.machineUsage() : null;
    if (seed && list.active) {
      usage[list.active] = seed;
      await this.deps.saveUsage(usage);
    }
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
        status: usage[name]?.status ?? null,
        checkedAt: usage[name]?.checkedAt?.toISOString() ?? null,
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

  /** Probe every account, keyed by the names `cycle.py list` gives; a row under another name is dropped and the old `main` is `claude1`. */
  async probe() {
    this.lastProbe = this.deps.now().getTime();
    const [list, rows, saved] = await Promise.all([this.deps.list(), this.deps.probe(), this.deps.usage()]);
    if (!rows) return;
    const now = this.deps.now();
    if (saved[MAIN_ACCOUNT] && !saved.claude1 && list.accounts.includes('claude1')) saved.claude1 = saved[MAIN_ACCOUNT];
    const usage: Record<string, AccountUsage> = {};
    for (const name of list.accounts) {
      const row = rows.find((candidate) => candidate.name === name);
      const old = saved[name];
      if (!row) { if (old) usage[name] = old; continue; }
      const measured = row.status === 'allowed' || row.status === 'rejected';
      usage[name] = measured || !old
        ? { fiveHour: row.fiveHour, sevenDay: row.sevenDay, receivedAt: now, status: row.status, checkedAt: now }
        : { ...old, status: row.status, checkedAt: now };
    }
    await this.deps.saveUsage(usage);
    await this.check(list, usage);
  }

  /** The owner's refresh button: at most one probe a minute, otherwise the stored data. */
  async refresh() {
    if (this.deps.now().getTime() - this.lastProbe >= REFRESH_MIN_MS) await this.probe();
    return this.state();
  }

  /** One usage report from a turn on this machine: kept under the active account, then auto rotate looks at it. */
  async report(limits: { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null }) {
    const list = await this.deps.list();
    if (!list.active) return;
    const usage = await this.deps.usage();
    const { status, checkedAt } = usage[list.active] ?? {};
    usage[list.active] = { ...limits, receivedAt: this.deps.now(), status, checkedAt };
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
