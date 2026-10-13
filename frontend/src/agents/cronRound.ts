/** What one round of the orchestrator cron did, as the server reports it. */
export interface RoundLog { at: string; skipped: string | null; started: string[]; parked: string[]; notMoved: string[]; failed: string[] }

export function roundSummary(round: RoundLog | null): string {
  if (!round) return 'No round has run yet.';
  const when = new Date(round.at).toLocaleString();
  if (round.skipped) return `${when}: skipped, ${round.skipped}.`;
  const parts = [
    `started ${round.started.join(', ') || 'nothing'}`,
    round.parked.length ? `parked ${round.parked.join(', ')}` : '',
    round.notMoved.length ? `Jira did not move ${round.notMoved.join(', ')}` : '',
    round.failed.length ? `failed ${round.failed.join(', ')}` : '',
  ].filter(Boolean);
  return `${when}: ${parts.join('; ')}.`;
}

/** The cron config as the form holds it: every field a string or a boolean, lists as comma-separated text. */
export interface CronForm {
  enabled: boolean;
  hoursWib: string;
  machine: string;
  parallel: string;
  perRound: string;
  sprint: string;
  labels: string;
  todoStatuses: string;
  inProgressStatus: string;
  model: string;
  effort: string;
  usageBrakePercent: string;
  notifyUserId: string;
}

const list = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean);

export function formFromConfig(configJson: string): CronForm {
  const config = JSON.parse(configJson);
  return {
    enabled: config.enabled,
    hoursWib: config.hoursWib.join(', '),
    machine: config.machine,
    parallel: String(config.parallel),
    perRound: String(config.perRound),
    sprint: config.sprint,
    labels: config.labels.join(', '),
    todoStatuses: config.todoStatuses.join(', '),
    inProgressStatus: config.inProgressStatus,
    model: config.model || '',
    effort: config.effort || '',
    usageBrakePercent: String(config.usageBrakePercent),
    notifyUserId: config.notifyUserId,
  };
}

/** The JSON the server validates. Numbers that are not numbers go through as they are, so the server names the wrong field. */
export function configFromForm(form: CronForm): string {
  const number = (text: string) => (text.trim() === '' || Number.isNaN(Number(text)) ? text : Number(text));
  return JSON.stringify({
    enabled: form.enabled,
    hoursWib: list(form.hoursWib).map(number),
    machine: form.machine,
    parallel: number(form.parallel),
    perRound: number(form.perRound),
    sprint: form.sprint,
    labels: list(form.labels),
    todoStatuses: list(form.todoStatuses),
    inProgressStatus: form.inProgressStatus.trim(),
    model: form.model.trim() || null,
    effort: form.effort.trim() || null,
    usageBrakePercent: number(form.usageBrakePercent),
    notifyUserId: form.notifyUserId.trim(),
  });
}
