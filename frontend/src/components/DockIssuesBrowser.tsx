import React, { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import type { Components } from 'react-markdown';
import { Bug, ExternalLink, Plus } from 'lucide-react';
import { GET_DOCK_ISSUE, GET_DOCK_ISSUES } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { ReportDockIssue } from '../components/ReportDockIssue';
import { Button, Input, Page } from '../components/ui';
import { Markdown } from '../chat/Markdown';
import { cn } from '../lib/cn';
import { ago } from '../lib/discordThreads';
import { ISSUE_FILTERS, matchesIssue, type DockIssueAuthor, type DockIssueFilter, type DockIssueSummary } from '../lib/dockIssues';
import { CACHED_QUERY_OPTIONS, DETAIL_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';

const ISSUE_MARKDOWN: Components = {
  img: ({ src, alt }) => <img src={src} alt={alt ?? ''} referrerPolicy="no-referrer" loading="lazy" className="my-2 max-w-full rounded-sm border border-border" />,
};

interface DockIssuesPageProps { onNavigate: (path: string) => void }

interface DockIssueComment { id: string; author: DockIssueAuthor; createdAt: string; body: string }

const Avatar: React.FC<{ author: DockIssueAuthor; className?: string }> = ({ author, className }) => (
  author.avatarUrl
    ? <img src={author.avatarUrl} alt="" loading="lazy" className={cn('size-6 rounded-full bg-surface-2', className)} />
    : <span className={cn('block size-6 rounded-full bg-surface-2', className)} aria-hidden="true" />
);

const StateChip: React.FC<{ state: string }> = ({ state }) => (
  <span className={cn('shrink-0 rounded-[3px] px-1.5 py-px font-mono text-[0.62rem] font-bold uppercase', state === 'open' ? 'bg-status-merged/15 text-status-merged' : 'bg-surface-2 text-muted-foreground')}>{state}</span>
);

const IssueDetail: React.FC<{ number: number; onBack: () => void }> = ({ number, onBack }) => {
  const { data, loading, error } = useQuery(GET_DOCK_ISSUE, { ...DETAIL_QUERY_OPTIONS, variables: { number } });
  const issue = data?.dockIssue;
  const now = new Date();
  return (
    <section className="flex min-w-0 flex-col" aria-label="Issue">
      <button type="button" onClick={onBack} className="mx-5 mt-3 hidden min-h-11 self-start border-0 bg-transparent p-0 text-xs text-secondary-foreground max-[960px]:block">‹ DOCK Issues</button>
      {isInitialQueryLoading(loading, data) && <p className="px-5 py-6 text-sm text-muted-foreground" role="status">Loading issue...</p>}
      {error && !issue && <p className="px-5 py-6 text-sm text-status-conflict" role="alert">{error.message}</p>}
      {!loading && !error && !issue && <p className="px-5 py-6 text-sm text-muted-foreground">Issue not found</p>}
      {issue && (
        <>
          <div className="border-b border-border px-5 py-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">#{issue.number}</span>
              <StateChip state={issue.state} />
            </div>
            <h2 className="mb-3 font-display text-lg leading-snug font-bold">{issue.title}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Avatar author={issue.author} />{issue.author.login}</span>
              <span>opened {ago(issue.createdAt, now)} ago</span>
              <a href={issue.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink size={13} aria-hidden="true" />Open on GitHub</a>
            </div>
          </div>
          <div className="px-5 py-4 text-[0.82rem] leading-relaxed break-words text-secondary-foreground">
            {issue.body.trim() ? <Markdown text={issue.body} overrides={ISSUE_MARKDOWN} /> : <p className="text-muted-foreground">No description.</p>}
          </div>
          <div className="border-t border-border px-5 py-3">
            <h3 className="mb-2 font-display text-sm font-bold">Comments ({issue.commentList.length})</h3>
            {issue.commentList.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
            {issue.commentList.map((comment: DockIssueComment) => (
              <div key={comment.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 border-t border-border py-3 first:border-t-0">
                <Avatar author={comment.author} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{comment.author.login}<span className="ml-2 font-normal text-muted-foreground">{ago(comment.createdAt, now)} ago</span></p>
                  <div className="mt-1 text-[0.8rem] leading-relaxed break-words text-secondary-foreground"><Markdown text={comment.body} overrides={ISSUE_MARKDOWN} /></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

/** The issues of the DOCK repo: a list on the left, the open issue on the right. Reading only; the owner resolves them on GitHub. */
const DockIssuesPage: React.FC<DockIssuesPageProps> = ({ onNavigate }) => {
  const [filter, setFilter] = useState<DockIssueFilter>('OPEN');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [reporting, setReporting] = useState(false);
  const { data, loading, error } = useQuery(GET_DOCK_ISSUES, { ...CACHED_QUERY_OPTIONS, variables: { filter } });
  const feed = data?.dockIssues;
  const issues: DockIssueSummary[] = useMemo(() => (feed?.issues ?? []).filter((issue: DockIssueSummary) => matchesIssue(issue, query)), [feed, query]);
  const now = new Date();

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  return (
    <Page width="full">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">DOCK Issues</h1>
          <p className="mt-1 text-xs text-muted-foreground">Bugs reported on DOCK itself. The owner resolves them on GitHub.</p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setReporting(true)}><Plus size={14} aria-hidden="true" />New issue</Button>
      </header>

      {feed?.tokenMissing && (
        <p className="mb-4 rounded-sm border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-xs text-status-warn" role="status">
          Add a GitHub token in Settings to post from DOCK. <button type="button" className="border-0 bg-transparent p-0 text-status-warn underline" onClick={() => onNavigate('/settings')}>Open Settings</button>
        </p>
      )}
      {error && !feed && <p className="mb-4 text-xs text-status-conflict" role="alert">{error.message}</p>}

      <div className="grid min-h-[640px] grid-cols-[400px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-background max-[960px]:grid-cols-1">
        <section className={cn('flex min-w-0 flex-col border-r border-border max-[960px]:border-r-0', picked !== null && 'max-[960px]:hidden')} aria-label="Issues">
          <div className="border-b border-border px-4 py-2.5">
            <Input type="search" aria-label="Search issues" className="h-8 text-xs max-[760px]:h-11" placeholder="Search title or #number" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="flex gap-4 overflow-x-auto border-b border-border px-4" role="tablist" aria-label="Issue filter">
            {ISSUE_FILTERS.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={filter === entry.id} onClick={() => { setFilter(entry.id); setPicked(null); }} className={cn('min-h-11 whitespace-nowrap border-0 border-b-2 bg-transparent px-0 pt-2 text-xs font-medium', filter === entry.id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{entry.label}</button>
            ))}
          </div>
          <div className="max-h-[calc(100dvh-15rem)] min-h-[320px] flex-1 overflow-y-auto max-[960px]:max-h-none">
            {issues.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground" role="status">
                {feed?.tokenMissing ? 'Issues need a GitHub token.' : query.trim() ? 'No issue matches.' : filter === 'MINE' ? 'You have not reported an issue yet.' : 'No issues here.'}
              </p>
            )}
            {issues.map((issue) => (
              <button key={issue.number} type="button" onClick={() => setPicked(issue.number)} aria-current={picked === issue.number ? 'true' : undefined} className={cn('grid w-full grid-cols-[24px_minmax(0,1fr)_auto] gap-2.5 border-0 border-b border-border bg-transparent px-4 py-3 text-left hover:bg-surface-1', picked === issue.number && 'bg-surface-1')}>
                <Avatar author={issue.author} />
                <span className="min-w-0">
                  <span className="block truncate text-[0.8rem] font-semibold">{issue.title}</span>
                  <span className="mt-0.5 block text-[0.66rem] text-muted-foreground"><span className="font-mono">#{issue.number}</span> · {issue.author.login} · {ago(issue.updatedAt, now)} ago{issue.comments > 0 ? ` · ${issue.comments} ${issue.comments === 1 ? 'comment' : 'comments'}` : ''}</span>
                </span>
                <StateChip state={issue.state} />
              </button>
            ))}
          </div>
        </section>
        {picked !== null
          ? <IssueDetail key={picked} number={picked} onBack={() => setPicked(null)} />
          : (
            <section className="grid min-h-[320px] place-items-center p-6 text-center max-[960px]:hidden" aria-label="Issue">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Bug size={28} aria-hidden="true" />
                <p className="text-sm">Pick an issue to read it.</p>
              </div>
            </section>
          )}
      </div>
      <ReportDockIssue open={reporting} onClose={() => setReporting(false)} onNavigate={onNavigate} />
    </Page>
  );
};

export default DockIssuesPage;
