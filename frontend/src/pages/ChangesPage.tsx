import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useApolloClient, useQuery } from '@apollo/client';
import { ArrowLeft, ChevronDown, ChevronUp, Columns, ExternalLink, GitMerge, GitPullRequest, ListTree, Rows } from 'lucide-react';
import { GET_PULL_FILE_PATCH, GET_TICKET_CHANGES } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button, Checkbox, Dialog, IconButton, Page } from '../components/ui';
import { cn } from '../lib/cn';
import { wib } from '../lib/discordThreads';
import { DiffFile, type ChangeFile } from '../changes/DiffFile';
import { FileTree } from '../changes/FileTree';
import { FindingCard } from '../changes/FindingCard';
import { GENERAL, anchorFindings, type Anchor, type ChangesFinding } from '../changes/findings';
import { LONG_FILE_LINES, parsePatch } from '../changes/patch';
import { isViewed, patchHash, readView, readViewed, writeView, writeViewed, type DiffView } from '../changes/prefs';

interface ChangesPageProps { onNavigate: (path: string) => void; onTicketClick: (key: string) => void }

interface Pull {
  url: string; owner: string; repo: string; number: number; tab: string; title: string; state: string; author: string | null;
  headRef: string; baseRef: string; headSha: string; headDate: string | null; additions: number; deletions: number; changedFiles: number;
  partial: boolean; stale: boolean; retryAt: string | null; error: string | null; files: ChangeFile[] | null;
}
interface Review { runKey: string; verdict: string | null; roundsUsed: number | null; roundsMax: number | null; updatedAt: string; findings: ChangesFinding[] }

const PHONE = '(max-width: 759px)';
const subscribePhone = (onChange: () => void) => {
  const media = window.matchMedia(PHONE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches);

const STATE_STYLE: Record<string, string> = {
  open: 'bg-status-open-bg text-status-open',
  draft: 'bg-status-draft-bg text-status-draft',
  merged: 'bg-status-merged-bg text-status-merged',
  closed: 'bg-status-conflict-bg text-status-conflict',
};
const STATE_LABEL: Record<string, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };

const FROM: Record<string, string> = { agents: 'Agents', board: 'Board', discord: 'Discord' };

const ERROR_TEXT: Record<string, string> = {
  NO_ACCESS: 'The GitHub token in Settings cannot read this repository.',
  NOT_FOUND: 'GitHub has no such pull request.',
  RATE_LIMITED: 'GitHub rate limit reached and nothing is kept for this pull request yet.',
  UNAVAILABLE: 'GitHub could not be reached.',
};

const params = () => new URLSearchParams(window.location.search);

const scrolls = (node: HTMLElement) => node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(getComputedStyle(node).overflowY);

