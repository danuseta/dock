import type { BadgeVariant } from '../components/ui';
import type { SprintResult, SprintSummary, SprintTrend, Tone } from './types';

export const fmt = (n: number): string => String(Math.round(n * 100) / 100);
export const fmt0 = (n: number): string => (n ? fmt(n) : '');
export const roundHalfEven = (value: number): number => {
  const floor = Math.floor(value);
  if (Math.abs(value - floor - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
};
export const pct = (x: number): string => `${roundHalfEven(x * 100)}%`;

const TONE_VARIANT: Record<Tone, BadgeVariant> = { g: 'success', a: 'warn', r: 'danger' };
export const toneVariant = (tone: Tone): BadgeVariant => TONE_VARIANT[tone];

export function parseResult(json: string | null | undefined): SprintResult | null {
  if (!json) return null;
  try { return JSON.parse(json) as SprintResult; } catch { return null; }
}

export function parseTrend(json: string | null | undefined): SprintTrend | null {
  if (!json) return null;
  try { return JSON.parse(json) as SprintTrend; } catch { return null; }
}

export function formatUpdated(iso: string | null): string {
  if (!iso) return 'never';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta',
  }).format(new Date(iso)) + ' WIB';
}

const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(iso));

export function sprintOptionLabel(sprint: SprintSummary): string {
  const suffix = sprint.state === 'active' ? ' (active)' : '';
  return `${sprint.name} · ${dayLabel(sprint.startDate)} – ${dayLabel(sprint.endDate)}${suffix}`;
}

export const PALETTE = ['#0B7285', '#185FA5', '#BA7517', '#C2410C', '#534AB7', '#A32D2D', '#2F855A', '#B83280'];

export interface TrendGeometry { width: number; height: number; left: number; right: number; top: number; bottom: number }

export function trendX(index: number, count: number, g: TrendGeometry): number {
  const span = g.width - g.left - g.right;
  return count <= 1 ? g.left + span / 2 : g.left + (span * index) / (count - 1);
}

export function trendY(value: number, g: TrendGeometry): number {
  const span = g.height - g.top - g.bottom;
  return g.top + span * (1 - Math.min(Math.max(value, 0), 100) / 100);
}

export function trendPath(data: Array<number | null>, g: TrendGeometry): string {
  const points: Array<[number, number]> = [];
  data.forEach((value, index) => { if (value !== null) points.push([trendX(index, data.length, g), trendY(value, g)]); });
  return points.map(([x, y], k) => {
    if (k === 0) return `M${x.toFixed(1)},${y.toFixed(1)}`;
    const [px, py] = points[k - 1];
    const bend = (x - px) * 0.4;
    return `C${(px + bend).toFixed(1)},${py.toFixed(1)} ${(x - bend).toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function nearestIndex(x: number, count: number, g: TrendGeometry): number {
  if (count <= 1) return 0;
  const step = (g.width - g.left - g.right) / (count - 1);
  return Math.min(count - 1, Math.max(0, Math.round((x - g.left) / step)));
}
