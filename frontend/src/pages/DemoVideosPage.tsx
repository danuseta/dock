import { Fragment, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, ExternalLink, RefreshCw, Trash2, Video } from 'lucide-react';
import { GET_DEMO_VIDEOS } from '../graphql/queries';
import { DELETE_DEMO_VIDEO } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { FilmScene } from '../components/empty/scenes/FilmScene';
import { Badge, Button, Card, ConfirmDialog, IconButton, Input, Page, PageHeader, PhoneCards, Select } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { formatSize, isPlayableVideo, videoSource, viewVideos, type DemoVideo, type VideoSort, type VideoSortColumn } from '../lib/demoVideos';
import { reportAge } from '../lib/sousReport';
import { paginate } from '../lib/pagination';

const PAGE_SIZE = 20;
const COLUMNS: Array<{ id: VideoSortColumn; label: string; first: VideoSort['dir']; className?: string }> = [
  { id: 'ticket', label: 'Ticket', first: 'asc' },
  { id: 'uploaded', label: 'Uploaded', first: 'desc' },
  { id: 'size', label: 'Size', first: 'desc', className: 'text-right' },
];

const SORT_OPTIONS = COLUMNS.flatMap((column) => (['asc', 'desc'] as const).map((dir) => ({ value: `${column.id}:${dir}`, label: `${column.label} ${dir === 'asc' ? 'ascending' : 'descending'}` })));

