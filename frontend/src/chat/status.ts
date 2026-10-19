export interface ChatLimit { usedPercentage: number; resetsAt?: string | null }

export interface ChatLimits {
  fiveHour?: ChatLimit | null;
  sevenDay?: ChatLimit | null;
  receivedAt: string;
  stale: boolean;
}

export interface ChatFileChange { path: string; added: number; removed: number }

export interface ChatSessionStatus {
  sessionId: string;
  model?: string | null;
  effort?: string | null;
  fastMode?: boolean | null;
  contextPercentage?: number | null;
  contextTokens?: number | null;
  contextSize?: number | null;
  costUsd?: number | null;
  cacheWarm?: boolean | null;
  cacheHitRatio?: number | null;
  files?: ChatFileChange[];
  receivedAt: string;
  stale: boolean;
}

export interface ChatStatus { limits?: ChatLimits | null; sessions: ChatSessionStatus[] }

export type LimitTone = 'ok' | 'warn' | 'danger';

export const limitTone = (percentage: number): LimitTone => (percentage < 40 ? 'ok' : percentage <= 70 ? 'warn' : 'danger');

export const toneClass: Record<LimitTone, string> = {
  ok: 'text-status-merged',
  warn: 'text-amber-200',
  danger: 'text-status-conflict',
};

export function formatTokens(count: number): string {
  if (count >= 1e6) return `${(count / 1e6).toFixed(count % 1e6 === 0 ? 0 : 1)}M`;
  if (count >= 1e3) return `${Math.round(count / 1e3)}k`;
  return String(Math.round(count));
}

export function resetsIn(resetsAt: string, now: number): string {
  const minutes = Math.round((Date.parse(resetsAt) - now) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes <= 0) return 'reset due';
  if (minutes < 60) return `resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `resets in ${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
  return `resets in ${Math.round(hours / 24)} d`;
}

export function contextText(status: ChatSessionStatus): string | null {
  if (status.contextPercentage == null) return null;
  const detail = status.contextTokens != null && status.contextSize != null ? ` ${formatTokens(status.contextTokens)}/${formatTokens(status.contextSize)}` : '';
  return `ctx ${Math.round(status.contextPercentage)}%${detail}`;
}

