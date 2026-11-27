import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle2, XCircle, ExternalLink, FlaskConical, Loader2, MessageSquare, Play, RotateCcw, Send } from 'lucide-react';
import { QA_RUN_AGAIN, QA_SEND_FIX } from '../graphql/mutations';
import { GET_QA_LOCAL_RUNS } from '../graphql/queries';
import { Badge, Button, Card, ConfirmDialog, PhoneCards } from './ui';
import { cn } from '../lib/cn';
import { shortTc, verdictVariant, qaVideoUrl } from '../chat/qa';
import {
  MAX_FIX_ROUNDS, canRunAgain, canSendFix, fixPastLimit, formatMinutes, matchesFilter, qaLocalSummary, runMinutes,
  type QaLocalFilter, type QaLocalRow, type QaLocalRuns,
} from '../lib/qaLocalRuns';

const RUNNING_POLL_MS = 15000;
const IDLE_POLL_MS = 60000;
const FILTERS: Array<{ id: QaLocalFilter; label: string }> = [{ id: 'all', label: 'All' }, { id: 'running', label: 'Running' }, { id: 'action', label: 'Needs action' }, { id: 'lolos', label: 'Lolos' }];

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');

const StatusCell: React.FC<{ row: QaLocalRow }> = ({ row }) => {
  const { run } = row;
  if (run.state === 'running') {
    return (
      <div>
        <Badge variant="accent" className="gap-1"><Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Running</Badge>
        <ol className="mt-1.5 flex flex-wrap gap-1" aria-label="QA steps">
          {run.steps.map((step) => (
            <li key={step.id} className={cn('rounded-xs px-1.5 py-0.5 text-[0.68rem]', step.state === 'running' ? 'bg-accent/15 text-accent' : step.state === 'done' ? 'bg-surface-2 text-status-merged' : step.state === 'failed' ? 'bg-surface-2 text-status-conflict' : 'bg-surface-2 text-muted-foreground')}>{step.label}</li>
          ))}
        </ol>
      </div>
    );
  }
  if (run.state === 'failed') return <div><Badge variant="danger">Failed</Badge>{run.error && <p className="mt-1 max-w-[220px] truncate text-[0.7rem] text-status-conflict" title={run.error}>{run.error}</p>}</div>;
  return <Badge>Done</Badge>;
};

const TestCases: React.FC<{ run: QaLocalRow['run'] }> = ({ run }) => {
  const total = run.testCases.length;
  if (!total) return <span className="text-xs text-muted-foreground">No test case ran</span>;
  const pct = (value: number) => `${(value / total) * 100}%`;
  return (
    <div>
      <span className="text-[0.8rem] tabular-nums">
        {run.failed || run.blocked ? <>{run.passed} passed{run.failed ? <> · <span className="text-status-conflict">{run.failed} failed</span></> : null}{run.blocked ? ` · ${run.blocked} blocked` : ''}</> : `${run.passed} / ${total} passed`}
      </span>
      <div className="mt-1 flex h-1.5 w-36 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
        <i className="block h-full bg-status-merged" style={{ width: pct(run.passed) }} />
        <i className="block h-full bg-status-conflict" style={{ width: pct(run.failed) }} />
        <i className="block h-full bg-secondary-foreground/40" style={{ width: pct(run.blocked) }} />
      </div>
    </div>
  );
};

/**
 * Local QA runs on this DOCK, under the QA bot's queue: the newest run of every ticket not yet RFP or Done, with Run again
 * (a new QA session) and Send fix (the ticket's Task session). Hidden where qonflo-qa-local is not installed.
 */
