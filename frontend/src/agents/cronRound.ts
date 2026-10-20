/** What one fill of the orchestrator cron did, as the server reports it. */
export interface FillLog {
  at: string;
  skipped: string | null;
  started: string[];
  parked: string[];
  deferred: Array<{ key: string; reason: string }>;
  notMoved: string[];
  failed: string[];
  /** Missing in a fill saved before released runs were reported. */
  released?: string[];
}

/** The cron row on the Agents page. */
export interface CronStatus {
  enabled: boolean;
  slots: { busy: number; waiting: number };
  parallel: number;
  startedToday: number;
  maxPerDay: number;
  lastFill: FillLog | null;
}

export function fillSummary(fill: FillLog | null): string {
  if (!fill) return 'Nothing has run yet.';
  const when = new Date(fill.at).toLocaleString();
  if (fill.skipped) return `${when}: nothing taken, ${fill.skipped}.`;
  const parts = [
    `started ${fill.started.join(', ') || 'nothing'}`,
    fill.parked.length ? `parked ${fill.parked.join(', ')}` : '',
    fill.notMoved.length ? `Jira did not move ${fill.notMoved.join(', ')}` : '',
    fill.failed.length ? `failed ${fill.failed.join(', ')}` : '',
    fill.released?.length ? `start failed, back to To Do: ${fill.released.join(', ')}` : '',
  ].filter(Boolean);
  return `${when}: ${parts.join('; ')}.`;
}

/** Deferred tickets grouped by reason: "slots full: 2 of 2 in use: QRD-3, QRD-4". */
export function deferredLines(fill: FillLog | null): string[] {
  const byReason = new Map<string, string[]>();
  for (const item of fill?.deferred || []) byReason.set(item.reason, [...(byReason.get(item.reason) || []), item.key]);
  return [...byReason].map(([reason, keys]) => `${reason}: ${keys.join(', ')}`);
}

export const WEEK_DAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 7, label: 'Sun' },
];

export const MODE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'manual', label: 'Manual' },
];

export const ENGINE_OPTIONS = [
  { value: 'sous', label: 'sous' },
  { value: 'omc', label: 'build-ticket (older)' },
];

export const ENGINE_HINT: Record<string, string> = {
  sous: 'The sous skill runs the ticket without GATE 1 up to an opened pull request, demo video included.',
  omc: 'The build-ticket skill stops before the pull request and waits for the owner.',
};

export const MODE_HINT: Record<string, string> = {
  auto: 'Claude decides; a risky action is refused and the agent finds another way.',
  acceptEdits: 'File edits go through; commands still ask you.',
  manual: 'Every tool asks you.',
};

/** The cron config as the form holds it: text fields as strings, lists as comma-separated text, work days as numbers. */
export interface CronForm {
  enabled: boolean;
  machine: string;
  parallel: string;
  workStart: string;
  workEnd: string;
  workDays: number[];
  activeFrom: string;
  activeUntil: string;
  maxPerDay: string;
  mode: string;
  sprint: string;
  labels: string;
  todoStatuses: string;
  inProgressStatus: string;
  model: string;
  effort: string;
  usageBrakePercent: string;
  notifyUserId: string;
  engine: string;
}

const list = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean);

export function formFromConfig(configJson: string): CronForm {
  const config = JSON.parse(configJson);
  return {
    enabled: config.enabled,
    machine: config.machine,
    parallel: String(config.parallel),
    workStart: String(config.workStart),
    workEnd: String(config.workEnd),
    workDays: config.workDays,
    activeFrom: config.activeFrom || '',
    activeUntil: config.activeUntil || '',
    maxPerDay: String(config.maxPerDay),
    mode: config.mode,
    sprint: config.sprint,
    labels: config.labels.join(', '),
    todoStatuses: config.todoStatuses.join(', '),
    inProgressStatus: config.inProgressStatus,
    model: config.model || '',
    effort: config.effort || '',
    usageBrakePercent: String(config.usageBrakePercent),
    notifyUserId: config.notifyUserId,
    engine: config.engine || 'sous',
  };
}

/** The JSON the server validates. Numbers that are not numbers go through as they are, so the server names the wrong field. */
export function configFromForm(form: CronForm): string {
  const number = (text: string) => (text.trim() === '' || Number.isNaN(Number(text)) ? text : Number(text));
  return JSON.stringify({
    enabled: form.enabled,
    machine: form.machine,
    parallel: number(form.parallel),
    workStart: number(form.workStart),
    workEnd: number(form.workEnd),
    workDays: [...form.workDays].sort((a, b) => a - b),
    activeFrom: form.activeFrom || null,
    activeUntil: form.activeUntil || null,
    maxPerDay: number(form.maxPerDay),
    mode: form.mode,
    sprint: form.sprint,
    labels: list(form.labels),
    todoStatuses: list(form.todoStatuses),
    inProgressStatus: form.inProgressStatus.trim(),
    model: form.model.trim() || null,
    effort: form.effort.trim() || null,
    usageBrakePercent: number(form.usageBrakePercent),
    notifyUserId: form.notifyUserId.trim(),
    engine: form.engine,
  });
}
