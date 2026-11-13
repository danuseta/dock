import React, { useState } from 'react';
import { useQuery } from '@apollo/client';
import { FlaskConical, Link2, RefreshCw } from 'lucide-react';
import { GET_QA_QUEUE } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Badge, Button, Card, Checkbox, Page, PageHeader, PhoneCards } from '../components/ui';
import { cn } from '../lib/cn';
import { EVERYONE, QA_QUEUE_REFRESH_MS, filterQueue, formatWait, moreText, peopleOf, shortName, waitText, type QaQueue, type QaQueueKind } from '../lib/qaQueue';
import { isInitialQueryLoading } from '../lib/queryPolicy';

interface QaQueuePageProps { onTicketClick: (key: string) => void }

const KIND_BADGE: Record<QaQueueKind, { label: string; variant: 'neutral' | 'warn' | 'accent' }> = {
  queue: { label: 'Antre', variant: 'neutral' },
  dependency: { label: 'QA-WAIT-DEPENDENCY', variant: 'accent' },
  escalated: { label: 'ESCALATED', variant: 'warn' },
};

/** The QA bot's queue, read only: Jira UAT CHECK plus QA-WAIT-DEPENDENCY tickets, oldest first, refreshed every minute. */
const QaQueuePage: React.FC<QaQueuePageProps> = ({ onTicketClick }) => {
  const { data, loading, error, refetch } = useQuery<{ qaQueue: QaQueue }>(GET_QA_QUEUE, { fetchPolicy: 'cache-and-network', pollInterval: QA_QUEUE_REFRESH_MS });
  const [who, setWho] = useState(EVERYONE);
  const [mine, setMine] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const queue = data?.qaQueue;

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const rows = queue?.rows ?? [];
  const people = peopleOf(rows);
  const shown = filterQueue(rows, who, mine, queue?.me ?? null);
  const metrics = queue ? [
    { label: 'Di antrean', value: `${queue.metrics.total}${moreText(queue) ? ` ${moreText(queue)}` : ''}`, tone: '' },
    { label: 'ESCALATED', value: queue.metrics.escalated, tone: 'text-status-warn' },
    { label: 'Nunggu dependency', value: queue.metrics.dependency, tone: 'text-sky-200' },
    { label: 'Rata-rata nunggu', value: formatWait(queue.metrics.averageWaitMinutes), tone: '' },
    { label: 'Paling lama', value: formatWait(queue.metrics.oldestWaitMinutes), tone: '' },
  ] : [];
  const refresh = async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  };

  return (
    <Page width="full">
      <PageHeader>
        <div>
          <h1 className="text-balance font-display text-3xl font-black">QA queue</h1>
          <p className="mt-1 text-pretty text-secondary-foreground">Antrean bot QA dari Jira: tiket di UAT CHECK plus yang dikasih QA-WAIT-DEPENDENCY. Diperbarui tiap 60 detik.</p>
        </div>
        <Button onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />{refreshing ? 'Checking...' : 'Check now'}</Button>
      </PageHeader>

      <section className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3" aria-label="Ringkasan antrean">
        {metrics.map((item) => <Card key={item.label}><strong className={cn('font-display text-3xl tabular-nums', item.tone)}>{item.value}</strong><div className="text-xs text-muted-foreground">{item.label}</div></Card>)}
      </section>

      {(error || queue?.error) && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{queue?.error ? `Jira nggak kebaca, ini antrean terakhir yang kesimpen: ${queue.error}` : error?.message}</Card>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[{ name: EVERYONE, count: rows.length }, ...people].map((person) => (
          <Button key={person.name} size="sm" variant={person.name === who ? 'primary' : 'default'} className="rounded-pill" aria-pressed={person.name === who} onClick={() => setWho(person.name)}>
            {person.name}<span className="ml-1 font-mono text-xs tabular-nums opacity-70">{person.count}</span>
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-secondary-foreground"><Checkbox checked={mine} disabled={!queue?.me} onChange={(event) => setMine(event.target.checked)} />Punya saya</label>
      </div>

      <Card className="overflow-hidden p-0">
        <PhoneCards>
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead className="bg-surface-1 text-xs text-muted-foreground">
              <tr><th className="px-4 py-3 font-medium">#</th><th className="px-4 py-3 font-medium">Ticket</th><th className="px-4 py-3 font-medium">Assignee</th><th className="px-4 py-3 font-medium">Nunggu</th><th className="px-4 py-3 font-medium">Label QA</th><th className="px-4 py-3 font-medium" /></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground"><FlaskConical size={28} className="mx-auto mb-2 text-muted-foreground" aria-hidden="true" />{rows.length ? `Nggak ada tiket ${mine ? 'kamu' : who} di antrean.` : 'Antrean QA kosong.'}</td></tr>}
              {shown.map((row) => {
                const badge = KIND_BADGE[row.kind];
                const own = Boolean(queue?.me && row.assignee?.trim().toLowerCase() === queue.me.trim().toLowerCase());
                return (
                  <tr key={row.key} className={cn('border-t border-border hover:bg-surface-1', row.kind === 'dependency' && 'bg-sky-300/[0.03]')}>
                    <td className="px-4 py-3 font-mono text-xs font-bold tabular-nums text-secondary-foreground">{row.position}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => onTicketClick(row.key)} className="font-mono text-xs font-bold text-accent hover:underline max-[760px]:min-h-11">{row.key}</button>
                      <p className="max-w-[420px] truncate text-[0.8rem] text-secondary-foreground" title={row.summary}>{row.summary}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[0.8rem]" title={row.assignee ?? undefined}>{shortName(row.assignee)}</td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums" title={row.enteredAt ? `Masuk UAT CHECK ${new Date(row.enteredAt).toLocaleString('en-GB')}` : undefined}>{formatWait(row.waitingMinutes)}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {row.kind === 'dependency' && <span className="inline-flex items-center gap-1 rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.68rem] font-semibold text-sky-200" title="Dari link is blocked by. Bot QA ngetes otomatis begitu tiket itu masuk UAT CHECK."><Link2 size={11} aria-hidden="true" />{waitText(row)}</span>}
                        {row.labels.filter((label) => label !== badge.label).map((label) => <Badge key={label}>{label}</Badge>)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{own && <Badge variant="accent">punya saya</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhoneCards>
      </Card>
      {queue && moreText(queue) && <p className="mt-3 text-pretty text-xs text-status-warn" role="status">Cuma 500 tiket pertama yang dibaca dari Jira, {moreText(queue)} nggak ditampilin.</p>}
      <p className="mt-3 text-pretty text-xs text-muted-foreground">Urut dari waktu masuk UAT CHECK. "Nunggu QRD-x" muncul kalau bot QA kasih label QA-WAIT-DEPENDENCY, dari link is blocked by; dihitung terpisah dari ESCALATED.</p>
    </Page>
  );
};

export default QaQueuePage;
