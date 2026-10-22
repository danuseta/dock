import { StorageService } from '../storage/service';
import { JiraSprintClient, createJiraHttp, type BoardSprint } from './jira-sprint';
import {
  DEFAULT_SPRINT_CONFIG, RULES_VERSION, buildTrend, computeSprintMetrics, detectRoster, sprintLabel,
  type RosterMember, type SprintConfig, type SprintContext, type SprintIssue, type SprintResult,
} from './sprint-metrics';

const BOARD_KEY = 'sprintBoardId';
const CONFIG_KEY = 'sprintDashboardConfig';
const MAX_BACKFILL = 30;
const STALE_AFTER_MS = 24 * 3600 * 1000;
const LABEL_SEARCH_FAILED = 'Label search failed: ';
const LABEL_POOL_MISSING = 'Label pool has not been fetched; run the backfill';

export class SprintBusyError extends Error {
  constructor(state: { label: string; done: number; total: number }) {
    const progress = state.total > 0 ? ` (${state.done} of ${state.total})` : '';
    super(`A sprint dashboard refresh is already running: ${state.label}${progress}. Wait for it to finish.`);
    this.name = 'SprintBusyError';
  }
}

export class SprintInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SprintInputError';
  }
}

export interface SnapshotRow {
  sprintId: number;
  name: string;
  state: string;
  startDate: Date;
  endDate: Date;
  result: string | null;
  computedAt: Date | null;
  lastError: string | null;
}

export interface SprintStore {
  getSettings(): Promise<Array<{ key: string; value: string }>>;
  upsertSetting(key: string, value: string, description?: string): Promise<unknown>;
  getSprintSnapshots(): Promise<SnapshotRow[]>;
  getSprintSnapshot(sprintId: number): Promise<SnapshotRow | null>;
  upsertSprintSnapshot(data: {
    sprintId: number; name: string; state: string; startDate: Date; endDate: Date;
    result?: string | null; computedAt?: Date | null; lastError?: string | null;
  }): Promise<unknown>;
  getSprintIssueEvents(sprintId: number): Promise<{ issues: string; fetchedAt: Date; labelPool: string | null } | null>;
  upsertSprintIssueEvents(sprintId: number, issues: string, fetchedAt: Date, labelPool?: string): Promise<unknown>;
}

export interface RefreshState {
  status: 'idle' | 'running' | 'error';
  label: string;
  done: number;
  total: number;
  error: string | null;
}

export interface SprintSummary {
  id: number;
  name: string;
  state: string;
  startDate: string;
  endDate: string;
  computedAt: string | null;
  lastError: string | null;
}

type ClientFactory = () => Promise<JiraSprintClient>;

function describeError(error: unknown): string {
  const status = (error as any)?.response?.status;
  const message = error instanceof Error ? error.message : String(error);
  return status ? `Jira responded ${status}: ${message}` : message;
}