const DemoVideosPage = ({ onTicketClick }: { onTicketClick: (key: string) => void }) => {
  const { data, loading, error, refetch } = useQuery(GET_DEMO_VIDEOS, CACHED_QUERY_OPTIONS);
  const [deleteVideo] = useMutation(DELETE_DEMO_VIDEO);
  const [playing, setPlaying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<VideoSort>({ column: 'uploaded', dir: 'desc' });
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const videos: DemoVideo[] = data?.demoVideos?.videos || [];
  const matching = viewVideos(videos, query, sort);
  const shown = paginate(matching, page, PAGE_SIZE);

  const remove = async (key: string) => {
    setNotice(null);
    setDeleting(true);
    try {
      await deleteVideo({ variables: { ticketKey: key } });
      if (playing === key) setPlaying(null);
      await refetch();
    } catch (removeError: any) {
      setNotice({ text: removeError.message || 'The video could not be removed', error: true });
    } finally {
      setDeleting(false);
      setRemoving(null);
    }
  };

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setNotice({ text: 'Link copied', error: false }); } catch { setNotice({ text: 'Copy failed. Select the link and copy it by hand.', error: true }); }
  };

  const sortBy = (column: (typeof COLUMNS)[number]) => {
    setSort((current) => (current.column === column.id ? { column: column.id, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { column: column.id, dir: column.first }));
    setPage(1);
  };

  return (
    <Page width="full">
      <PageHeader>
        <div><h1 className="text-balance font-display text-3xl font-black">Demo videos</h1><p className="mt-1 text-pretty text-secondary-foreground">The demo link of every ticket. It shows on the ticket page of both DOCKs and goes into the Discord broadcast.</p></div>
        <Button className={cn(videos.length > 0 && 'max-[760px]:hidden')} onClick={() => void refetch()} disabled={loading}><RefreshCw size={16} className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh</Button>
      </PageHeader>

      {error && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{error.message}</Card>}
      {notice && <Card className={cn('mb-4 text-pretty text-sm', notice.error ? 'border-status-conflict text-status-conflict' : 'text-status-merged')} role={notice.error ? 'alert' : 'status'}>{notice.text}</Card>}

      {videos.length === 0 ? <Card className="p-0"><EmptyState scene={<FilmScene />} description="No demo video yet." /></Card> : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 max-[760px]:w-full">
              <Input className="w-[min(320px,100%)] max-[760px]:w-full max-[760px]:flex-1" type="search" placeholder="Search ticket key or title" aria-label="Search demo videos" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
              <IconButton className="min-[761px]:hidden" aria-label="Refresh" disabled={loading} onClick={() => void refetch()}><RefreshCw size={16} className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" /></IconButton>
            </div>
            <span className="flex items-center gap-3 max-[760px]:w-full max-[760px]:justify-between">
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{matching.length} of {videos.length} links</span>
              <Select
                className="w-44 min-[761px]:hidden"
                aria-label="Sort demo videos"
                value={`${sort.column}:${sort.dir}`}
                options={SORT_OPTIONS}
                onValueChange={(value) => { const [column, dir] = value.split(':'); setSort({ column: column as VideoSortColumn, dir: dir as VideoSort['dir'] }); setPage(1); }}
              />
            </span>
          </div>
          <Card className="overflow-hidden p-0">
            <PhoneCards>
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-surface-1 text-xs text-muted-foreground">
                <tr>
                  {COLUMNS.map((column) => {
                    const active = sort.column === column.id;
                    return (
                      <th key={column.id} className={cn('px-4 py-2.5 font-medium', column.className)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')} onClick={() => sortBy(column)}>
                          {column.label}
                          {active && (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Link</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.items.map((video) => (
                  <Fragment key={video.ticketKey}>
                    <tr className="border-t border-border hover:bg-surface-1">
                      <td className="max-w-[340px] px-4 py-2.5">
                        <button type="button" className="border-0 bg-transparent p-0 font-mono text-sm font-extrabold text-accent hover:underline" onClick={() => onTicketClick(video.ticketKey)}>{video.ticketKey}</button>
                        <span className="block truncate text-xs text-secondary-foreground max-[760px]:line-clamp-2 max-[760px]:whitespace-normal" title={video.title || undefined}>{video.title || '—'}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs" title={video.updatedAt ? new Date(video.updatedAt).toLocaleString('en-GB') : undefined}>{video.updatedAt ? reportAge(video.updatedAt) : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs tabular-nums">{video.size != null ? formatSize(video.size) : '—'}</td>
                      <td className="px-4 py-2.5"><Badge variant={video.size != null ? 'accent' : 'neutral'}>{videoSource(video)}</Badge></td>
                      <td className="max-w-[260px] px-4 py-2.5"><span className="block truncate font-mono text-[0.7rem] text-muted-foreground" title={video.url}>{video.url}</span></td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center justify-end gap-1">
                          {isPlayableVideo(video.url)
                            ? <IconButton variant="ghost" aria-label={`${playing === video.ticketKey ? 'Close the player of' : 'Play'} ${video.ticketKey}`} aria-expanded={playing === video.ticketKey} title="Play" onClick={() => setPlaying(playing === video.ticketKey ? null : video.ticketKey)}><Video size={15} aria-hidden="true" /></IconButton>
                            : /^https?:\/\//i.test(video.url) && <a className="inline-flex size-8 items-center justify-center text-secondary-foreground hover:text-accent" href={video.url} target="_blank" rel="noreferrer" aria-label={`Open the link of ${video.ticketKey}`} title="Open link"><ExternalLink size={15} aria-hidden="true" /></a>}
                          <IconButton variant="ghost" aria-label={`Copy the link of ${video.ticketKey}`} title="Copy link" onClick={() => void copy(video.url)}><Copy size={15} aria-hidden="true" /></IconButton>
                          <IconButton variant="ghost" className="text-status-conflict" aria-label={`Delete the demo link of ${video.ticketKey}`} title="Delete" onClick={() => setRemoving(video.ticketKey)}><Trash2 size={15} aria-hidden="true" /></IconButton>
                        </span>
                      </td>
                    </tr>
                    {playing === video.ticketKey && (
                      <tr className="bg-surface-1">
                        <td colSpan={6} className="px-4 py-3"><video className="mx-auto block max-h-[520px] w-full max-w-[920px] rounded-sm" src={video.url} controls autoPlay preload="metadata" /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {matching.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No video matches "{query}".</td></tr>}
              </tbody>
            </table>
            </PhoneCards>
          </Card>
        </>
      )}

      {shown.pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Demo video pages">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">Page {shown.page} of {shown.pages} · {matching.length} links</span>
          <IconButton variant="ghost" aria-label="Previous page" disabled={shown.page === 1} onClick={() => setPage(shown.page - 1)}><ChevronLeft size={16} aria-hidden="true" /></IconButton>
          <IconButton variant="ghost" aria-label="Next page" disabled={shown.page === shown.pages} onClick={() => setPage(shown.page + 1)}><ChevronRight size={16} aria-hidden="true" /></IconButton>
        </nav>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Delete the demo link of ${removing ?? ''}?`}
        description="The link leaves the ticket page of both DOCKs. When it points to the demo folder in S3, that video is deleted too."
        confirmLabel="Delete"
        busyLabel="Deleting..."
        busy={deleting}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
      />
    </Page>
  );
};

export default DemoVideosPage;
