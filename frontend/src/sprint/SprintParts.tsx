import type { ReactNode } from 'react';
import { Badge, Card, PhoneCards } from '../components/ui';
import { cn } from '../lib/cn';
import { toneVariant } from './format';
import type { IssueRef, Tone } from './types';

export const SectionCard = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
  <section className="mb-6">
    <h2 className="font-display text-xl font-bold">{title}</h2>
    {sub && <p className="mt-1 mb-3 max-w-[980px] text-pretty text-sm text-muted-foreground">{sub}</p>}
    <Card className="overflow-x-auto p-0">{children}</Card>
  </section>
);

export const Table = ({ head, children, minWidth = 720 }: { head: Array<{ label: string; numeric?: boolean }>; children: ReactNode; minWidth?: number }) => (
  <PhoneCards>
  <table className="w-full border-collapse text-left text-sm" style={{ minWidth }}>
    <thead className="bg-surface-1 text-xs text-muted-foreground">
      <tr>{head.map((column) => <th key={column.label} className={cn('px-4 py-3 font-medium', column.numeric && 'text-right')}>{column.label}</th>)}</tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
  </PhoneCards>
);

export const Tr = ({ children }: { children: ReactNode }) => <tr className="border-t border-border hover:bg-surface-1">{children}</tr>;

export const Name = ({ children }: { children: ReactNode }) => <td className="whitespace-nowrap px-4 py-3 font-display font-semibold">{children}</td>;

export const Num = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn('whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums', className)}>{children}</td>
);

export const Dash = () => <span className="text-muted-foreground">—</span>;

export const ToneBadge = ({ tone, children }: { tone: Tone; children: ReactNode }) => <Badge variant={toneVariant(tone)}>{children}</Badge>;

export const OptionalTone = ({ tone, children }: { tone: Tone | null; children: ReactNode }) => (
  tone === null ? <Dash /> : <ToneBadge tone={tone}>{children}</ToneBadge>
);

export const IssueTags = ({ issues }: { issues: IssueRef[] }) => (
  <td className="px-4 py-3 text-xs text-muted-foreground">
    {issues.length === 0 ? '—' : issues.slice(0, 3).map((issue) => (
      <span key={issue.key} className="mr-1 mb-1 inline-block rounded-xs bg-surface-2 px-2 py-0.5" title={issue.key}>
        {issue.summary.length > 55 ? `${issue.summary.slice(0, 55)}…` : issue.summary}
      </span>
    ))}
  </td>
);