export function parseSprintConfig(json: string | null | undefined): SprintConfig {
  if (!json || !json.trim()) return { ...DEFAULT_SPRINT_CONFIG };
  let parsed: any;
  try { parsed = JSON.parse(json); } catch { throw new SprintInputError('Sprint config is not valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SprintInputError('Sprint config must be a JSON object');
  const roster = parsed.roster ?? [];
  if (!Array.isArray(roster) || roster.some((m: any) => !m || [m.full, m.short, m.token].some((v) => typeof v !== 'string' || !v.trim()))) {
    throw new SprintInputError('Each roster override needs full, short, and token');
  }
  if (roster.some((m: any) => m.reviewer !== undefined && typeof m.reviewer !== 'boolean')) {
    throw new SprintInputError('Each roster reviewer flag must be true or false');
  }
  const config: SprintConfig = { ...DEFAULT_SPRINT_CONFIG, ...parsed, roster };
  for (const key of ['loadTarget', 'targetPerDev', 'bugMarginPerDev', 'slaDays', 'tzOffsetHours', 'dailyHour'] as const) {
    if (typeof config[key] !== 'number' || !Number.isFinite(config[key])) throw new SprintInputError(`Sprint config ${key} must be a number`);
  }
  const cutoffs = config.cutoffs;
  if (!cutoffs || typeof cutoffs !== 'object' || Array.isArray(cutoffs) || Object.values(cutoffs).some((v) => typeof v !== 'string' || Number.isNaN(Date.parse(v)))) {
    throw new SprintInputError('Sprint config cutoffs must map a sprint label to a date-time');
  }
  if (config.loadTarget <= 0) throw new SprintInputError('Sprint config loadTarget must be above zero');
  if (!Number.isInteger(config.dailyHour) || config.dailyHour < 0 || config.dailyHour > 23) throw new SprintInputError('Sprint config dailyHour must be 0 to 23');
  return config;
}

function isCurrent(result: string | null): boolean {
  if (!result) return false;
  try { return JSON.parse(result).rulesVersion === RULES_VERSION; } catch { return false; }
}

function nextSprintOf<T extends { name: string }>(current: T, all: T[], startOf: (item: T) => number, tzMs: number): T | undefined {
  const prefixOf = (name: string) => sprintLabel(name).label.replace(/\d+$/, '');
  const dayOf = (item: T) => Math.floor((startOf(item) + tzMs) / 86400000);
  const prefix = prefixOf(current.name);
  return all
    .filter((other) => prefixOf(other.name) === prefix && dayOf(other) > dayOf(current))
    .sort((a, b) => startOf(a) - startOf(b))[0];
}

export class SprintDashboardService {
  private running: Promise<void> | null = null;
  private state: RefreshState = { status: 'idle', label: '', done: 0, total: 0, error: null };

  constructor(
    private readonly store: SprintStore,
    private readonly clientFactory: ClientFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  refreshState(): RefreshState { return { ...this.state }; }
  idle(): Promise<void> { return this.running ?? Promise.resolve(); }

  private async setting(key: string): Promise<string | null> {
    const found = (await this.store.getSettings()).find((s) => s.key === key);
    return found ? found.value : null;
  }

  async getConfig(): Promise<SprintConfig> {
    return parseSprintConfig(await this.setting(CONFIG_KEY));
  }

  /** The roster detected from every stored sprint, with the config's own entries on top. */
  async roster(): Promise<RosterMember[]> {
    const issues: SprintIssue[] = [];
    for (const row of await this.store.getSprintSnapshots()) {
      const events = await this.store.getSprintIssueEvents(row.sprintId);
      if (!events) continue;
      try { issues.push(...JSON.parse(events.issues) as SprintIssue[]); } catch { /* an unreadable sprint adds nobody */ }
    }
    return detectRoster(issues, (await this.getConfig()).roster);
  }

  async boardId(): Promise<string> {
    return (await this.setting(BOARD_KEY)) || '';
  }

  async getSettings() {
    const config = await this.setting(CONFIG_KEY);
    return { boardId: await this.boardId(), config: config || JSON.stringify(DEFAULT_SPRINT_CONFIG, null, 2) };
  }

  async updateSettings(boardId: string, configJson: string): Promise<void> {
    const id = boardId.trim();
    if (id && !/^\d{1,10}$/.test(id)) throw new SprintInputError('Board id must be a number');
    const config = parseSprintConfig(configJson);
    await this.store.upsertSetting(BOARD_KEY, id, 'Jira board id for the sprint dashboard');
    await this.store.upsertSetting(CONFIG_KEY, JSON.stringify(config, null, 2), 'Sprint dashboard config');
    await this.recomputeAll(config);
  }

  private windowOf(row: SnapshotRow, next?: SnapshotRow) {
    return {
      id: row.sprintId, name: row.name, state: (row.state === 'active' ? 'active' : 'closed') as 'active' | 'closed',
      start: row.startDate.toISOString(), end: row.endDate.toISOString(), nextStart: next?.startDate.toISOString(),
    };
  }

  private identityOf(row: SnapshotRow) {
    return { sprintId: row.sprintId, name: row.name, state: row.state, startDate: row.startDate, endDate: row.endDate };
  }

  private async recomputeAll(base: SprintConfig): Promise<void> {
    const rows = await this.store.getSprintSnapshots();
    const stored = new Map<number, { issues: SprintIssue[]; fetchedAt: Date; labelPool: string | null }>();
    for (const row of rows) {
      const events = await this.store.getSprintIssueEvents(row.sprintId);
      if (!events) continue;
      try {
        stored.set(row.sprintId, { issues: JSON.parse(events.issues) as SprintIssue[], fetchedAt: events.fetchedAt, labelPool: events.labelPool });
      } catch (error) {
        await this.store.upsertSprintSnapshot({ ...this.identityOf(row), lastError: describeError(error) });
      }
    }
    const config = { ...base, roster: detectRoster([...stored.values()].flatMap((entry) => entry.issues), base.roster) };
    const ordered = [...rows].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const tzMs = config.tzOffsetHours * 3600 * 1000;
    for (const row of rows) {
      const entry = stored.get(row.sprintId);
      if (!entry) continue;
      const at = ordered.indexOf(row);
      try {
        const context: SprintContext = {
          fetchedAt: entry.fetchedAt.toISOString(),
          labelPool: entry.labelPool ? JSON.parse(entry.labelPool) as SprintIssue[] : [],
          reviewPool: [ordered[at - 1], ordered[at + 1]].flatMap((neighbour) => (neighbour && stored.get(neighbour.sprintId)?.issues) || []),
        };
        const next = nextSprintOf(row, rows, (item) => item.startDate.getTime(), tzMs);
        const lastError = row.lastError?.startsWith(LABEL_SEARCH_FAILED) ? row.lastError : entry.labelPool == null ? LABEL_POOL_MISSING : null;
        const result = computeSprintMetrics(this.windowOf(row, next), entry.issues, config, context);
        await this.store.upsertSprintSnapshot({ ...this.identityOf(row), result: JSON.stringify(result), lastError });
      } catch (error) {
        await this.store.upsertSprintSnapshot({ ...this.identityOf(row), lastError: describeError(error) });
      }
    }
  }

  private async computeAndStore(sprint: BoardSprint, client: JiraSprintClient, config: SprintConfig): Promise<void> {
    const base = {
      sprintId: sprint.id, name: sprint.name, state: sprint.state,
      startDate: new Date(sprint.startDate), endDate: new Date(sprint.endDate),
    };
    try {
      const issues = await client.fetchSprintIssues(sprint.id);
      const inSprint = new Set(issues.map((issue) => issue.key));
      let labelPool: SprintIssue[] | undefined;
      let labelError: string | null = null;
      try {
        labelPool = (await client.fetchLabelIssues(sprintLabel(sprint.name).label, await this.projectKeys())).filter((issue) => !inSprint.has(issue.key));
      } catch (error) {
        labelError = `${LABEL_SEARCH_FAILED}${describeError(error)}`;
        this.state.error = this.state.error ?? labelError;
      }
      const fetchedAt = this.now();
      await this.store.upsertSprintIssueEvents(sprint.id, JSON.stringify(issues), fetchedAt, labelPool && JSON.stringify(labelPool));
      const result = computeSprintMetrics(
        { id: sprint.id, name: sprint.name, state: sprint.state, start: base.startDate.toISOString(), end: base.endDate.toISOString() },
        issues, config, { fetchedAt: fetchedAt.toISOString(), labelPool },
      );
      await this.store.upsertSprintSnapshot({ ...base, result: JSON.stringify(result), computedAt: fetchedAt, lastError: labelError });
    } catch (error) {
      await this.store.upsertSprintSnapshot({ ...base, lastError: describeError(error) });
      throw error;
    }
  }

  private async projectKeys(): Promise<string[]> {
    return ((await this.setting('jiraProjectKeys')) || '').split(',').map((key) => key.trim()).filter(Boolean);
  }

  private async prepare(): Promise<{ client: JiraSprintClient; config: SprintConfig; sprints: BoardSprint[] }> {
    const config = await this.getConfig();
    const client = await this.clientFactory();
    let boardId = await this.boardId();
    if (!boardId) {
      boardId = (await client.findBoardId(await this.projectKeys())) || '';
      if (!boardId) throw new SprintInputError('No Scrum board found in Jira for the configured projects');
      await this.store.upsertSetting(BOARD_KEY, boardId, 'Jira board id for the sprint dashboard');
    }
    return { client, config, sprints: await client.listSprints(boardId) };
  }

  private start(label: string, total: number, work: () => Promise<void>): RefreshState {
    if (this.running) throw new SprintBusyError(this.state);
    this.state = { status: 'running', label, done: 0, total, error: null };
    const run = work()
      .then(() => { this.state = { ...this.state, status: this.state.error ? 'error' : 'idle' }; })
      .catch((error) => { this.state = { ...this.state, status: 'error', error: describeError(error) }; })
      .finally(() => { if (this.running === run) this.running = null; });
    this.running = run;
    return this.refreshState();
  }

  startRefresh(sprintId: number): RefreshState {
    return this.start('Refreshing sprint', 1, async () => {
      const { client, config, sprints } = await this.prepare();
      const sprint = sprints.find((s) => s.id === sprintId);
      if (!sprint) throw new SprintInputError(`Sprint ${sprintId} is not on the board`);
      await this.computeAndStore(sprint, client, config);
      await this.recomputeAll(config);
      this.state.done = 1;
    });
  }

  startBackfill(count: number): RefreshState {
    if (!Number.isInteger(count) || count < 1 || count > MAX_BACKFILL) throw new SprintInputError(`Backfill count must be 1 to ${MAX_BACKFILL}`);
    return this.start('Backfilling sprints', 0, async () => {
      const { client, config, sprints } = await this.prepare();
      const wanted = [...sprints].sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate)).slice(0, count);
      const existing = new Map((await this.store.getSprintSnapshots()).map((r) => [r.sprintId, r]));
      const todo: BoardSprint[] = [];
      for (const s of wanted) {
        const row = existing.get(s.id);
        const done = row && row.state === 'closed' && s.state === 'closed' && isCurrent(row.result)
          && (await this.store.getSprintIssueEvents(s.id))?.labelPool != null;
        if (!done) todo.push(s);
      }
      this.state.total = todo.length;
      let failed = 0;
      for (const sprint of todo) {
        try { await this.computeAndStore(sprint, client, config); } catch { failed++; }
        this.state.done++;
      }
      await this.recomputeAll(config);
      if (failed) this.state.error = `${failed} sprint(s) failed; run the backfill again to retry them`;
    });
  }

  async runDaily(): Promise<void> {
    try {
      this.start('Daily sprint update', 0, async () => {
        const { client, config, sprints } = await this.prepare();
        const existing = new Map((await this.store.getSprintSnapshots()).map((r) => [r.sprintId, r]));
        const tzMs = config.tzOffsetHours * 3600 * 1000;
        const todo: BoardSprint[] = [];
        for (const s of sprints) {
          let final = false;
          if (s.state === 'closed' && existing.has(s.id)) {
            const next = nextSprintOf(s, sprints, (item) => Date.parse(item.startDate), tzMs);
            const events = next && await this.store.getSprintIssueEvents(s.id);
            final = !!events && !!next && events.fetchedAt.getTime() < Date.parse(next.startDate);
          }
          if (s.state === 'active' || existing.get(s.id)?.state === 'active' || final) todo.push(s);
        }
        this.state.total = todo.length;
        let failed = 0;
        for (const sprint of todo) {
          try { await this.computeAndStore(sprint, client, config); } catch { failed++; }
          this.state.done++;
        }
        await this.recomputeAll(config);
        if (failed) this.state.error = `${failed} sprint(s) failed to update`;
      });
    } catch (error) {
      if (!(error instanceof SprintBusyError)) throw error;
    }
    await this.idle();
  }

  async isStale(): Promise<boolean> {
    const active = (await this.store.getSprintSnapshots()).find((r) => r.state === 'active');
    return !active || !active.computedAt || this.now().getTime() - active.computedAt.getTime() > STALE_AFTER_MS;
  }

  private summarize(row: SnapshotRow): SprintSummary {
    return {
      id: row.sprintId, name: row.name, state: row.state, startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(), computedAt: row.computedAt ? row.computedAt.toISOString() : null, lastError: row.lastError,
    };
  }

  async listSprints(): Promise<SprintSummary[]> {
    return (await this.store.getSprintSnapshots()).map((row) => this.summarize(row));
  }

  async getDashboard(sprintId?: number | null) {
    const rows = await this.store.getSprintSnapshots();
    const row = sprintId != null
      ? rows.find((r) => r.sprintId === sprintId)
      : rows.find((r) => r.state === 'active') || rows[0];
    return { summary: row ? this.summarize(row) : null, result: row?.result ?? null, refreshState: this.refreshState() };
  }

  async issueEvents(sprintId: number): Promise<string> {
    return (await this.store.getSprintIssueEvents(sprintId))?.issues ?? '[]';
  }

  async trend(): Promise<string> {
    const results = (await this.store.getSprintSnapshots())
      .filter((r) => r.result)
      .map((r) => JSON.parse(r.result as string) as SprintResult);
    return JSON.stringify(buildTrend(results));
  }
}

async function defaultClient(store: SprintStore): Promise<JiraSprintClient> {
  const settings = await store.getSettings();
  const value = (key: string) => settings.find((s) => s.key === key)?.value || '';
  const credentials = { domain: value('jiraUrl'), email: value('jiraEmail'), apiToken: value('jiraApiToken') };
  if (!credentials.domain || !credentials.email || !credentials.apiToken) {
    throw new SprintInputError('Jira credentials are not configured in Settings');
  }
  return new JiraSprintClient(createJiraHttp(credentials));
}

const storage = new StorageService();
export const sprintDashboardService = new SprintDashboardService(storage, () => defaultClient(storage));