/** Scrolls only the page's own scroll area to the element, so the app frame around it stays put. */
function reveal(id: string, smooth = true) {
  const element = document.getElementById(id);
  if (!element) return;
  let box = element.parentElement;
  while (box && !scrolls(box)) box = box.parentElement;
  const area = box ?? (document.scrollingElement as HTMLElement);
  const top = area.scrollTop + element.getBoundingClientRect().top - (box ? box.getBoundingClientRect().top : 0) - 16;
  area.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

const StatePill: React.FC<{ state: string }> = ({ state }) => (
  <span className={cn('inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 font-display text-[0.7rem] font-semibold', STATE_STYLE[state] ?? 'bg-surface-2 text-secondary-foreground')}>
    {state === 'merged' ? <GitMerge size={12} aria-hidden="true" /> : <GitPullRequest size={12} aria-hidden="true" />}{STATE_LABEL[state] ?? state}
  </span>
);

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The diff of a ticket's pull requests with the review findings on their lines; opened from every PR link in DOCK. */
const ChangesPage: React.FC<ChangesPageProps> = ({ onNavigate, onTicketClick }) => {
  const query = params();
  const ticketKey = query.get('ticket') ?? '';
  const from = query.get('from') ?? 'board';
  const [tab, setTab] = useState<string | null>(query.get('repo'));
  const { data, loading, error } = useQuery(GET_TICKET_CHANGES, { variables: { ticketKey, tab }, skip: !ticketKey, fetchPolicy: 'cache-and-network' });

  const back = () => {
    if (from === 'ticket') onTicketClick(ticketKey);
    else onNavigate(from === 'agents' ? '/agents' : from === 'discord' ? '/discord' : '/dashboard');
  };
  const crumb = from === 'ticket' ? ticketKey : FROM[from] ?? 'Board';

  if (!ticketKey) return <Page width="full"><p className="text-sm text-muted-foreground">Open this page from a pull request link.</p></Page>;
  if (loading && !data) return <Page width="full"><LoadingSkeleton /></Page>;
  if (error && !data) return <Page width="full"><p className="rounded-md border border-status-conflict bg-status-conflict-bg p-4 text-sm text-status-conflict" role="alert">Changes failed to load: {error.message}</p></Page>;

  const changes = data?.ticketChanges;
  const pulls: Pull[] = changes?.pulls ?? [];
  const pull = pulls.find((item) => item.files) ?? pulls.find((item) => item.tab === tab) ?? pulls[0] ?? null;
  const pickTab = (next: string) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('repo', next);
    url.searchParams.delete('file');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  };

  return (
    <Page width="full">
      <nav className="mb-1.5 flex items-center gap-1.5 font-mono text-[0.72rem] text-muted-foreground" aria-label="Breadcrumb">
        <button type="button" onClick={back} className="flex min-h-7 items-center gap-1.5 border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground max-[760px]:min-h-11"><ArrowLeft size={13} aria-hidden="true" />{crumb}</button>
        {from !== 'ticket' && <><span>/</span><button type="button" onClick={() => onTicketClick(ticketKey)} className="border-0 bg-transparent p-0 font-semibold text-secondary-foreground hover:text-foreground">{ticketKey}</button></>}
        <span>/</span><span>Changes</span>
      </nav>
      {changes?.error === 'GITHUB_NOT_CONNECTED' ? (
        <Notice>GitHub is not connected. <button type="button" className="border-0 bg-transparent p-0 text-accent underline" onClick={() => onNavigate('/settings')}>Settings · GitHub</button></Notice>
      ) : !pull ? (
        <Notice>No pull request for {ticketKey} yet.</Notice>
      ) : (
        <PullView key={pull.url} ticketKey={ticketKey} title={changes?.title ?? null} pulls={pulls} pull={pull} review={changes?.review ?? null} onTab={pickTab} />
      )}
    </Page>
  );
};

