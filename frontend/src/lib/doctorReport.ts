export interface DoctorCheck { name: string; ok: boolean; detail?: string | null }
export interface DoctorReport {
  machine: string;
  host: string;
  os: string;
  at: string;
  receivedAt: string;
  kitVersion?: string | null;
  checks: DoctorCheck[];
}

/** A report older than this asks for a new `doctor.cjs --push`. */
export const STALE_HOURS = 24;

const GROUPS: Array<{ name: string; checks: string[] }> = [
  { name: 'Tools', checks: ['rtk', 'ffmpeg', 'ffprobe', 'node', 'python'] },
  { name: 'DOCK', checks: ['dock-config', 'passEnv', 'hooks', 's3-demo'] },
  { name: 'Browser', checks: ['playwright', 'chromium'] },
];

/** The checks in their groups, in doctor.cjs order; a check no group names goes to Other. */
export function groupChecks(checks: DoctorCheck[]): Array<{ name: string; checks: DoctorCheck[] }> {
  const known = new Set(GROUPS.flatMap((group) => group.checks));
  return [
    ...GROUPS.map((group) => ({ name: group.name, checks: checks.filter((check) => group.checks.includes(check.name)) })),
    { name: 'Other', checks: checks.filter((check) => !known.has(check.name)) },
  ].filter((group) => group.checks.length > 0);
}

export const isStale = (at: string, now = Date.now()) => now - new Date(at).getTime() > STALE_HOURS * 3600 * 1000;

/** The workspace's own report: the Health page lives on the workspace DOCK only. */
export const workspaceReport = (reports: DoctorReport[]) => reports.find((report) => report.machine === 'workspace') ?? null;
