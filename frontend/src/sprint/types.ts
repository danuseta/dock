export type Tone = 'g' | 'a' | 'r';
export type Bucket = 'Todo' | 'InP' | 'PR' | 'UATM' | 'UATC' | 'UATB' | 'RFP' | 'Done';
export type StageName = 'In Progress' | 'PR Review' | 'UAT Merged' | 'UAT Check' | 'RFP';

export interface IssueRef { key: string; summary: string }

export interface StartRow { dev: string; buckets: Record<Bucket, number>; total: number; load: number; loadTone: Tone }
export interface EndRow {
  dev: string; buckets: Record<Bucket, number>; total: number; eligSP: number; compSP: number;
  completion: number | null; completionTone: Tone | null; carryover: number;
  inDev: number; review: number; velocity: number | null; velocityTone: Tone | null;
}
export interface GateRow {
  dev: string; passed: number; reworked: number; pending: number;
  rate: number | null; rateTone: Tone | null; challenging: IssueRef[];
}
export interface ReviewerRow {
  dev: string; issues: number; sp: number; failedSP: number;
  failRate: number | null; failTone: Tone | null; bounced: IssueRef[];
  avg: number | null; avgTone: Tone | null; max: number | null; breaches: number;
}
export interface StageRow { dev: string; stages: Record<StageName, { value: number; tone: Tone } | null> }
export interface Flag { sev: 'R' | 'A' | 'B'; dev: string; metric: string; desc: string }
export interface ExcludedIssue {
  key: string; summary: string; assignee: string | null; status: string; sp: number | null;
  reason: 'removed-from-sprint' | 'not-in-roster' | 'unknown-status';
}

export interface SprintResult {
  sprint: { id: number; name: string; label: string; num: number; state: string; start: string; end: string };
  cutoff: string;
  overview: {
    developers: number; totalSP: number; allocated: number; carryover: number; bugSP: number; doneSP: number;
    targetSP: number; bugMargin: number; loadTarget: number;
    pipeline: { inDev: number; uatMerged: number; uatCheckRfp: number; uatBug: number; done: number };
  };
  start: StartRow[];
  end: EndRow[];
  pr: GateRow[];
  qa: GateRow[];
  reviewers: ReviewerRow[];
  unattributedSP: number;
  teamAvgSPReviewed: number | null;
  stages: StageRow[];
  flags: Flag[];
  notes: {
    addedAfterStart: number;
    noSprintEvents: number;
    spChanges: Array<{ key: string; from: number; to: number | null }>;
    assigneeChanges: Array<{ key: string; now: string | null }>;
    nonSelfPass: Array<{ key: string; token: string; by: string | null }>;
    prePassIgnored: number;
    passWithoutDuration: number;
    revertedToUatMerged: number;
    earlyPushBacks: string[];
    aliasHits: Array<{ status: string; count: number; keys: string[] }>;
    excluded: ExcludedIssue[];
  };
}

export interface SprintTrend {
  labels: string[];
  series: Array<{ dev: string; color: string | null; data: Array<number | null> }>;
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

export interface RefreshState {
  status: 'idle' | 'running' | 'error';
  label: string;
  done: number;
  total: number;
  error: string | null;
}
