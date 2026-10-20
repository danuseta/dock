import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ChevronLeft, ChevronRight, Copy, ExternalLink, RefreshCw, Trash2, Video } from 'lucide-react';
import { GET_DEMO_VIDEOS } from '../graphql/queries';
import { DELETE_DEMO_VIDEO } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { FilmScene } from '../components/empty/scenes/FilmScene';
import { Button, Card, ConfirmDialog, IconButton, Page, PageHeader } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { formatSize, isPlayableVideo, type DemoVideo } from '../lib/demoVideos';
import { paginate } from '../lib/pagination';

const PAGE_SIZE = 20;

const DemoVideosPage = ({ onTicketClick }: { onTicketClick: (key: string) => void }) => {
  const { data, loading, error, refetch } = useQuery(GET_DEMO_VIDEOS, CACHED_QUERY_OPTIONS);
  const [deleteVideo] = useMutation(DELETE_DEMO_VIDEO);
  const [preview, setPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const videos: DemoVideo[] = data?.demoVideos?.videos || [];
  const shown = paginate(videos, page, PAGE_SIZE);

  const remove = async (key: string) => {
    setNotice(null);
    setDeleting(true);
    try {
      await deleteVideo({ variables: { ticketKey: key } });
      if (preview?.includes(key)) setPreview(null);
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

  return (
    <Page width="full">
      <PageHeader>
        <div><h1 className="text-balance font-display text-3xl font-black">Demo videos</h1><p className="mt-1 text-pretty text-secondary-foreground">The demo link of every ticket. It shows on the ticket page of both DOCKs and goes into the Discord broadcast.</p></div>
        <Button onClick={() => void refetch()} disabled={loading}><RefreshCw size={16} className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh</Button>
      </PageHeader>

      {error && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{error.message}</Card>}
      {notice && <Card className={cn('mb-4 text-pretty text-sm', notice.error ? 'border-status-conflict text-status-conflict' : 'text-status-merged')} role={notice.error ? 'alert' : 'status'}>{notice.text}</Card>}

      {preview && <Card className="mb-6 p-0"><video className="w-full rounded-sm" src={preview} controls preload="metadata" /></Card>}

      <Card className="overflow-hidden p-0">
        {videos.length === 0 ? <EmptyState scene={<FilmScene />} description="No demo video yet." /> : (
          <ul className="flex flex-col">
            {shown.items.map((video) => (
              <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0" key={video.ticketKey}>
                <span className="min-w-0">
                  <button type="button" className="border-0 bg-transparent p-0 font-mono text-sm font-extrabold text-accent hover:underline" onClick={() => onTicketClick(video.ticketKey)}>{video.ticketKey}</button>
                  <small className="block truncate font-mono text-[0.68rem] text-muted-foreground">{[video.size != null ? formatSize(video.size) : null, video.updatedAt ? new Date(video.updatedAt).toLocaleString('en-GB') : null, video.url].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="flex items-center gap-1">
                  {isPlayableVideo(video.url)
                    ? <IconButton variant="ghost" aria-label={`Play ${video.ticketKey}`} title="Play" onClick={() => setPreview(video.url)}><Video size={15} aria-hidden="true" /></IconButton>
                    : /^https?:\/\//i.test(video.url) && <a className="inline-flex size-8 items-center justify-center text-secondary-foreground hover:text-accent" href={video.url} target="_blank" rel="noreferrer" aria-label={`Open the link of ${video.ticketKey}`} title="Open link"><ExternalLink size={15} aria-hidden="true" /></a>}
                  <IconButton variant="ghost" aria-label={`Copy the link of ${video.ticketKey}`} title="Copy link" onClick={() => void copy(video.url)}><Copy size={15} aria-hidden="true" /></IconButton>
                  <IconButton variant="ghost" className="text-status-conflict" aria-label={`Delete the demo link of ${video.ticketKey}`} title="Delete" onClick={() => setRemoving(video.ticketKey)}><Trash2 size={15} aria-hidden="true" /></IconButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {shown.pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Demo video pages">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">Page {shown.page} of {shown.pages} · {videos.length} links</span>
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