const Notice: React.FC<{ children: React.ReactNode; tone?: 'warn' | 'error' }> = ({ children, tone }) => (
  <p className={cn('my-3 rounded-sm border px-3 py-2.5 text-sm', tone === 'error' ? 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict' : tone === 'warn' ? 'border-status-warn/45 bg-status-warn-bg text-status-warn' : 'border-border bg-surface-0 text-secondary-foreground')} role={tone ? 'alert' : undefined}>{children}</p>
);

interface PullViewProps { ticketKey: string; title: string | null; pulls: Pull[]; pull: Pull; review: Review | null; onTab: (tab: string) => void }

const PullView: React.FC<PullViewProps> = ({ ticketKey, title, pulls, pull, review, onTab }) => {
  const client = useApolloClient();
  const phone = usePhone();
  const [chosenView, setChosenView] = useState<DiffView>(readView);
  const view: DiffView = phone ? 'unified' : chosenView;
  const [findingsOn, setFindingsOn] = useState(true);
  const [hideSpaces, setHideSpaces] = useState(false);
  const [filter, setFilter] = useState('');
  const [onlyFindings, setOnlyFindings] = useState(false);
  const [viewed, setViewed] = useState<Record<string, string>>(() => readViewed(pull.url));
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [patches, setPatches] = useState<Record<string, string | null>>({});
  const [current, setCurrent] = useState(-1);
  const [sheet, setSheet] = useState(false);
  const [currentFile, setCurrentFile] = useState<string | null>(params().get('file'));

  const files = useMemo(() => (pull.files ?? []).map((file) => {
    const patch = file.path in patches ? patches[file.path] : file.patch;
    return { ...file, patch, hunks: parsePatch(patch) };
  }), [pull.files, patches]);
  const findings = review?.findings ?? [];
  const anchored = useMemo(() => anchorFindings(files, findingsOn ? findings : []), [files, findings, findingsOn]);
  const anchors = anchored.anchors;
  const general = anchors.filter((anchor) => anchor.path === null);
  const viewedOf = (path: string) => isViewed(viewed, path, files.find((file) => file.path === path)?.patch ?? null);
  const viewedCount = files.filter((file) => viewedOf(file.path)).length;
  const isFolded = (file: ChangeFile) => folded[file.path] ?? (file.patch !== null && file.additions + file.deletions > LONG_FILE_LINES);

  const blockers = findings.filter((item) => item.severity === 'blocker');
  const openBlockers = blockers.filter((item) => !item.resolvedAt).length;
  const openFollowUps = findings.filter((item) => item.severity !== 'blocker' && !item.resolvedAt).length;
  const staleReview = review && pull.headDate && review.updatedAt < pull.headDate;
  const openInTab = Object.values(anchored.counts).reduce((sum, count) => sum + count.open, 0);

  const scrollTo = (id: string) => window.setTimeout(() => reveal(id), 120);
  const pickFile = (path: string | null) => {
    setSheet(false);
    setCurrentFile(path ?? GENERAL);
    if (path) setFolded((state) => ({ ...state, [path]: false }));
    scrollTo(path ? `file-${path}` : 'general-findings');
  };
  const goTo = useCallback((index: number) => {
    if (!anchors.length) return;
    const next = (index + anchors.length) % anchors.length;
    const anchor = anchors[next];
    setCurrent(next);
    if (anchor.path) {
      setFolded((state) => ({ ...state, [anchor.path as string]: false }));
      reveal(`file-${anchor.path}`, false);
    }
    scrollTo(`finding-${anchor.finding}-${anchor.part}`);
  }, [anchors]);
  const placeOf = (anchor: Anchor) => anchors.indexOf(anchor) + 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'n') goTo(current + 1);
      if (event.key === 'p') goTo(current < 0 ? -1 : current - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, goTo]);

  useEffect(() => {
    const file = params().get('file');
    if (file) scrollTo(`file-${file}`);
  }, []);

  const setView = (next: DiffView) => {
    setChosenView(next);
    writeView(next);
  };
  const markViewed = (file: ChangeFile, on: boolean) => {
    const next = { ...viewed };
    if (on) next[file.path] = patchHash(file.patch);
    else delete next[file.path];
    setViewed(next);
    writeViewed(pull.url, next);
    if (on) setFolded((state) => ({ ...state, [file.path]: true }));
  };
  const loadPatch = async (path: string) => {
    const { data } = await client.query({ query: GET_PULL_FILE_PATCH, variables: { ticketKey, url: pull.url, path } });
    setPatches((state) => ({ ...state, [path]: data?.pullFilePatch?.patch ?? null }));
  };

  const tree = (large?: boolean) => (
    <FileTree files={files} counts={anchored.counts} viewed={viewedOf} filter={filter} onFilter={setFilter} onlyFindings={onlyFindings} onOnlyFindings={setOnlyFindings} current={currentFile} onPick={pickFile} large={large} />
  );
  const shownFiles = files.filter((file) => !onlyFindings || anchored.counts[file.path]);
  const toggle = 'flex h-8 items-center gap-1.5 rounded-xs border-0 px-2.5 font-display text-xs font-semibold text-secondary-foreground max-[760px]:h-11';

  return (
    <>
      <header className="mb-3">
        <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-xl leading-snug font-bold max-[760px]:text-lg">{title || pull.title}<StatePill state={pull.state} /></h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.76rem] text-secondary-foreground">
          {pull.author && <span>{pull.author}</span>}
          <span className="font-mono text-[0.7rem] max-[760px]:hidden"><span className="rounded-xs bg-surface-2 px-1.5 py-px">{pull.headRef}</span> → <span className="rounded-xs bg-surface-2 px-1.5 py-px">{pull.baseRef}</span></span>
          <span className="font-mono text-[0.7rem] text-muted-foreground max-[760px]:hidden">head {pull.headSha.slice(0, 7)}</span>
          <span className="font-mono tabular-nums"><span className="text-status-merged">+{pull.additions.toLocaleString('en')}</span> <span className="text-status-conflict">-{pull.deletions.toLocaleString('en')}</span></span>
          <span>{pull.changedFiles} files</span>
          {review && openBlockers > 0 && <span className="text-status-conflict">{openBlockers} open {openBlockers === 1 ? 'blocker' : 'blockers'}</span>}
          {review && blockers.length > openBlockers && <span className="text-status-merged">{blockers.length - openBlockers} {blockers.length - openBlockers === 1 ? 'blocker' : 'blockers'} resolved</span>}
          {review && openFollowUps > 0 && <span className="text-status-warn">{openFollowUps} open {openFollowUps === 1 ? 'follow-up' : 'follow-ups'}</span>}
          {review && <span className="text-muted-foreground max-[760px]:hidden">{review.roundsUsed ? `review round ${review.roundsUsed} · ` : ''}reviewed {wib(review.updatedAt)}</span>}
        </p>
      </header>

      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Pull requests">
        {pulls.map((item) => {
          const active = item.url === pull.url;
          return (
            <button key={item.url} type="button" role="tab" aria-selected={active} onClick={() => onTab(item.tab)} className={cn('flex min-h-10 items-center gap-2 whitespace-nowrap border-0 border-b-2 bg-transparent px-3 text-[0.8rem] font-medium max-[760px]:min-h-11', active ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {item.tab}<span className="font-mono text-[0.68rem] text-muted-foreground max-[760px]:hidden">#{item.number}</span>
              {active && openInTab > 0 && <span className="font-mono text-[0.68rem] font-bold text-status-warn">{openInTab}</span>}
              {item.state !== pulls[0].state && <StatePill state={item.state} />}
            </button>
          );
        })}
      </div>

      {pull.stale && <Notice tone="warn">GitHub is rate limited, so this is what DOCK kept.{pull.retryAt ? ` Fresh data after ${time(pull.retryAt)}.` : ''}</Notice>}
      {pull.error && <Notice tone="error">{ERROR_TEXT[pull.error] ?? pull.error}{pull.retryAt ? ` Fresh data after ${time(pull.retryAt)}.` : ''} <a href={pull.url} target="_blank" rel="noopener noreferrer" className="underline">Open on GitHub</a></Notice>}
      {!review && <Notice>No review on this ticket yet, so there are no findings to show.</Notice>}
      {staleReview && <Notice tone="warn">Reviewed before the last push: the review ran {wib(review.updatedAt)}, the head commit is from {wib(pull.headDate as string)}.</Notice>}
      {pull.partial && pull.files && <Notice>This pull request is big, so some files load on their own when opened.</Notice>}

      {pull.files && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {!phone && (
              <div className="flex rounded-sm border border-border p-0.5" role="group" aria-label="View">
                <button type="button" aria-pressed={view === 'unified'} onClick={() => setView('unified')} className={cn(toggle, view === 'unified' ? 'bg-surface-2 text-foreground' : 'bg-transparent')}><Rows size={14} aria-hidden="true" />Unified</button>
                <button type="button" aria-pressed={view === 'split'} onClick={() => setView('split')} className={cn(toggle, view === 'split' ? 'bg-surface-2 text-foreground' : 'bg-transparent')}><Columns size={14} aria-hidden="true" />Split</button>
              </div>
            )}
            {phone && <Button size="sm" onClick={() => setSheet(true)}><ListTree size={14} aria-hidden="true" />Files · {viewedCount}/{files.length}</Button>}
            <label className={cn('flex items-center gap-1.5 px-1 text-xs', review ? 'text-secondary-foreground' : 'text-muted-foreground opacity-60')}><Checkbox checked={findingsOn && Boolean(review)} disabled={!review} onChange={(event) => setFindingsOn(event.target.checked)} />Findings</label>
            <label className="flex items-center gap-1.5 px-1 text-xs text-secondary-foreground max-[760px]:hidden"><Checkbox checked={hideSpaces} onChange={(event) => setHideSpaces(event.target.checked)} />Hide whitespace</label>
            {!phone && anchors.length > 0 && (
              <>
                <Button size="sm" aria-label="Previous finding" onClick={() => goTo(current < 0 ? -1 : current - 1)}><ChevronUp size={14} aria-hidden="true" /></Button>
                <Button size="sm" onClick={() => goTo(current + 1)}><ChevronDown size={14} aria-hidden="true" />Next finding</Button>
                <span className="flex gap-1 font-mono text-[0.66rem] text-muted-foreground"><kbd className="rounded-xs border border-border px-1">n</kbd><kbd className="rounded-xs border border-border px-1">p</kbd></span>
              </>
            )}
            <span className="ml-auto font-mono text-[0.7rem] text-muted-foreground tabular-nums max-[760px]:hidden">{viewedCount} of {files.length} viewed</span>
            <a href={`${pull.url}/files`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 font-display text-xs font-semibold text-foreground hover:border-border-glow max-[760px]:ml-auto max-[760px]:h-11" aria-label="Open on GitHub"><ExternalLink size={13} aria-hidden="true" /><span className="max-[760px]:hidden">Open on GitHub</span></a>
          </div>

          <div className={cn('grid gap-4', phone ? 'grid-cols-1' : 'grid-cols-[290px_minmax(0,1fr)] items-start')}>
            {!phone && <aside className="sticky top-4 flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-sm border border-border bg-surface-0">{tree()}</aside>}
            <div className="flex min-w-0 flex-col gap-3">
              {general.length > 0 && (
                <section id="general-findings" className="scroll-mt-28 rounded-sm border border-border bg-surface-0 p-3">
                  <h2 className="mb-2 font-display text-[0.8rem] font-bold">General · findings without a line in this diff</h2>
                  <div className="flex flex-col gap-2">
                    {general.map((anchor) => <FindingCard key={`${anchor.finding}-${anchor.part}`} finding={findings[anchor.finding]} anchor={anchor} place={placeOf(anchor)} total={anchors.length} onStep={(delta) => goTo(placeOf(anchor) - 1 + delta)} />)}
                  </div>
                </section>
              )}
              {shownFiles.map((file) => {
                const own = anchors.filter((anchor) => anchor.path === file.path);
                return (
                  <React.Fragment key={file.path}>
                    {own.filter((anchor) => anchor.line === null).length > 0 && !isFolded(file) && (
                      <div className="-mb-1 flex flex-col gap-2">
                        {own.filter((anchor) => anchor.line === null).map((anchor) => <FindingCard key={`${anchor.finding}-${anchor.part}`} finding={findings[anchor.finding]} anchor={anchor} place={placeOf(anchor)} total={anchors.length} onStep={(delta) => goTo(placeOf(anchor) - 1 + delta)} />)}
                      </div>
                    )}
                    <DiffFile ticketKey={ticketKey} pullUrl={pull.url} headSha={pull.headSha} file={file} hunks={file.hunks} view={view} hideSpaces={hideSpaces}
                      findings={findings} anchors={own} placeOf={placeOf} total={anchors.length} onStep={(anchor, delta) => goTo(placeOf(anchor) - 1 + delta)}
                      viewed={viewedOf(file.path)} onViewed={(on) => markViewed(file, on)} folded={isFolded(file)} onFold={(next) => setFolded((state) => ({ ...state, [file.path]: next }))}
                      onLoadPatch={() => loadPatch(file.path)} />
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {phone && anchors.length > 0 && (
            <div className="fixed right-4 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-20 flex gap-2">
              <IconButton aria-label="Previous finding" className="rounded-full shadow-lg" onClick={() => goTo(current < 0 ? -1 : current - 1)}><ChevronUp size={18} aria-hidden="true" /></IconButton>
              <IconButton aria-label="Next finding" className="rounded-full shadow-lg" onClick={() => goTo(current + 1)}><ChevronDown size={18} aria-hidden="true" /></IconButton>
            </div>
          )}
          {phone && sheet && (
            <Dialog open onClose={() => setSheet(false)} labelledBy="changes-files-title" className="mt-auto mb-0 w-full max-w-none p-0">
              <div className="flex max-h-[75dvh] flex-col overflow-hidden rounded-t-md border border-border-glow bg-surface-0 pb-[env(safe-area-inset-bottom)]">
                <h2 id="changes-files-title" className="border-b border-border px-3 py-2.5 font-display text-sm font-bold">Files · {viewedCount} of {files.length} viewed</h2>
                {tree(true)}
              </div>
            </Dialog>
          )}
        </>
      )}
    </>
  );
};

export default ChangesPage;
