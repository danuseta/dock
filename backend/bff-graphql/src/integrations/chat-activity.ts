export const ACTIVITY_KINDS = ['tool', 'agent', 'skill', 'hook', 'note'] as const;
export type ActivityKind = typeof ACTIVITY_KINDS[number];
export const ACTIVITY_STATUSES = ['running', 'ok', 'error', 'denied', 'stopped'] as const;
export type ActivityStatus = typeof ACTIVITY_STATUSES[number];

export const ACTIVITY_VERSION = 1;
export const MAX_ACTIVITY_EVENTS = 50;
export const MAX_ACTIVITY_PER_TURN = 400;
export const MAX_ACTIVITY_EVENT_BYTES = 4096;
export const MAX_ACTIVITY_ROWS = 40000;
export const ACTIVITY_DETAIL_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const ACTIVITY_ROWS_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const ACTIVITY_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SERVER_DROPPED_ID = 'dropped-server';
export const HIDDEN_TEXT = '[hidden]';
export const ACTIVITY_LIMITS = { agent: 48, name: 64, label: 120, summary: 200, detail: 2000 } as const;
export const ACTIVITY_ID = /^[A-Za-z0-9_-]{1,80}$/;

const HIDDEN_ENV_LINES = 5;
const ENV_LINE = /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*=\S/gm;
const INLINE = /((?:pass(?:word|wd)?|secret|token|api[_-]?key|apikey|authorization|client[_-]?secret)["']?\s*[:=]\s*["']?)([^\s"',;}\\]{6,})/gi;
const BLOCKS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\b(?:sk|pk|rk|xi)[_-][A-Za-z0-9_-]{12,}/g,
  /\bapikey_[A-Za-z0-9_-]{8,}/gi,
  /\bdock_ing_[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
];

/** The second masking pass: runs on every text the server stores, whatever the bridge already did. */
export function maskActivityText(value: string): string {
  if ((value.match(ENV_LINE) ?? []).length >= HIDDEN_ENV_LINES) return HIDDEN_TEXT;
  let out = value;
  for (const pattern of BLOCKS) out = out.replace(pattern, '***');
  return out.replace(INLINE, (_match, head: string) => `${head}***`);
}

export function activityText(value: unknown, max: number, singleLine = false): string {
  if (typeof value !== 'string') return '';
  const masked = maskActivityText(value.slice(0, max * 2));
  return (singleLine ? masked.replace(/\s+/g, ' ') : masked).trim().slice(0, max);
}

export interface ActivityEvent {
  eventId: string;
  parentId: string | null;
  kind: ActivityKind;
  agent: string;
  name: string;
  label: string;
  summary: string;
  detail: string | null;
  status: ActivityStatus;
  startedAt: Date;
  endedAt: Date | null;
}

/** An event over 4 KB loses detail first; the other fields are already short. */
export function fitActivityEvent(event: ActivityEvent): ActivityEvent {
  const size = () => Buffer.byteLength(JSON.stringify(event));
  let over = size() - MAX_ACTIVITY_EVENT_BYTES;
  if (over > 0 && event.detail) {
    event = { ...event, detail: event.detail.slice(0, Math.max(0, event.detail.length - over * 2)) || null };
    over = size() - MAX_ACTIVITY_EVENT_BYTES;
  }
  return over > 0 ? { ...event, detail: null, summary: event.summary.slice(0, 80) } : event;
}

interface ActivityRow {
  id: number;
  sessionId: string;
  turnId: number;
  eventId: string;
  parentId: string | null;
  kind: string;
  agent: string;
  name: string;
  label: string;
  summary: string;
  status: string;
  seq: number;
  startedAt: Date;
  endedAt: Date | null;
}

export function toActivity(row: ActivityRow & { hasDetail: boolean }) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    eventId: row.eventId,
    parentId: row.parentId,
    kind: row.kind,
    agent: row.agent,
    name: row.name,
    label: row.label,
    summary: row.summary,
    status: row.status,
    hasDetail: row.hasDetail,
    seq: row.seq,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