export const QaLocalRunsSection: React.FC<{ onTicketClick: (key: string) => void }> = ({ onTicketClick }) => {
  const [pollInterval, setPollInterval] = useState(IDLE_POLL_MS);
  const { data, error } = useQuery<{ qaLocalRuns: QaLocalRuns }>(GET_QA_LOCAL_RUNS, { pollInterval, fetchPolicy: 'cache-and-network' });
  const anyRunning = Boolean(data?.qaLocalRuns.rows.some((row) => row.run.state === 'running'));
  useEffect(() => { setPollInterval(anyRunning ? RUNNING_POLL_MS : IDLE_POLL_MS); }, [anyRunning]);
  const [runAgain] = useMutation(QA_RUN_AGAIN, { refetchQueries: ['GetQaLocalRuns'] });
  const [sendFix] = useMutation(QA_SEND_FIX, { refetchQueries: ['GetQaLocalRuns'] });
  const [filter, setFilter] = useState<QaLocalFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmFix, setConfirmFix] = useState<QaLocalRow | null>(null);

  const qa = data?.qaLocalRuns;
  if (!qa?.available) return null;
  const summary = qaLocalSummary(qa.rows);
  const rows = qa.rows.filter((row) => matchesFilter(row, filter));
  const counts: Record<QaLocalFilter, number> = Object.fromEntries(FILTERS.map((item) => [item.id, qa.rows.filter((row) => matchesFilter(row, item.id)).length])) as Record<QaLocalFilter, number>;

  const act = async (row: QaLocalRow, kind: 'again' | 'fix', force = false) => {
    setBusy(`${kind}:${row.key}`);
    setNotice(null);
    try {
      if (kind === 'again') await runAgain({ variables: { ticketKey: row.key } });
      else await sendFix({ variables: { ticketKey: row.key, force } });
      setNotice({ tone: 'ok', text: kind === 'again' ? `${row.key}: a new QA session started` : `${row.key}: the failed test cases went to the Task session` });
    } catch (failure) {
      setNotice({ tone: 'error', text: `${row.key}: ${failure instanceof Error ? failure.message : 'it did not go through'}` });
    } finally {
      setBusy(null);
    }
  };
  const fix = (row: QaLocalRow) => (fixPastLimit(row) ? setConfirmFix(row) : void act(row, 'fix'));

  const cards = [
    { label: 'Running now', value: summary.running, tone: 'text-accent' },
    { label: 'LOLOS', value: summary.lolos, tone: 'text-status-merged' },
    { label: 'REVISION', value: summary.revision, tone: 'text-status-conflict' },
    { label: 'ESCALATED', value: summary.escalated, tone: 'text-status-warn' },
    { label: 'Median run time', value: formatMinutes(summary.medianMinutes), tone: '' },
  ];

  return (
    <section className="mt-10" aria-label="QA local">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-2xl font-black"><FlaskConical size={20} aria-hidden="true" />QA local</h2>
          <p className="mt-1 text-pretty text-sm text-secondary-foreground">Runs of qonflo-qa-local on this DOCK, newest run per ticket. Live while a run is going.</p>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
        {cards.map((item) => <Card key={item.label}><strong className={cn('font-display text-3xl tabular-nums', item.tone)}>{item.value}</strong><div className="text-xs text-muted-foreground">{item.label}</div></Card>)}
      </div>
      {error && <Card className="mb-3 border-status-conflict text-sm text-status-conflict" role="alert">{error.message}</Card>}
      {notice && <p className={cn('mb-3 text-sm', notice.tone === 'ok' ? 'text-status-merged' : 'text-status-conflict')} role="status">{notice.text}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <Button key={item.id} size="sm" variant={filter === item.id ? 'primary' : 'default'} className="rounded-pill" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
            {item.label}<span className="ml-1 font-mono text-xs tabular-nums opacity-70">{counts[item.id]}</span>
          </Button>
        ))}
        {qa.hidden > 0 && <span className="text-xs text-muted-foreground">RFP and Done tickets hidden ({qa.hidden})</span>}
      </div>
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No QA local run{filter === 'all' ? '' : ' in this filter'}.</p> : (
          <PhoneCards>
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-1 text-xs text-muted-foreground">
                <tr><th className="px-4 py-3 font-medium">Ticket</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Test cases</th><th className="px-4 py-3 font-medium">Verdict</th><th className="px-4 py-3 font-medium">Fix round</th><th className="px-4 py-3 font-medium">Started</th><th className="px-4 py-3 font-medium">Took</th><th className="px-4 py-3 font-medium" /></tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const expanded = open === row.key;
                  const minutes = runMinutes(row.run);
                  const failing = row.run.testCases.filter((tc) => tc.state === 'failed' || tc.state === 'blocked');
                  return (
                    <React.Fragment key={row.key}>
                      <tr className="border-t border-border align-middle">
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => onTicketClick(row.key)} className="font-mono text-xs font-bold text-accent hover:underline max-[760px]:min-h-11">{row.key}</button>
                          {row.title && <p className="max-w-[300px] truncate text-[0.8rem] text-secondary-foreground" title={row.title}>{row.title}</p>}
                        </td>
                        <td className="px-4 py-3"><StatusCell row={row} /></td>
                        <td className="px-4 py-3"><TestCases run={row.run} /></td>
                        <td className="px-4 py-3">{row.run.state === 'done' && row.run.verdict ? <Badge variant={verdictVariant(row.run.verdict)}>{row.run.verdict}</Badge> : <span className="text-muted-foreground">-</span>}</td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">{row.fixRound} / {MAX_FIX_ROUNDS}{row.fixSent && <span className="ml-1 text-status-merged">fix sent</span>}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums">{time(row.run.startedAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums">{formatMinutes(minutes)}{row.run.state === 'running' ? ' so far' : ''}</td>
                        <td className="px-4 py-3 text-right">
                          <Button size="icon" variant="ghost" aria-expanded={expanded} aria-label={expanded ? `Hide ${row.key} details` : `Show ${row.key} details`} onClick={() => setOpen(expanded ? null : row.key)}>
                            {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                          </Button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t border-border bg-surface-1">
                          <td colSpan={8} className="px-4 py-3">
                            <p className="font-mono text-[0.72rem] text-muted-foreground">run {row.run.runId} · {row.runs} {row.runs === 1 ? 'run' : 'runs'} for this ticket{row.jiraStatus ? ` · Jira ${row.jiraStatus}` : ''}</p>
                            {failing.length > 0 && (
                              <ul className="mt-2 flex flex-col gap-1">
                                {failing.map((tc) => (
                                  <li key={tc.id} className="flex flex-wrap items-center gap-2 text-[0.8rem] text-secondary-foreground">
                                    {tc.state === 'failed' ? <XCircle size={14} className="text-status-conflict" aria-hidden="true" /> : <AlertCircle size={14} className="text-muted-foreground" aria-hidden="true" />}
                                    <b className="font-mono text-foreground">{shortTc(tc.id)}</b>
                                    <span className="min-w-0">{tc.title}{tc.ac.length ? ` (AC ${tc.ac.join(', ')})` : ''}</span>
                                    {tc.video && <a className="inline-flex items-center gap-1 text-accent hover:underline" href={qaVideoUrl(row.key, row.run.runId, tc.video)} target="_blank" rel="noreferrer"><Play size={12} aria-hidden="true" />Video</a>}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {failing.length === 0 && row.run.state === 'done' && <p className="mt-2 flex items-center gap-1.5 text-[0.8rem] text-status-merged"><CheckCircle2 size={14} aria-hidden="true" />No failed or blocked test case</p>}
                            {row.run.rule && <p className="mt-2 text-[0.75rem] text-muted-foreground">Rule: {row.run.rule}</p>}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {canSendFix(row) && (
                                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => fix(row)}>
                                  <Send size={13} aria-hidden="true" />{busy === `fix:${row.key}` ? 'Sending...' : `Send fix (round ${row.fixRound + 1} of ${MAX_FIX_ROUNDS})`}
                                </Button>
                              )}
                              {canRunAgain(row) && (
                                <Button size="sm" disabled={busy !== null} onClick={() => void act(row, 'again')}>
                                  <RotateCcw size={13} aria-hidden="true" />{busy === `again:${row.key}` ? 'Starting...' : 'Run again'}
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => onTicketClick(row.key)}><ExternalLink size={13} aria-hidden="true" />Open ticket</Button>
                              {row.sessionId && <a className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs text-secondary-foreground hover:text-foreground" href={`/sessions?session=${encodeURIComponent(row.sessionId)}`}><MessageSquare size={13} aria-hidden="true" />Open QA session</a>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </PhoneCards>
        )}
      </Card>
      <p className="mt-3 text-pretty text-xs text-muted-foreground">Running first, then newest started. Run again opens a new QA session and keeps the fix rounds already used; Send fix goes to the ticket's Task session.</p>
      <ConfirmDialog
        open={confirmFix !== null}
        title={`Send fix for ${confirmFix?.key ?? ''}?`}
        description={`This adds a fix round past the limit of ${MAX_FIX_ROUNDS}: the failed test cases go to the Task session once more.`}
        confirmLabel="Send fix"
        busyLabel="Sending..."
        busy={busy?.startsWith('fix:') ?? false}
        onConfirm={() => { const row = confirmFix; setConfirmFix(null); if (row) void act(row, 'fix', true); }}
        onCancel={() => setConfirmFix(null)}
      />
    </section>
  );
};
